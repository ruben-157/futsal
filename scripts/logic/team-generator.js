import { COLORS } from '../data/config.js';

const EPS = 1e-9;
const GREEDY_SHORTLIST_DELTA = 0.15;
const SKILL_SWAP_DELTA = 0.05;
const STAMINA_SWAP_DELTA = 0.03;
const FINAL_SKILL_DELTA = 0.05;
const FINAL_STAMINA_DELTA = 0.05;
const FINAL_BAND_CLASH_DELTA = 1;
const MAX_SKILL_PASSES = 8;
const MAX_STAMINA_PASSES = 8;
const DEFAULT_CANDIDATE_COUNT = 64;

export function computeTeamCount(n){
  return Math.max(1, Math.min(4, Math.floor(n / 4)));
}

export function computeTeamCapacities(n, teamCountOverride = null){
  const teamCount = Number.isInteger(teamCountOverride) && teamCountOverride > 0
    ? teamCountOverride
    : computeTeamCount(n);
  if(Number.isInteger(teamCountOverride) && teamCountOverride > 0){
    const base = Array(teamCount).fill(Math.floor(n / teamCount));
    const remainder = n % teamCount;
    for(let i = teamCount - remainder; i < teamCount; i++){
      if(i >= 0 && i < teamCount) base[i] += 1;
    }
    return base;
  }
  const capacities = Array(teamCount).fill(4);
  const remainder = n - (4 * teamCount);
  for(let i = teamCount - remainder; i < teamCount; i++){
    if(i >= 0 && i < teamCount) capacities[i] += 1;
  }
  return capacities;
}

export function normalizeTeamSignature(teams){
  return (teams || [])
    .map(team => [...(team.members || [])].sort((a, b) => a.localeCompare(b)).join(','))
    .sort((a, b) => a.localeCompare(b))
    .join(' || ');
}

export function computeSkillError(teams, attendees, getSkill){
  if(!Array.isArray(attendees) || attendees.length === 0) return 0;
  const avgSkill = attendees.reduce((sum, name) => sum + getSkill(name), 0) / attendees.length;
  return (teams || []).reduce((sum, team) => {
    const members = team.members || [];
    const skillSum = members.reduce((total, name) => total + getSkill(name), 0);
    return sum + Math.abs(skillSum - (members.length * avgSkill));
  }, 0);
}

export function computeStaminaError(teams, attendees, getStamina){
  if(!Array.isArray(attendees) || attendees.length === 0) return 0;
  const avgStamina = attendees.reduce((sum, name) => sum + getStamina(name), 0) / attendees.length;
  return (teams || []).reduce((sum, team) => {
    const members = team.members || [];
    if(members.length === 0) return sum;
    const teamAvg = members.reduce((total, name) => total + getStamina(name), 0) / members.length;
    return sum + Math.abs(teamAvg - avgStamina);
  }, 0);
}

export function computeBandClashError(teams, bandIndexByPlayer){
  if(!bandIndexByPlayer) return 0;
  let total = 0;
  for(const team of teams || []){
    const counts = new Map();
    for(const member of (team.members || [])){
      const bandIndex = bandIndexByPlayer.get(member);
      if(bandIndex == null) continue;
      counts.set(bandIndex, (counts.get(bandIndex) || 0) + 1);
    }
    for(const count of counts.values()){
      total += count * (count - 1);
    }
  }
  return total;
}

export function filterCandidatePool(candidates, options={}){
  const skillDelta = Number.isFinite(options.skillDelta) ? options.skillDelta : FINAL_SKILL_DELTA;
  const staminaDelta = Number.isFinite(options.staminaDelta) ? options.staminaDelta : FINAL_STAMINA_DELTA;
  const bandDelta = Number.isFinite(options.bandDelta) ? options.bandDelta : FINAL_BAND_CLASH_DELTA;
  const deduped = dedupeCandidates(candidates);
  if(deduped.length === 0) return [];

  const bestSkill = Math.min(...deduped.map(candidate => candidate.skillError));
  const skillPool = deduped.filter(candidate => candidate.skillError <= bestSkill + skillDelta + EPS);

  const bestStamina = Math.min(...skillPool.map(candidate => candidate.staminaError));
  const staminaPool = skillPool.filter(candidate => candidate.staminaError <= bestStamina + staminaDelta + EPS);

  const bestBandClash = Math.min(...staminaPool.map(candidate => candidate.bandClashError));
  return staminaPool.filter(candidate => candidate.bandClashError <= bestBandClash + bandDelta + EPS);
}

export function solveTeams({
  attendees,
  teamCountOverride = null,
  rng = Math.random,
  getSkill,
  getStamina,
  candidateCount = DEFAULT_CANDIDATE_COUNT
}){
  if(!Array.isArray(attendees) || attendees.length === 0) return [];
  if(typeof getSkill !== 'function' || typeof getStamina !== 'function'){
    throw new Error('solveTeams requires getSkill and getStamina functions');
  }

  const capacities = computeTeamCapacities(attendees.length, teamCountOverride);
  const teamCount = capacities.length;
  const colors = COLORS.slice(0, Math.min(teamCount, COLORS.length));
  const avgSkill = attendees.reduce((sum, name) => sum + getSkill(name), 0) / attendees.length;
  const avgStamina = attendees.reduce((sum, name) => sum + getStamina(name), 0) / attendees.length;
  const { bands, bandIndexByPlayer } = buildSkillBands(attendees, teamCount, getSkill);

  const candidates = [];
  const totalCandidates = Math.max(1, candidateCount);
  for(let i = 0; i < totalCandidates; i++){
    candidates.push(
      generateCandidate({
        candidateIndex: i,
        attendees,
        capacities,
        colors,
        avgSkill,
        avgStamina,
        bands,
        bandIndexByPlayer,
        rng,
        getSkill,
        getStamina
      })
    );
  }

  let pool = filterCandidatePool(candidates);
  const deduped = dedupeCandidates(candidates);
  const globalBestBandClash = deduped.length ? Math.min(...deduped.map(candidate => candidate.bandClashError)) : 0;

  if(pool.length){
    let skillDelta = FINAL_SKILL_DELTA;
    while(
      skillDelta < 0.25 - EPS
      && hasMaterialBandClashGap(pool, globalBestBandClash)
    ){
      skillDelta += 0.05;
      pool = filterCandidatePool(candidates, { skillDelta });
    }
    if(
      hasMaterialBandClashGap(pool, globalBestBandClash)
      && skillDelta < 0.27 - EPS
    ){
      pool = filterCandidatePool(candidates, { skillDelta: 0.27 });
    }
  }
  if(pool.length === 0){
    pool = deduped;
  }
  const chosen = pool[Math.floor(randomUnit(rng) * pool.length)] || candidates[0];
  return chosen ? cloneTeams(chosen.teams) : [];
}

function dedupeCandidates(candidates){
  const map = new Map();
  for(const candidate of candidates || []){
    const signature = candidate.signature || normalizeTeamSignature(candidate.teams);
    const current = map.get(signature);
    const normalized = current ? current : { ...candidate, signature };
    if(!current || compareCandidates(candidate, current) < 0){
      map.set(signature, { ...candidate, signature });
    } else {
      map.set(signature, normalized);
    }
  }
  return [...map.values()];
}

function compareCandidates(a, b){
  return (a.skillError - b.skillError)
    || (a.staminaError - b.staminaError)
    || (a.bandClashError - b.bandClashError)
    || String(a.signature || '').localeCompare(String(b.signature || ''));
}

function hasMaterialBandClashGap(pool, globalBestBandClash){
  if(!pool.length) return false;
  return Math.min(...pool.map(candidate => candidate.bandClashError)) > globalBestBandClash + FINAL_BAND_CLASH_DELTA + EPS;
}

function buildSkillBands(attendees, teamCount, getSkill){
  const sorted = [...attendees].sort((a, b) => getSkill(b) - getSkill(a) || a.localeCompare(b));
  const bands = [];
  const bandIndexByPlayer = new Map();
  for(let i = 0; i < sorted.length; i += teamCount){
    const band = sorted.slice(i, i + teamCount);
    const bandIndex = bands.length;
    bands.push(band);
    for(const player of band){
      bandIndexByPlayer.set(player, bandIndex);
    }
  }
  return { bands, bandIndexByPlayer };
}

function generateCandidate({
  candidateIndex,
  attendees,
  capacities,
  colors,
  avgSkill,
  avgStamina,
  bands,
  bandIndexByPlayer,
  rng,
  getSkill,
  getStamina
}){
  const teamInfos = capacities.map((cap, index) => ({
    cap,
    targetSkill: cap * avgSkill,
    skillSum: 0,
    staminaSum: 0,
    bandCounts: Array(bands.length).fill(0),
    team: {
      id: index + 1,
      name: colors[index].name,
      color: colors[index].hex,
      members: []
    }
  }));

  for(let bandIndex = 0; bandIndex < bands.length; bandIndex++){
    const randomizedBand = shuffleWithRng(bands[bandIndex], rng);
    for(const player of randomizedBand){
      const playerSkill = getSkill(player);
      const playerStamina = getStamina(player);
      const scored = [];
      let bestScore = -Infinity;
      for(const info of teamInfos){
        if(info.team.members.length >= info.cap) continue;
        const score = info.targetSkill - info.skillSum;
        scored.push({ info, score });
        if(score > bestScore) bestScore = score;
      }
      const shortlist = scored.filter(candidate => candidate.score >= bestScore - GREEDY_SHORTLIST_DELTA - EPS);
      const weights = shortlist.map(candidate => computeGreedyWeight(candidate, shortlist, bandIndex, playerStamina, avgStamina));
      const chosen = pickWeighted(shortlist, weights, rng) || shortlist[0] || scored[0];
      const target = chosen.info;
      target.team.members.push(player);
      target.skillSum += playerSkill;
      target.staminaSum += playerStamina;
      target.bandCounts[bandIndex] += 1;
    }
  }

  const teams = cloneTeams(teamInfos.map(info => info.team));
  runRandomSkillBalance(
    teams,
    avgSkill,
    bandIndexByPlayer,
    rng,
    getSkill,
    getSkillPassBudget(candidateIndex, rng)
  );
  runRandomStaminaBalance(
    teams,
    attendees,
    bandIndexByPlayer,
    rng,
    getSkill,
    getStamina
  );

  return {
    teams,
    skillError: computeSkillError(teams, attendees, getSkill),
    staminaError: computeStaminaError(teams, attendees, getStamina),
    bandClashError: computeBandClashError(teams, bandIndexByPlayer),
    signature: normalizeTeamSignature(teams)
  };
}

function computeGreedyWeight(candidate, shortlist, bandIndex, playerStamina, avgStamina){
  const scoreFloor = shortlist.reduce((max, item) => Math.max(max, item.score), -Infinity) - GREEDY_SHORTLIST_DELTA;
  let weight = 1 + Math.max(0, candidate.score - scoreFloor) / GREEDY_SHORTLIST_DELTA;

  const bandCounts = shortlist.map(item => item.info.bandCounts[bandIndex] || 0);
  const minBandCount = Math.min(...bandCounts);
  const bandCount = candidate.info.bandCounts[bandIndex] || 0;
  if(bandCount === minBandCount){
    weight += 0.6;
  } else {
    weight = Math.max(0.05, weight - (0.45 * (bandCount - minBandCount)));
  }

  if(playerStamina >= avgStamina){
    const minCap = Math.min(...shortlist.map(item => item.info.cap));
    if(candidate.info.cap === minCap) weight += 0.25;

    const sameCap = shortlist.filter(item => item.info.cap === candidate.info.cap);
    const minStaminaSum = Math.min(...sameCap.map(item => item.info.staminaSum));
    if(candidate.info.staminaSum <= minStaminaSum + EPS) weight += 0.15;
  }

  return Math.max(weight, 0.05);
}

function runRandomSkillBalance(teams, avgSkill, bandIndexByPlayer, rng, getSkill, maxPasses = MAX_SKILL_PASSES){
  const targets = teams.map(team => (team.members || []).length * avgSkill);
  for(let pass = 0; pass < maxPasses; pass++){
    const options = [];
    const skillSums = teams.map(team => sumSkills(team, getSkill));
    for(let i = 0; i < teams.length; i++){
      for(let j = i + 1; j < teams.length; j++){
        const beforeError = Math.abs(skillSums[i] - targets[i]) + Math.abs(skillSums[j] - targets[j]);
        for(const a of teams[i].members){
          const skillA = getSkill(a);
          for(const b of teams[j].members){
            const skillB = getSkill(b);
            const afterI = skillSums[i] - skillA + skillB;
            const afterJ = skillSums[j] - skillB + skillA;
            const afterError = Math.abs(afterI - targets[i]) + Math.abs(afterJ - targets[j]);
            const improvement = beforeError - afterError;
            if(improvement > EPS){
              swapMembers(teams[i], teams[j], a, b);
              const bandClashError = computeBandClashError(teams, bandIndexByPlayer);
              swapMembers(teams[i], teams[j], b, a);
              options.push({ i, j, a, b, improvement, bandClashError });
            }
          }
        }
      }
    }
    if(options.length === 0) return;
    const bestImprovement = Math.max(...options.map(option => option.improvement));
    const nearBest = options.filter(option => option.improvement >= bestImprovement - SKILL_SWAP_DELTA - EPS);
    const bestBandClash = Math.min(...nearBest.map(option => option.bandClashError));
    const pool = nearBest.filter(option => option.bandClashError <= bestBandClash + EPS);
    const chosen = pickRandom(pool, rng);
    if(!chosen) return;
    swapMembers(teams[chosen.i], teams[chosen.j], chosen.a, chosen.b);
  }
}

function runRandomStaminaBalance(teams, attendees, bandIndexByPlayer, rng, getSkill, getStamina, maxPasses = MAX_STAMINA_PASSES){
  for(let pass = 0; pass < maxPasses; pass++){
    const currentSkillError = computeSkillError(teams, attendees, getSkill);
    const currentStaminaError = computeStaminaError(teams, attendees, getStamina);
    const options = [];
    for(let i = 0; i < teams.length; i++){
      for(let j = i + 1; j < teams.length; j++){
        for(const a of teams[i].members){
          for(const b of teams[j].members){
            if(Math.abs(getSkill(a) - getSkill(b)) > 0.1 + EPS) continue;
            swapMembers(teams[i], teams[j], a, b);
            const nextSkillError = computeSkillError(teams, attendees, getSkill);
            const nextStaminaError = computeStaminaError(teams, attendees, getStamina);
            const staminaGain = currentStaminaError - nextStaminaError;
            if(nextSkillError <= currentSkillError + EPS && staminaGain > EPS){
              const bandClashError = computeBandClashError(teams, bandIndexByPlayer);
              options.push({ i, j, a, b, staminaGain, bandClashError });
            }
            swapMembers(teams[i], teams[j], b, a);
          }
        }
      }
    }
    if(options.length === 0) return;
    const bestGain = Math.max(...options.map(option => option.staminaGain));
    const nearBest = options.filter(option => option.staminaGain >= bestGain - STAMINA_SWAP_DELTA - EPS);
    const bestBandClash = Math.min(...nearBest.map(option => option.bandClashError));
    const pool = nearBest.filter(option => option.bandClashError <= bestBandClash + EPS);
    const chosen = pickRandom(pool, rng);
    if(!chosen) return;
    swapMembers(teams[chosen.i], teams[chosen.j], chosen.a, chosen.b);
  }
}

function swapMembers(teamA, teamB, playerA, playerB){
  const idxA = teamA.members.indexOf(playerA);
  const idxB = teamB.members.indexOf(playerB);
  if(idxA === -1 || idxB === -1) return false;
  teamA.members[idxA] = playerB;
  teamB.members[idxB] = playerA;
  return true;
}

function shuffleWithRng(items, rng){
  const copy = [...items];
  for(let i = copy.length - 1; i > 0; i--){
    const j = Math.floor(randomUnit(rng) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickWeighted(items, weights, rng){
  if(!items.length) return null;
  const total = weights.reduce((sum, weight) => sum + Math.max(weight, 0), 0);
  if(total <= EPS) return items[Math.floor(randomUnit(rng) * items.length)] || null;
  let draw = randomUnit(rng) * total;
  for(let i = 0; i < items.length; i++){
    draw -= Math.max(weights[i], 0);
    if(draw <= 0) return items[i];
  }
  return items[items.length - 1] || null;
}

function pickRandom(items, rng){
  if(!items || items.length === 0) return null;
  return items[Math.floor(randomUnit(rng) * items.length)] || null;
}

function getSkillPassBudget(candidateIndex, rng){
  if(candidateIndex === 0) return MAX_SKILL_PASSES;
  if(candidateIndex === 1) return 2 + Math.floor(randomUnit(rng) * 2);
  if(candidateIndex === 2) return 4 + Math.floor(randomUnit(rng) * 2);
  if(candidateIndex === 3) return 6 + Math.floor(randomUnit(rng) * 2);
  return MAX_SKILL_PASSES;
}

function randomUnit(rng){
  const value = typeof rng === 'function' ? rng() : Math.random();
  if(Number.isFinite(value)){
    if(value <= 0) return 0;
    if(value >= 1) return 0.999999999;
    return value;
  }
  return Math.random();
}

function sumSkills(team, getSkill){
  return (team.members || []).reduce((sum, name) => sum + getSkill(name), 0);
}

function cloneTeams(teams){
  return (teams || []).map(team => ({
    id: team.id,
    name: team.name,
    color: team.color,
    members: [...(team.members || [])]
  }));
}
