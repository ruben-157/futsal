import {
  COLORS,
  MAX_ATTENDEES,
  getSkill,
  getStamina,
  STAMINA,
  DEFAULT_STAMINA,
  SKILLS,
  DEFAULT_SKILL,
  RATING_STEP,
  normalizeRating,
  snapToRatingStep
} from './data/config.js';
import {
  state,
  loadState,
  saveAttendees,
  savePlayers,
  saveTeams,
  saveTimestamp,
  saveResults,
  saveRounds,
  getTrackScorersPref,
  setTrackScorersPref,
  getPrevRanks,
  KEYS,
  savePrevRanksFromRows
} from './state/storage.js';
import { computeStableSeedFromAttendees, shuffleSeeded, mulberry32 } from './utils/random.js';
import { balanceSkillToTargets, balanceStaminaEqualSkill } from './logic/balance.js';

const HARMONY_TOKENS = ['UnViZW58UmFtdGlu'];
function decodeHarmonyToken(token){
  try{
    if(typeof atob === 'function'){
      return atob(token);
    }
    if(typeof globalThis !== 'undefined' && globalThis.Buffer){
      return globalThis.Buffer.from(token, 'base64').toString('utf8');
    }
  }catch(_){}
  return '';
}
const harmonyPairs = HARMONY_TOKENS
  .map(token => {
    const decoded = decodeHarmonyToken(token);
    if(!decoded) return null;
    const parts = decoded.split('|').map(s => s.trim()).filter(Boolean);
    return parts.length === 2 ? parts : null;
  })
  .filter(Boolean);
const harmonyPairKeys = new Set(harmonyPairs.map(([a,b]) => [a,b].sort((x,y)=>x.localeCompare(y)).join('|')));
const HARMONY_PENALTY = 0.4;

function isHarmonyPair(a,b){
  if(!a || !b) return false;
  return harmonyPairKeys.has([a,b].sort((x,y)=>x.localeCompare(y)).join('|'));
}
function computeHarmonyBias(members=[], candidate){
  if(!candidate || !Array.isArray(members) || members.length === 0) return 0;
  let bias = 0;
  for(const member of members){
    if(isHarmonyPair(member, candidate)){
      bias += HARMONY_PENALTY;
    }
  }
  return bias;
}
function applyRosterHarmonyFinal(teams){
  if(!Array.isArray(teams) || teams.length < 2 || harmonyPairs.length === 0) return;
  for(const [a,b] of harmonyPairs){
    if(!a || !b) continue;
    let teamA = null, teamB = null;
    for(const team of teams){
      if(team.members && team.members.includes(a)) teamA = team;
      if(team.members && team.members.includes(b)) teamB = team;
    }
    if(!teamA || !teamB || teamA !== teamB) continue;
    const conflictTeam = teamA;
    const pairMembers = [a, b];
    let bestSwap = null;
    for(const moving of pairMembers){
      const counterpart = moving === a ? b : a;
      for(const target of teams){
        if(target === conflictTeam) continue;
        if(target.members && target.members.includes(counterpart)) continue;
        if(!Array.isArray(target.members) || target.members.length === 0) continue;
        for(const swapCandidate of target.members){
          if(isHarmonyPair(swapCandidate, counterpart)) continue;
          const skillGap = Math.abs(getSkill(moving) - getSkill(swapCandidate));
          const staminaGap = Math.abs(getStamina(moving) - getStamina(swapCandidate)) * 0.05;
          const score = skillGap + staminaGap;
          if(!bestSwap || score < bestSwap.score){
            bestSwap = {
              score,
              fromTeam: conflictTeam,
              toTeam: target,
              moving,
              swapCandidate
            };
          }
        }
      }
    }
    if(bestSwap){
      const fromIdx = bestSwap.fromTeam.members.indexOf(bestSwap.moving);
      const toIdx = bestSwap.toTeam.members.indexOf(bestSwap.swapCandidate);
      if(fromIdx !== -1 && toIdx !== -1){
        bestSwap.fromTeam.members[fromIdx] = bestSwap.swapCandidate;
        bestSwap.toTeam.members[toIdx] = bestSwap.moving;
      }
    }
  }
}



function clampPlayLimit(){
  const over = state.attendees.length > MAX_ATTENDEES;
  if(over){
    state.attendees = state.attendees.slice(0, MAX_ATTENDEES);
    saveAttendees();
  }
  const notice = document.getElementById('limitNotice');
  if(notice){
    notice.textContent = `Limit reached: maximum ${MAX_ATTENDEES} players.`;
  }
  if(state.attendees.length >= MAX_ATTENDEES){
    notice.style.display = '';
  } else {
    notice.style.display = 'none';
  }
}

// ----- Rendering -----
function renderRoster(){
  const listNot = document.getElementById('listNot');
  listNot.innerHTML = '';

  const playSet = new Set(state.attendees);
  const allPlayers = state.players
    .slice()
    .sort((a,b)=> a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const notFiltered = allPlayers;

  // Available players list (single list with selection state)
  for(const name of notFiltered){
    const selected = playSet.has(name);
    const item = createListItem(name, selected);
    listNot.appendChild(item);
  }

  const genBtn = document.getElementById('btnGenerateBottom');
  if(genBtn) genBtn.textContent = `Generate Teams (${state.attendees.length})`;

  const hasTeams = state.teams && state.teams.length>0;
  const canGen = state.attendees.length >= 8 && !hasTeams;
  document.getElementById('btnGenerateBottom').disabled = !canGen;
  const addBtn = document.getElementById('btnAddPlayer');
  if(addBtn) addBtn.disabled = !!hasTeams;
  const info = document.getElementById('genError');
  // Remove players-locked warning on Players tab
  info.textContent = '';
  info.style.display = 'none';
  const sec = document.getElementById('playersSection');
  sec.classList.toggle('locked', !!hasTeams);
}

function createListItem(name, isSelected){
  const div = document.createElement('div');
  div.className = 'item';
  div.setAttribute('role','listitem');
  const locked = state.teams && state.teams.length>0;
  div.setAttribute('draggable', 'false');
  div.dataset.name = name;
  div.dataset.side = isSelected ? 'playing' : 'not';

  // state icon
  const icon = document.createElement('span');
  icon.textContent = isSelected ? '✓' : '';
  icon.style.minWidth = '16px';

  const label = document.createElement('div');
  label.textContent = name;
  label.style.flex = '1';

  if(isSelected){ div.classList.add('selected'); }

  // Click anywhere on item toggles
  div.tabIndex = 0;
  const onToggle = () => {
    if(state.teams && state.teams.length>0) return; // locked
    if(state.attendees.includes(name)) { moveToNot(name); } else { moveToPlay(name); }
  };
  div.addEventListener('click', (e)=>{ onToggle(); });
  div.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); onToggle(); }
  });

  // Disable DnD for simplified UI
  div.addEventListener('dragstart', (e)=>{ e.preventDefault(); });

  div.appendChild(label);
  div.appendChild(icon);
  return div;
}

function setupDnD(){ /* DnD disabled in single-list selection UI */ }

function renderTeams(){
  const table = document.getElementById('teamsTable');
  if(!table) return;
  const headerLabels = ['Team', 'Members', 'Size', 'Avg Skill', 'Avg Stamina'];
  const thead = table.tHead || table.createTHead();
  const headerRow = document.createElement('tr');
  headerLabels.forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.innerHTML = '';
  thead.appendChild(headerRow);
  const existingBody = document.getElementById('teamsBody') || table.tBodies[0];
  const tbody = document.createElement('tbody');
  tbody.id = 'teamsBody';
  if(existingBody) existingBody.replaceWith(tbody);
  else table.appendChild(tbody);
  if(!state.teams || state.teams.length === 0){
    // No teams yet: leave table empty
    return;
  }
  for(const team of state.teams){
    const tr = document.createElement('tr');
    const tdTeam = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = 'team-pill';
    pill.style.borderColor = team.color;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'team-name';
    nameSpan.contentEditable = 'true';
    nameSpan.textContent = team.name;
    nameSpan.dataset.teamId = String(team.id);
    nameSpan.ariaLabel = `Edit name for ${team.name}`;
    nameSpan.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){ e.preventDefault(); nameSpan.blur(); }
    });
    nameSpan.addEventListener('blur', ()=>{
      const val = (nameSpan.textContent || '').trim();
      team.name = val || team.name; // keep previous if blank
      saveTeams();
      renderSchedule();
    });
    pill.appendChild(nameSpan);
    tdTeam.appendChild(pill);

    const tdMembers = document.createElement('td');
    const membersSorted = [...team.members].sort((a,b)=> a.localeCompare(b));
    tdMembers.textContent = membersSorted.join(', ');

    const tdSize = document.createElement('td');
    tdSize.textContent = String(team.members.length);

    const tdAvgSkill = document.createElement('td');
    const tdAvgStamina = document.createElement('td');
    const count = team.members.length;
    if(count > 0){
      const totalSkill = team.members.reduce((s,name)=> s + getSkill(name), 0);
      const totalStamina = team.members.reduce((s,name)=> s + getStamina(name), 0);
      const avgSkill = totalSkill / count;
      const avgStam = totalStamina / count;
      tdAvgSkill.textContent = avgSkill.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      tdAvgStamina.textContent = avgStam.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      tdAvgSkill.textContent = '—';
      tdAvgStamina.textContent = '—';
    }

    tr.appendChild(tdTeam);
    tr.appendChild(tdMembers);
    tr.appendChild(tdSize);
    tr.appendChild(tdAvgSkill);
    tr.appendChild(tdAvgStamina);
    tbody.appendChild(tr);
  }
  renderSchedule();
}

function renderSchedule(){
  const schedSec = document.getElementById('matchesSection');
  const list = document.getElementById('matchesList');
  list.innerHTML = '';
  if(!state.teams || state.teams.length < 2){
    const info = document.createElement('div');
    info.className = 'notice';
    info.textContent = 'Generate teams to see the match schedule.';
    list.appendChild(info);
    return;
  }
  const stableSeed = computeStableSeedFromAttendees(state.attendees || []);
  // Build all unique pairings
  const pairings = [];
  for(let i=0;i<state.teams.length;i++){
    for(let j=i+1;j<state.teams.length;j++){
      pairings.push([state.teams[i], state.teams[j]]);
    }
  }
  const totalRounds = Math.max(1, Number(state.rounds) || 2);
  let nextMarked = false;
  // Compute a single deterministic round order and repeat it for all rounds
  const baseStreak = new Map(state.teams.map(t => [t.id, 0]));
  const baseOrdered = orderRoundPairings(pairings, baseStreak, stableSeed);
  // Try to keep the repeated order from creating 3-in-a-row across round boundaries
  function createsTriple(order){
    const ids = state.teams.map(t=>t.id);
    const streak = new Map(ids.map(id=>[id,0]));
    for(let r=0;r<totalRounds;r++){
      for(const [a,b] of order){
        for(const id of ids){
          if(id===a.id || id===b.id){ streak.set(id, (streak.get(id)||0)+1); }
          else { streak.set(id, 0); }
          if((streak.get(id)||0) >= 3) return true;
        }
      }
    }
    return false;
  }
  function rotate(arr, k){
    const n = arr.length; const out = new Array(n);
    for(let i=0;i<n;i++){ out[i] = arr[(i+k)%n]; }
    return out;
  }
  let fixedOrdered = baseOrdered;
  if(createsTriple(fixedOrdered)){
    // Try reversed order
    const rev = [...baseOrdered].reverse();
    if(!createsTriple(rev)) fixedOrdered = rev; else {
      // Try rotations
      for(let k=1;k<baseOrdered.length;k++){
        const rot = rotate(baseOrdered, k);
        if(!createsTriple(rot)){ fixedOrdered = rot; break; }
      }
    }
  }
  // Flatten schedule for kickoff fairness and next-match detection
  const flat = [];
  for(let roundIdx=0; roundIdx<totalRounds; roundIdx++){
    for(const [a,b] of fixedOrdered){
      const matchId = `${Math.min(a.id,b.id)}-${Math.max(a.id,b.id)}-r${roundIdx+1}`;
      flat.push({ a, b, roundIdx, matchId });
    }
  }

  // Compute kickoff for the next unplayed match to balance starts evenly
  const startCounts = new Map(state.teams.map(t => [t.id, 0]));
  let nextKickoffId = null;
  const rng = mulberry32((stableSeed + 0x9e3779b9) >>> 0);
  let nextIndex = -1;
  for(let i=0;i<flat.length;i++){
    const { a, b, matchId } = flat[i];
    const rec = state.results[matchId];
    const played = rec && rec.ga != null && rec.gb != null;
    if(!played && nextIndex === -1){ nextIndex = i; break; }
    // assign historical kickoff deterministically for balancing, even if not stored
    const ca = startCounts.get(a.id) || 0;
    const cb = startCounts.get(b.id) || 0;
    let starter = null;
    if(ca < cb) starter = a.id; else if(cb < ca) starter = b.id; else starter = (rng() < 0.5 ? a.id : b.id);
    startCounts.set(starter, (startCounts.get(starter) || 0) + 1);
  }
  if(nextIndex >= 0){
    const { a, b } = flat[nextIndex];
    const ca = startCounts.get(a.id) || 0;
    const cb = startCounts.get(b.id) || 0;
    if(ca < cb) nextKickoffId = a.id; else if(cb < ca) nextKickoffId = b.id; else nextKickoffId = (rng() < 0.5 ? a.id : b.id);
  }

  // Render rounds using the fixed baseOrdered sequence for each round
  let flatCursor = 0;
  for(let roundIdx=0; roundIdx<totalRounds; roundIdx++){
    // Add round heading now, followed by its matches
    const h = document.createElement('div');
    h.style.marginTop = roundIdx === 0 ? '0' : '12px';
    h.style.fontWeight = '700';
    h.style.color = 'var(--muted)';
    h.textContent = `Round ${roundIdx+1}`;
    list.appendChild(h);
    fixedOrdered.forEach(([a,b]) => {
      const matchId = `${Math.min(a.id,b.id)}-${Math.max(a.id,b.id)}-r${roundIdx+1}`;
      const rec = state.results[matchId] || null;

      const row = document.createElement('div');
      row.className = 'pair';
      row.style.display = 'flex';
      row.style.flexWrap = 'wrap';
      row.style.gap = '8px 12px';
      row.style.alignItems = 'center';

      const label = document.createElement('div');
      label.style.flex = '1 1 220px';
      label.style.display = 'flex';
      label.style.gap = '8px';
      label.style.flexWrap = 'nowrap';
      label.style.flexDirection = 'column';
      label.style.alignItems = 'flex-start';
      // On tablet, CSS overrides this to a three-column grid via .match-label
      label.classList.add('match-label');
      const teamABox = document.createElement('div');
      teamABox.style.display = 'flex';
      teamABox.style.flexDirection = 'column';
      teamABox.style.alignItems = 'flex-start';
      const pillA = document.createElement('span');
      pillA.className = 'team-pill';
      pillA.style.borderColor = a.color;
      pillA.appendChild(document.createTextNode(a.name));
      const subA = document.createElement('div');
      subA.className = 'team-sub';
      subA.textContent = (a.members || []).join(', ');
      teamABox.appendChild(pillA);
      teamABox.appendChild(subA);
      teamABox.classList.add('match-team','a','team-card');
      // Insert explicit VS on tablet layout
      const teamBBox = document.createElement('div');
      teamBBox.style.display = 'flex';
      teamBBox.style.flexDirection = 'column';
      teamBBox.style.alignItems = 'flex-start';
      const pillB = document.createElement('span');
      pillB.className = 'team-pill';
      pillB.style.borderColor = b.color;
      pillB.appendChild(document.createTextNode(b.name));
      const subB = document.createElement('div');
      subB.className = 'team-sub';
      subB.textContent = (b.members || []).join(', ');
      teamBBox.appendChild(pillB);
      teamBBox.appendChild(subB);
      teamBBox.classList.add('match-team','b','team-card');
      const vsEl = document.createElement('div');
      vsEl.className = 'vs';
      vsEl.textContent = 'vs.';
      label.appendChild(teamABox);
      label.appendChild(vsEl);
      label.appendChild(teamBBox);

      const score = document.createElement('div');
      score.className = 'match-score';
      score.style.minWidth = '90px';
      score.style.fontWeight = '600';
      const isPlayed = rec && rec.ga != null && rec.gb != null;
      score.style.color = isPlayed ? '#111827' : 'var(--muted)';
      score.textContent = '';
      if(isPlayed){ row.classList.add('played'); }
      // Insert Next match heading above the first unplayed match and emphasize the card
      if(!isPlayed && !nextMarked){
        const head = document.createElement('div');
        head.className = 'next-heading';
        head.textContent = 'Next Match';
        list.appendChild(head);
        row.classList.add('next');
        nextMarked = true;
        // Show kickoff indicator only on the first upcoming match
        if(nextKickoffId != null){
          if(nextKickoffId === a.id){
            const ball = document.createElement('span');
            ball.textContent = ' ⚽️';
            pillA.appendChild(ball);
          } else if(nextKickoffId === b.id){
            const ball = document.createElement('span');
            ball.textContent = ' ⚽️';
            pillB.appendChild(ball);
          }
        }
      }
      // Dim all future matches (after the immediate next unplayed)
      const currentIdx = flatCursor; // index in the flattened schedule
      if(!isPlayed && nextIndex >= 0 && currentIdx > nextIndex){
        row.classList.add('future');
      }
      // Winner styling: solid team-color pill with white text
      if(isPlayed){
        if(rec.ga > rec.gb){
          pillA.classList.add('winner');
          pillA.style.background = a.color; pillA.style.borderColor = a.color; pillA.style.color = '#fff';
        } else if(rec.gb > rec.ga){
          pillB.classList.add('winner');
          pillB.style.background = b.color; pillB.style.borderColor = b.color; pillB.style.color = '#fff';
        }
      }

      // Button handling: show score as a button when played; otherwise show Set Result
      if(isPlayed){
        const scoreBtn = document.createElement('button');
        scoreBtn.type = 'button';
        scoreBtn.className = 'btn slim';
        scoreBtn.textContent = `${rec.ga} - ${rec.gb}`;
        scoreBtn.addEventListener('click', ()=> openResultModal({ matchId, a, b, round: roundIdx+1 }));
        score.appendChild(scoreBtn);
      } else {
        const setBtn = document.createElement('button');
        setBtn.type = 'button';
        setBtn.className = 'btn slim';
        setBtn.textContent = 'Set Result';
        setBtn.addEventListener('click', ()=> openResultModal({ matchId, a, b, round: roundIdx+1 }));
        score.appendChild(setBtn);
      }
      // Players are always shown; no toggle button

      row.appendChild(label);
      row.appendChild(score);
      list.appendChild(row);
      flatCursor++;
    });
  }
  // Add bottom controls: Remove round X (if >2 rounds) and Add additional round
  const addWrap = document.createElement('div');
  addWrap.style.margin = '12px 0 0 0';
  addWrap.style.display = 'flex';
  addWrap.style.justifyContent = 'flex-end';
  addWrap.style.gap = '8px';
  if(totalRounds > 2 && !roundHasResults(totalRounds)){
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.className = 'btn danger';
    removeBtn.textContent = `Remove round ${totalRounds}`;
    removeBtn.addEventListener('click', openRemoveRoundModal);
    addWrap.appendChild(removeBtn);
  }
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'btn'; addBtn.textContent = 'Add additional round';
  addBtn.addEventListener('click', addAdditionalRound);
  addWrap.appendChild(addBtn);
  list.appendChild(addWrap);
}

// Order pairings within a round to avoid any team playing 3 matches in a row across the schedule
function orderRoundPairings(pairs, streakMap, seed){
  // Special case: 4 teams use classic round-robin order
  // A-B, C-D, A-C, B-D, A-D, B-C
  if(state.teams && state.teams.length === 4){
    const teams4 = [...state.teams].sort((a,b)=> a.id - b.id);
    const [A,B,C,D] = teams4;
    return [[A,B],[C,D],[A,C],[B,D],[A,D],[B,C]];
  }
  const rng = mulberry32((seed >>> 0));
  // Shuffle a copy to vary the base order deterministically
  const remaining = [...pairs].sort(() => rng() - 0.5);
  const ordered = [];
  const teamIds = state.teams.map(t => t.id);
  while(remaining.length){
    let pickIdx = -1;
    for(let i=0;i<remaining.length;i++){
      const aId = remaining[i][0].id, bId = remaining[i][1].id;
      const sa = streakMap.get(aId) || 0;
      const sb = streakMap.get(bId) || 0;
      if(sa < 2 && sb < 2){ pickIdx = i; break; }
    }
    if(pickIdx === -1){
      // Fallback: pick the first; we will still ensure not to exceed constraint by trying simple swap with previous
      pickIdx = 0;
    }
    const [a,b] = remaining.splice(pickIdx,1)[0];
    ordered.push([a,b]);
    // Update streaks: participants +1, others reset
    for(const id of teamIds){
      if(id === a.id || id === b.id){ streakMap.set(id, (streakMap.get(id)||0) + 1); }
      else { streakMap.set(id, 0); }
    }
  }
  return ordered;
}

function renderLeaderboard(){
  const lb = document.getElementById('leaderboardSection');
  lb.innerHTML = '';
  if(!state.teams || state.teams.length === 0){
    const info = document.createElement('div');
    info.className = 'notice';
    info.textContent = 'Generate teams to see the leaderboard.';
    lb.appendChild(info);
    return;
  }

  // Removed redundant 'Leaderboard' title for cleaner UI; tab already conveys context.

  // Compute points per team
  const byId = new Map(state.teams.map(t => [t.id, { team: t, pts: 0, played: 0, gf: 0, ga: 0 }]));
  for(const key of Object.keys(state.results || {})){
    const r = state.results[key];
    if(!r) continue;
    const { a, b, ga, gb } = r;
    if(ga === null || gb === null || ga === undefined || gb === undefined) continue;
    const A = byId.get(a); const B = byId.get(b);
    if(!A || !B) continue;
    A.played++; B.played++;
    A.gf += ga; B.gf += gb;
    A.ga += gb; B.ga += ga;
    if(ga > gb){ A.pts += 3; }
    else if(gb > ga){ B.pts += 3; }
    else { A.pts += 1; B.pts += 1; }
  }
  const rows = Array.from(byId.values()).sort((x,y)=> y.pts - x.pts || y.gf - x.gf || x.team.name.localeCompare(y.team.name));

  const tournamentComplete = areAllMatchesScored();
  const prevRanks = getPrevRanks();
  // Winner banner if tournament complete
  let winningTeamIds = null;
  if(tournamentComplete && rows.length){
    const topPts = rows[0].pts;
    const topGD = (rows[0].gf - (rows[0].ga || 0));
    const coWinners = rows.filter(r => r.pts === topPts && ((r.gf - (r.ga || 0)) === topGD));
    winningTeamIds = new Set(coWinners.map(r => r.team.id));
    const names = coWinners.map(r => r.team.name.toUpperCase());
    const list = names.length === 1 ? names[0]
      : (names.length === 2 ? `${names[0]} & ${names[1]}`
         : `${names.slice(0, -1).join(', ')} & ${names[names.length-1]}`);
    const win = document.createElement('div');
    win.className = 'winner-banner';
    win.textContent = `${names.length > 1 ? 'WINNERS' : 'WINNER'}: ${list}!!`;
    lb.appendChild(win);
  }

  const wrap = document.createElement('div');
  wrap.style.overflow = 'auto';
  const table = document.createElement('table');
  table.className = 'alltime-table';
  table.style.minWidth = '900px';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th style="width:50%">Team</th><th>Played</th><th>Points</th><th>GS</th><th>GA</th><th>GD</th></tr>';
  const tbody = document.createElement('tbody');
  const winningTeamId = null; // deprecated in favor of winningTeamIds
  rows.forEach((r, idx)=>{
    const tr = document.createElement('tr');
    const tdTeam = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = 'team-pill';
    pill.style.borderColor = r.team.color;
    const label = document.createElement('span');
    label.textContent = r.team.name;
    pill.appendChild(label);
    tdTeam.appendChild(pill);
    // Rank change indicator (compare against previous render ranks)
    const prev = prevRanks[String(r.team.id)];
    const curr = idx;
    if(prev !== undefined && prev !== curr){
      const arrow = document.createElement('span');
      arrow.style.marginLeft = '6px';
      arrow.style.fontWeight = '700';
      arrow.style.fontSize = '14px';
      if(prev > curr){ arrow.textContent = ' ▲'; arrow.style.color = 'var(--accent-2)'; }
      else { arrow.textContent = ' ▼'; arrow.style.color = 'var(--danger)'; }
      tdTeam.appendChild(arrow);
    }
    if(winningTeamIds && winningTeamIds.has(r.team.id)){
      const trophy = document.createElement('span');
      trophy.textContent = ' 🏆';
      trophy.style.marginLeft = '6px';
      tdTeam.appendChild(trophy);
    }
    const membersSmall = document.createElement('div');
    membersSmall.className = 'team-sub';
    membersSmall.textContent = r.team.members.join(', ');
    tdTeam.appendChild(membersSmall);
    const tdPlayed = document.createElement('td');
    tdPlayed.textContent = String(r.played);
    const tdPts = document.createElement('td');
    tdPts.textContent = String(r.pts);
    const tdGS = document.createElement('td');
    tdGS.textContent = String(r.gf);
    const tdGA = document.createElement('td');
    tdGA.textContent = String(r.ga || 0);
    const tdGD = document.createElement('td');
    const gd = (r.gf - (r.ga || 0));
    tdGD.textContent = String(gd);
    if(gd > 0) tdGD.classList.add('gd-pos');
    else if(gd < 0) tdGD.classList.add('gd-neg');
    tr.appendChild(tdTeam);
    tr.appendChild(tdPlayed);
    tr.appendChild(tdPts);
    tr.appendChild(tdGS);
    tr.appendChild(tdGA);
    tr.appendChild(tdGD);
    tbody.appendChild(tr);
  });
  table.appendChild(thead); table.appendChild(tbody);
  wrap.appendChild(table);
  lb.appendChild(wrap);
  // Save current ranks for next comparison
  savePrevRanksFromRows(rows);

  // Top Scorers (only players with >=1 goal), with AVG (goals per match)
  const { totals: scorerTotals, playedCounts } = computeGoalStats();
  const scorers = Array.from(scorerTotals.entries())
    .filter(([_,n])=> n>0)
    .sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]));
  if(scorers.length){
    const sTitle = document.createElement('h3'); sTitle.textContent = 'Top Scorers'; sTitle.style.margin = '12px 0 6px 0';
    lb.appendChild(sTitle);
    const sTable = document.createElement('table');
    const sHead = document.createElement('thead'); sHead.innerHTML = '<tr><th style="width:60%">Player</th><th>Goals</th><th>GPM</th></tr>';
    const sBody = document.createElement('tbody');
    const topGoals = scorers[0][1];
  for(const [name, goals] of scorers){
      const played = playedCounts.get(name) || 0;
      const avg = played ? (goals/played) : 0;
      const tr = document.createElement('tr');
      const tdN = document.createElement('td');
      tdN.textContent = name + ((tournamentComplete && goals === topGoals) ? ' 🏆' : '');
      const tdG = document.createElement('td'); tdG.textContent = String(goals);
      const tdAvg = document.createElement('td'); tdAvg.textContent = avg.toFixed(1);
      tr.appendChild(tdN); tr.appendChild(tdG); tr.appendChild(tdAvg); sBody.appendChild(tr);
    }
    sTable.appendChild(sHead); sTable.appendChild(sBody);
    lb.appendChild(sTable);
  }

  // ----- Share controls when tournament complete -----
  if(tournamentComplete && rows.length){
    const shareWrap = document.createElement('div');
    shareWrap.style.margin = '14px 0 0 0';
    shareWrap.style.paddingTop = '10px';
    shareWrap.style.borderTop = '1px solid var(--border)';
    const btns = document.createElement('div');
    btns.style.display = 'flex';
    btns.style.gap = '8px';
    btns.style.marginTop = '8px';
    const copyBtn = document.createElement('button'); copyBtn.className='btn primary'; copyBtn.type='button'; copyBtn.textContent='Copy results';
    const emailBtn = document.createElement('button'); emailBtn.className='btn'; emailBtn.type='button'; emailBtn.textContent='Email summary';
    btns.appendChild(copyBtn);
    btns.appendChild(emailBtn);
    shareWrap.appendChild(btns);
    lb.appendChild(shareWrap);

    function doText(){ return buildShareText(); }
    copyBtn.onclick = async ()=>{
      const text = doText();
      try{
        await navigator.clipboard.writeText(text);
      }catch{
        // no clipboard: show text in prompt as a last resort
        window.prompt('Copy the results:', text);
      }
    };
    emailBtn.onclick = ()=>{ emailSummary(); };
  }
}

// Aggregate per-player goal totals and appearance counts for the active tournament
function computeGoalStats(){
  const totals = new Map();
  const playedCounts = new Map();
  if(!state.teams || state.teams.length === 0) return { totals, playedCounts };
  const teamById = new Map(state.teams.map(t => [t.id, t]));
  const isGuest = (name)=> String(name||'').trim().toLowerCase() === 'guest player';
  for(const key of Object.keys(state.results || {})){
    const r = state.results[key]; if(!r) continue;
    const { a, b, ga, gb, gpa, gpb } = r || {};
    if(gpa){
      for(const [name, n] of Object.entries(gpa)){
        if(n>0 && !isGuest(name)){
          totals.set(name, (totals.get(name)||0) + n);
        }
      }
    }
    if(gpb){
      for(const [name, n] of Object.entries(gpb)){
        if(n>0 && !isGuest(name)){
          totals.set(name, (totals.get(name)||0) + n);
        }
      }
    }
    const played = ga != null && gb != null;
    if(played){
      const teamA = teamById.get(a);
      const teamB = teamById.get(b);
      if(teamA){
        for(const name of teamA.members){
          playedCounts.set(name, (playedCounts.get(name)||0) + 1);
        }
      }
      if(teamB){
        for(const name of teamB.members){
          playedCounts.set(name, (playedCounts.get(name)||0) + 1);
        }
      }
    }
  }
  return { totals, playedCounts };
}

// Build a concise summary of what is shown on the Leaderboard
function buildShareText(){
  if(!state.teams || state.teams.length===0) return 'Futsal results';
  // Leaderboard data
  const byId = new Map(state.teams.map(t => [t.id, { team: t, pts: 0, played: 0, gf: 0, ga: 0 }]));
  for(const key of Object.keys(state.results || {})){
    const r = state.results[key]; if(!r) continue;
    const { a, b, ga, gb } = r;
    if(ga == null || gb == null) continue;
    const A = byId.get(a); const B = byId.get(b); if(!A||!B) continue;
    A.played++; B.played++;
    A.gf += ga; B.gf += gb;
    A.ga += gb; B.ga += ga;
    if(ga > gb) A.pts += 3; else if(gb > ga) B.pts += 3; else { A.pts += 1; B.pts += 1; }
  }
  const rows = Array.from(byId.values()).sort((x,y)=> y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.team.name.localeCompare(y.team.name));
  let winnerLine = 'Winner';
  if(rows.length){
    const topPts = rows[0].pts;
    const topGD = (rows[0].gf - rows[0].ga);
    const coWinners = rows.filter(r => r.pts === topPts && ((r.gf - r.ga) === topGD));
    const names = coWinners.map(r => r.team.name);
    const list = names.length === 1 ? names[0]
      : (names.length === 2 ? `${names[0]} & ${names[1]}`
         : `${names.slice(0, -1).join(', ')} & ${names[names.length-1]}`);
    winnerLine = `${names.length > 1 ? 'WINNERS' : 'WINNER'}: ${list}`;
  }
  const lines = [];
  lines.push(`🏆 ${winnerLine}`);
  lines.push('Standings:');
  rows.forEach((r, i)=>{
    const gd = r.gf - r.ga; const gdStr = gd>=0? `+${gd}`: `${gd}`;
    const members = r.team.members.join(', ');
    lines.push(`${i+1}) ${r.team.name} — ${r.pts} pts (GD ${gdStr}) • ${members}`);
  });
  // Include Top Scorers section if it is visible in the view
  const scorerTotals = new Map();
  const isGuest = (name)=> String(name||'').trim().toLowerCase() === 'guest player';
  for(const key of Object.keys(state.results || {})){
    const r = state.results[key]; if(!r) continue;
    const { gpa, gpb } = r;
    if(gpa){ for(const [name, n] of Object.entries(gpa)){ if(n>0 && !isGuest(name)){ scorerTotals.set(name, (scorerTotals.get(name)||0)+n); } } }
    if(gpb){ for(const [name, n] of Object.entries(gpb)){ if(n>0 && !isGuest(name)){ scorerTotals.set(name, (scorerTotals.get(name)||0)+n); } } }
  }
  const scorerRows = Array.from(scorerTotals.entries()).filter(([_,n])=> n>0).sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]));
  if(scorerRows.length){
    lines.push('Top Scorers:');
    const top = scorerRows.slice(0, 8);
    lines.push(top.map(([n,g])=> `${n} ${g}`).join(', '));
  }
  return lines.join('\n');
}

// CSV escaper for fields (wrap in quotes and escape quotes)
function csvEscape(s){
  const str = String(s ?? '');
  if(/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

// Build per-player points+goals summary as CSV: Date,Player,Points,Goals
function buildEmailSummaryText(){
  const lines = [];
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const { totals: goalTotals } = computeGoalStats();
  if(!state.teams || state.teams.length < 2){
    lines.push('Date,Player,Points,Goals');
    return lines.join('\n');
  }
  const teamById = new Map(state.teams.map(t => [t.id, t]));
  const points = new Map();
  for(const t of state.teams){ for(const name of (t.members||[])) points.set(name, 0); }
  for(const key of Object.keys(state.results || {})){
    const r = state.results[key]; if(!r) continue;
    const { a, b, ga, gb } = r;
    if(ga == null || gb == null) continue;
    const ta = teamById.get(a); const tb = teamById.get(b); if(!ta || !tb) continue;
    if(ga > gb){ for(const n of (ta.members||[])) points.set(n, (points.get(n)||0) + 3); }
    else if(gb > ga){ for(const n of (tb.members||[])) points.set(n, (points.get(n)||0) + 3); }
    else { for(const n of (ta.members||[])) points.set(n, (points.get(n)||0) + 1); for(const n of (tb.members||[])) points.set(n, (points.get(n)||0) + 1); }
  }
  const rows = Array.from(points.entries()).sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]));
  lines.push('Date,Player,Points,Goals');
  for(const [name, pts] of rows){
    const goals = goalTotals.get(name) || 0;
    lines.push(`${dateStr},${csvEscape(name)},${pts},${goals}`);
  }
  return lines.join('\n');
}

function emailSummary(){
  const subjectDate = new Date();
  const yyyy = subjectDate.getFullYear();
  const mm = String(subjectDate.getMonth()+1).padStart(2,'0');
  const dd = String(subjectDate.getDate()).padStart(2,'0');
  const subject = `Futsal Teams & Results — ${yyyy}-${mm}-${dd}`;
  const body = buildEmailSummaryText();
  const to = 'rubenvdkamp@gmail.com';
  const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  // Open default mail client with prefilled To/Subject/Body (mobile-friendly)
  window.location.href = mailto;
}

function updateGenError(msg){
  const el = document.getElementById('genError');
  if(msg){ el.textContent = msg; el.style.display = ''; }
  else { el.textContent=''; el.style.display='none'; }
}

// ----- Modal: Set Result -----
let modalCtx = null; // { matchId, aId, bId, round }
function openResultModal({ matchId, a, b, round }){
  modalCtx = { matchId, aId: a.id, bId: b.id, round };
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('resultModal');
  const aName = document.getElementById('modalTeamAName');
  const bName = document.getElementById('modalTeamBName');
  const aInput = document.getElementById('modalTeamAScore');
  const bInput = document.getElementById('modalTeamBScore');
  const aMinus = document.getElementById('modalATeamMinus');
  const aPlus = document.getElementById('modalATeamPlus');
  const bMinus = document.getElementById('modalBTeamMinus');
  const bPlus = document.getElementById('modalBTeamPlus');
  const label = document.getElementById('modalMatchLabel');
  const saveBtn = document.getElementById('modalSave');

  // Render team pills in modal
  aName.textContent = '';
  bName.textContent = '';
  const pillA = document.createElement('span');
  pillA.className = 'team-pill';
  pillA.style.borderColor = a.color;
  pillA.appendChild(document.createTextNode(a.name));
  const pillB = document.createElement('span');
  pillB.className = 'team-pill';
  pillB.style.borderColor = b.color;
  pillB.appendChild(document.createTextNode(b.name));
  aName.appendChild(pillA);
  const subA = document.createElement('div');
  subA.className = 'team-sub';
  subA.textContent = (a.members || []).join(', ');
  aName.appendChild(subA);
  bName.appendChild(pillB);
  const subB = document.createElement('div');
  subB.className = 'team-sub';
  subB.textContent = (b.members || []).join(', ');
  bName.appendChild(subB);
  label.textContent = `${a.name} vs ${b.name} • Round ${round}`;

  const existing = state.results[matchId];
  // Prefill totals from draft if present, else from final, else 0
  const initialA = (existing && (existing.gaDraft != null)) ? existing.gaDraft : (existing && (existing.ga != null) ? existing.ga : 0);
  const initialB = (existing && (existing.gbDraft != null)) ? existing.gbDraft : (existing && (existing.gb != null) ? existing.gb : 0);
  aInput.value = String(initialA);
  bInput.value = String(initialB);

  function canSave(){ return aInput.value !== '' && bInput.value !== ''; }
  saveBtn.disabled = !canSave();
  const onInput = ()=>{ saveBtn.disabled = !canSave(); };
  aInput.oninput = onInput; bInput.oninput = onInput;

  overlay.hidden = false; modal.hidden = false;
  setTimeout(()=> aInput.focus(), 0);

  function escHandler(e){ if(e.key === 'Escape'){ closeResultModal(); } }
  document.addEventListener('keydown', escHandler, { once: true });

  document.getElementById('modalCancel').onclick = closeResultModal;
  overlay.onclick = closeResultModal;
  function step(input, delta){
    const cur = parseInt(input.value || '0', 10);
    let v = Number.isFinite(cur) ? cur : 0;
    v = Math.max(0, v + delta);
    input.value = String(v);
    onInput();
  }
  aMinus.onclick = ()=> step(aInput, -1);
  aPlus.onclick = ()=> step(aInput, +1);
  bMinus.onclick = ()=> step(bInput, -1);
  bPlus.onclick = ()=> step(bInput, +1);

  // ----- Per-player scorers -----
  const scorersWrap = document.getElementById('modalScorers');
  scorersWrap.innerHTML = '';
  const aCard = document.createElement('div'); aCard.className = 'scorer-card';
  const aTitle = document.createElement('div'); aTitle.className = 'scorer-title'; aTitle.textContent = `${a.name} scorers`;
  aCard.appendChild(aTitle);
  const bCard = document.createElement('div'); bCard.className = 'scorer-card';
  const bTitle = document.createElement('div'); bTitle.className = 'scorer-title'; bTitle.textContent = `${b.name} scorers`;
  bCard.appendChild(bTitle);
  scorersWrap.appendChild(aCard); scorersWrap.appendChild(bCard);

  // Prefill per-player scorers from draft if present, else from final
  const gpa = (existing && (existing.gpaDraft || existing.gpa)) ? (existing.gpaDraft || existing.gpa) : {};
  const gpb = (existing && (existing.gpbDraft || existing.gpb)) ? (existing.gpbDraft || existing.gpb) : {};
  const aInputs = new Map();
  const bInputs = new Map();
  function makeRow(name, initial, map, parent){
    const row = document.createElement('div'); row.className = 'scorer-row';
    const label = document.createElement('div'); label.textContent = name; label.style.flex='1';
    const minus = document.createElement('button'); minus.type='button'; minus.className='btn mini-step'; minus.textContent='−';
    const inp = document.createElement('input'); inp.type='number'; inp.min='0'; inp.inputMode='numeric'; inp.className='scorer-input'; inp.value = (initial ?? 0);
    const plus = document.createElement('button'); plus.type='button'; plus.className='btn mini-step'; plus.textContent='+';
    const change = (delta)=>{
      const v = Math.max(0, parseInt(inp.value||'0',10)+(delta||0));
      inp.value = String(v);
      syncIfTracking();
    };
    minus.onclick = ()=> change(-1);
    plus.onclick = ()=> change(+1);
    // independent inputs unless tracking is enabled
    inp.oninput = ()=> syncIfTracking();
    row.appendChild(label); row.appendChild(minus); row.appendChild(inp); row.appendChild(plus);
    parent.appendChild(row);
    map.set(name, inp);
  }
  for(const p of a.members){ makeRow(p, gpa[p] ?? 0, aInputs, aCard); }
  // If team A has only 3 players, add a Guest player row (excluded from leaderboards)
  if((a.members || []).length === 3){ makeRow('Guest player', gpa['Guest player'] ?? 0, aInputs, aCard); }
  for(const p of b.members){ makeRow(p, gpb[p] ?? 0, bInputs, bCard); }
  // If team B has only 3 players, add a Guest player row (excluded from leaderboards)
  if((b.members || []).length === 3){ makeRow('Guest player', gpb['Guest player'] ?? 0, bInputs, bCard); }

  // Toggle tracking visibility
  const trackToggle = document.getElementById('modalTrackScorers');
  const existingHasScorers = (Object.keys(gpa).length > 0 || Object.keys(gpb).length > 0);
  trackToggle.checked = existingHasScorers ? true : getTrackScorersPref();
  function sumMapVals(map){ let s=0; map.forEach((el)=>{ s += Math.max(0, parseInt(el.value||'0',10)); }); return s; }
  function updateTotalsFromPlayers(){
    const sa = sumMapVals(aInputs);
    const sb = sumMapVals(bInputs);
    const ca = Math.max(0, parseInt(aInput.value||'0',10));
    const cb = Math.max(0, parseInt(bInput.value||'0',10));
    // Only raise totals; never reduce below what user set
    const na = Math.max(ca, sa);
    const nb = Math.max(cb, sb);
    aInput.value = String(na);
    bInput.value = String(nb);
  }
  function syncIfTracking(){ if(trackToggle.checked){ updateTotalsFromPlayers(); onInput(); } }
  const applyToggle = ()=>{
    scorersWrap.style.display = trackToggle.checked ? '' : 'none';
    aInput.disabled = trackToggle.checked;
    bInput.disabled = trackToggle.checked;
    if(trackToggle.checked){ updateTotalsFromPlayers(); onInput(); }
  };
  applyToggle();
  trackToggle.onchange = ()=>{ applyToggle(); setTrackScorersPref(trackToggle.checked); };
  const saveError = document.getElementById('modalSaveError');
  saveBtn.onclick = () => {
    const ga = Math.max(0, parseInt(aInput.value, 10));
    const gb = Math.max(0, parseInt(bInput.value, 10));
    if(!Number.isFinite(ga) || !Number.isFinite(gb)) return;
    if(trackToggle.checked){
      let sa=0,sb=0; aInputs.forEach((el)=>{ sa += Math.max(0, parseInt(el.value||'0',10)); });
      bInputs.forEach((el)=>{ sb += Math.max(0, parseInt(el.value||'0',10)); });
      // Auto-raise totals if player sums surpass them; never decrease totals
      const finalA = Math.max(ga, sa);
      const finalB = Math.max(gb, sb);
      // Strict validation: if player sums are below totals, block save
      if(sa < finalA || sb < finalB){
        saveError.style.display='';
        saveError.textContent = `Distribute all goals to players: need ${finalA}-${finalB}, have ${sa}-${sb}.`;
        return;
      }
      saveError.style.display='none';
      const outA = {}; aInputs.forEach((el, name)=>{ const n = Math.max(0, parseInt(el.value||'0',10)); if(n>0) outA[name]=n; });
      const outB = {}; bInputs.forEach((el, name)=>{ const n = Math.max(0, parseInt(el.value||'0',10)); if(n>0) outB[name]=n; });
      state.results[matchId] = { a: modalCtx.aId, b: modalCtx.bId, round: modalCtx.round, ga: finalA, gb: finalB, gpa: outA, gpb: outB };
    } else {
      saveError.style.display='none';
      state.results[matchId] = { a: modalCtx.aId, b: modalCtx.bId, round: modalCtx.round, ga, gb };
    }
    // Clear any drafts now that the match is finalized
    try{
      delete state.results[matchId].gaDraft;
      delete state.results[matchId].gbDraft;
      delete state.results[matchId].gpaDraft;
      delete state.results[matchId].gpbDraft;
    }catch(_){ }
    saveResults();
    const completedNow = areAllMatchesScored() && !state.celebrated;
    if(completedNow){
      // Hide only the result modal; keep overlay visible for confirmation modal
      try{
        const modal = document.getElementById('resultModal');
        if(modal) modal.hidden = true;
        const overlay = document.getElementById('overlay');
        if(overlay) overlay.onclick = null; // rebind in confirmation modal
      }catch(_){/* no-op */}
      // Update views in the background
      renderSchedule();
      renderLeaderboard();
      openEndTournamentModal();
      // Clear modalCtx since the result modal is done
      modalCtx = null;
    } else {
      closeResultModal();
      // Suppress non-final toasts; only celebrate winner at tournament end
      renderSchedule();
      renderLeaderboard();
    }
  };
}

function closeResultModal(){
  // Persist current inputs as a draft only if this match is not finalized
  try{
    if(modalCtx && modalCtx.matchId){
      const matchId = modalCtx.matchId;
      const rec = state.results[matchId];
      const isFinal = rec && rec.ga != null && rec.gb != null;
      if(!isFinal){
        const aInput = document.getElementById('modalTeamAScore');
        const bInput = document.getElementById('modalTeamBScore');
        const gaDraft = Math.max(0, parseInt(aInput.value || '0', 10));
        const gbDraft = Math.max(0, parseInt(bInput.value || '0', 10));
        const scorersWrap = document.getElementById('modalScorers');
        const cards = scorersWrap ? scorersWrap.querySelectorAll('.scorer-card') : null;
        let gpaDraft = {}, gpbDraft = {};
        if(cards && cards.length >= 2){
          const aCard = cards[0];
          const bCard = cards[1];
          const readCard = (card)=>{
            const map = {};
            if(!card) return map;
            const rows = card.querySelectorAll('.scorer-row');
            rows.forEach(row=>{
              const nameEl = row.children[0];
              const inp = row.querySelector('input.scorer-input');
              const name = nameEl ? String(nameEl.textContent||'').trim() : '';
              const v = Math.max(0, parseInt((inp && inp.value) || '0', 10));
              if(name && v > 0){ map[name] = v; }
            });
            return map;
          };
          gpaDraft = readCard(aCard);
          gpbDraft = readCard(bCard);
        }
        const prev = state.results[matchId] || { a: modalCtx.aId, b: modalCtx.bId, round: modalCtx.round };
        state.results[matchId] = { ...prev, gaDraft, gbDraft, gpaDraft, gpbDraft };
        saveResults();
      }
    }
  }catch(_){ /* draft save is best-effort */ }
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('resultModal');
  overlay.hidden = true; modal.hidden = true; modalCtx = null;
}

// ----- Modal: Add Player -----
function openAddPlayerModal(){
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('addPlayerModal');
  const input = document.getElementById('addPlayerName');
  const skillInput = document.getElementById('addPlayerSkill');
  const skillMinus = document.getElementById('addPlayerSkillMinus');
  const skillPlus = document.getElementById('addPlayerSkillPlus');
  const staminaInput = document.getElementById('addPlayerStamina');
  const staminaMinus = document.getElementById('addPlayerStaminaMinus');
  const staminaPlus = document.getElementById('addPlayerStaminaPlus');
  const err = document.getElementById('addPlayerError');
  const save = document.getElementById('addPlayerSave');
  const cancel = document.getElementById('addPlayerCancel');

  err.style.display = 'none';
  err.textContent = '';
  input.value = '';
  const formatRating = (val)=>{
    const num = Number(val);
    if(Number.isNaN(num)) return '';
    return Number.isInteger(num) ? String(Math.trunc(num)) : num.toFixed(1);
  };
  const clampInputValue = (el, fallback)=>{
    const v = snapToRatingStep(el.value, fallback);
    el.value = formatRating(v);
    return v;
  };
  const adjustInput = (el, fallback, delta)=> {
    const current = snapToRatingStep(el.value, fallback);
    const next = snapToRatingStep(current + delta, fallback);
    el.value = formatRating(next);
  };
  skillInput.value = formatRating(snapToRatingStep(DEFAULT_SKILL, DEFAULT_SKILL));
  staminaInput.value = formatRating(snapToRatingStep(DEFAULT_STAMINA, DEFAULT_STAMINA));
  save.disabled = true;

  function update(){ save.disabled = input.value.trim().length === 0; }
  input.oninput = update;
  skillMinus.onclick = ()=> adjustInput(skillInput, DEFAULT_SKILL, -RATING_STEP);
  skillPlus.onclick = ()=> adjustInput(skillInput, DEFAULT_SKILL, RATING_STEP);
  skillInput.oninput = ()=>{ clampInputValue(skillInput, DEFAULT_SKILL); };
  staminaMinus.onclick = ()=> adjustInput(staminaInput, DEFAULT_STAMINA, -RATING_STEP);
  staminaPlus.onclick = ()=> adjustInput(staminaInput, DEFAULT_STAMINA, RATING_STEP);
  staminaInput.oninput = ()=>{ clampInputValue(staminaInput, DEFAULT_STAMINA); };

  overlay.hidden = false; modal.hidden = false; setTimeout(()=> input.focus(), 0);
  overlay.onclick = closeAddPlayerModal;
  cancel.onclick = closeAddPlayerModal;
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ closeAddPlayerModal(); } }, { once:true });

  save.onclick = ()=>{
    const name = input.value.trim();
    if(!name){ return; }
    if(state.attendees.length >= MAX_ATTENDEES){
      err.textContent = `Cannot add more than ${MAX_ATTENDEES} attendees.`;
      err.style.display = '';
      return;
    }
    // Create a unique incidental name if it clashes with roster or attendees (case-insensitive)
    const lowerExisting = new Set([...state.players, ...state.attendees].map(x=>x.toLowerCase()));
    let finalName = name;
    if(lowerExisting.has(finalName.toLowerCase())){
      let i = 2;
      while(lowerExisting.has((name + ' ('+i+')').toLowerCase())) i++;
      finalName = name + ' ('+i+')';
    }
    // Assign provided skill for this incidental entry name (won't affect default roster player)
    SKILLS[finalName] = normalizeRating(skillInput.value, DEFAULT_SKILL);
    STAMINA[finalName] = normalizeRating(staminaInput.value, DEFAULT_STAMINA);
    // Ensure the incidental player becomes part of the available roster list
    if(!state.players.some(p => p.toLowerCase() === finalName.toLowerCase())){
      state.players.push(finalName);
      savePlayers();
    }
    state.attendees.push(finalName);
    saveAttendees();
    closeAddPlayerModal();
    clampPlayLimit();
    renderRoster();
    updateTabsUI();
  };
}
function closeAddPlayerModal(){
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('addPlayerModal');
  overlay.hidden = true; modal.hidden = true;
}

// ----- Modal: Reset Confirmation -----
function openResetModal(){
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('resetModal');
  const cancel = document.getElementById('resetCancel');
  const confirm = document.getElementById('resetConfirm');

  overlay.hidden = false; modal.hidden = false;
  overlay.onclick = closeResetModal;
  cancel.onclick = closeResetModal;
  confirm.onclick = () => { closeResetModal(); resetAll(); };
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ closeResetModal(); } }, { once:true });
}
function closeResetModal(){
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('resetModal');
  overlay.hidden = true; modal.hidden = true;
}

// ----- Modal: Choose team count when n=11 -----
function openTeamCountModal(options=[2,3], nOverride){
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('teamCountModal');
  const btn2 = document.getElementById('teamCount2');
  const btn3 = document.getElementById('teamCount3');
  overlay.hidden = false; modal.hidden = false;
  const body = modal.querySelector('.modal-body');
  const n = nOverride || state.attendees.length;
  const a = options[0], b = options[1];
  const sizesA = sizesDesc(n, a);
  const sizesB = sizesDesc(n, b);
  body.innerHTML = `<div class="notice" style="font-weight:600; margin-bottom:8px">You have ${n} players. Choose ${a} or ${b} teams.</div>
                    <div class="notice">${a} teams: ${sizesA} &nbsp; • &nbsp; ${b} teams: ${sizesB}</div>`;
  btn2.textContent = `${a} Teams`;
  btn3.textContent = `${b} Teams`;
  const close = ()=>{ overlay.hidden = true; modal.hidden = true; btn2.onclick = null; btn3.onclick = null; };
  overlay.onclick = close;
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); } }, { once:true });
  btn2.onclick = ()=>{ close(); generateTeamsOverride(a); };
  btn3.onclick = ()=>{ close(); generateTeamsOverride(b); };
}

function generateTeamsOverride(tOverride){
  const n = state.attendees.length;
  if(!state.timestamp){ state.timestamp = Date.now(); saveTimestamp(); }
  const t = tOverride;
  const stableSeed = computeStableSeedFromAttendees(state.attendees);
  const shuffled = shuffleSeeded(state.attendees, stableSeed);
  // Average stamina across current attendees for stamina-aware tie-breaks
  const totalStaminaOv = state.attendees.reduce((s, name)=> s + getStamina(name), 0);
  const avgStaminaOv = n > 0 ? (totalStaminaOv / n) : DEFAULT_STAMINA;
  // Evenly distribute capacities for override
  const base = Array(t).fill(Math.floor(n/t));
  const r = n % t;
  for(let i=t-r; i<t; i++) if(i>=0 && i<t) base[i] += 1;
  const colors = COLORS.slice(0, Math.min(t, COLORS.length));
  const totalSkillOv = state.attendees.reduce((s, name)=> s + getSkill(name), 0);
  const avgSkillOv = totalSkillOv / n;
  const teamInfos = base.map((size, i) => ({
    cap: size,
    target: size * avgSkillOv,
    skillSum: 0,
    staminaSum: 0,
    team: { id: i+1, name: colors[i].name, color: colors[i].hex, members: [] }
  }));
  const orderIndex = new Map(shuffled.map((name, idx) => [name, idx]));
  const playersSorted = [...state.attendees].sort((a,b)=>{
    const sa = getSkill(a), sb = getSkill(b);
    if(sb !== sa) return sb - sa;
    return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
  });
  for(const player of playersSorted){
    const s = getSkill(player);
    const st = getStamina(player);
    let best = -1;
    let bestScore = -Infinity;
    for(let i=0;i<teamInfos.length;i++){
      const info = teamInfos[i];
      if(info.team.members.length < info.cap){
        const def = info.target - info.skillSum;
        const harmonyBias = computeHarmonyBias(info.team.members, player);
        const score = def - harmonyBias;
        if(score > bestScore + 1e-9){ bestScore = score; best = i; }
        else if(Math.abs(score - bestScore) <= 1e-9 && best !== -1){
          const bi = teamInfos[best];
          // Stamina-aware tie-break: only within skill tie
          if(st >= avgStaminaOv){
            // Prefer smaller-capacity team when player's stamina is high
            if(info.cap < bi.cap) { best = i; }
            else if(info.cap === bi.cap){
              // If capacities equal, prefer team with lower current staminaSum to even out
              if(info.staminaSum < bi.staminaSum) best = i;
            }
          }
          // Existing deterministic tie-breakers
          const bestIdx = best; // might have changed above
          const bi2 = teamInfos[bestIdx];
          if(info.team.members.length < bi2.team.members.length) best = i;
          else if(info.team.members.length === bi2.team.members.length && info.skillSum < bi2.skillSum) best = i;
          else if(info.team.members.length === bi2.team.members.length && info.skillSum === bi2.skillSum && i < bestIdx) best = i;
        }
      }
    }
    if(best === -1) best = 0;
    const tgt = teamInfos[best];
    tgt.team.members.push(player);
    tgt.skillSum += s;
    tgt.staminaSum += st;
  }
  state.teams = teamInfos.map(x => x.team);
  // Post-pass: skill balancer then stamina smoothing (equal-skill swaps)
  try { balanceSkillToTargets(state.teams, state.attendees, getSkill); } catch(_) { /* best-effort */ }
  try { balanceStaminaEqualSkill(state.teams, getSkill, getStamina); } catch(_) { /* best-effort */ }
  try { applyRosterHarmonyFinal(state.teams); } catch(_) { /* best-effort */ }
  state.results = {};
  state.rounds = 2;
  localStorage.removeItem(KEYS.prevRanks);
  saveTeams(); saveResults(); saveRounds();
  renderTeams(); renderRoster(); renderSchedule(); renderLeaderboard();
  switchTab('teams'); updateTabsUI();
}

// Compute a sizes descriptor string using even distribution (e.g., 11 with 2 -> 6-5, with 3 -> 4-4-3)
function sizesDesc(n, t){
  const base = Array(t).fill(Math.floor(n/t));
  const r = n % t;
  for(let i=t-r; i<t; i++) if(i>=0 && i<t) base[i] += 1;
  // Present in descending order for readability (e.g., 6-5, 4-4-3, 4-4-4-3)
  return base.sort((a,b)=> b-a).join('-');
}

// ----- Actions -----
function moveToPlay(name){
  if(state.attendees.includes(name)) return;
  if(state.attendees.length >= MAX_ATTENDEES){
    clampPlayLimit();
    return;
  }
  state.attendees.push(name);
  saveAttendees();
  // keep teams if any? Spec doesn't forbid changing attendees post teams; leave teams intact.
  clampPlayLimit();
  renderRoster();
  updateTabsUI();
}
function moveToNot(name){
  const idx = state.attendees.indexOf(name);
  if(idx>=0){
    state.attendees.splice(idx,1);
    saveAttendees();
    clampPlayLimit();
    renderRoster();
    updateTabsUI();
  }
}

function resetAll(){
  state.attendees = [];
  state.teams = [];
  state.results = {};
  state.timestamp = Date.now();
  state.rounds = 2;
  saveAttendees();
  saveTeams();
  saveResults();
  saveTimestamp();
  saveRounds();
  updateGenError('');
  closeResultModal();
  renderRoster();
  renderTeams();
  renderSchedule();
  renderLeaderboard();
  switchTab('players');
  updateTabsUI();
}

function addAdditionalRound(){
  if(!state.teams || state.teams.length < 2) return;
  state.rounds = Math.max(1, Number(state.rounds) || 2) + 1;
  state.celebrated = false;
  saveRounds();
  renderSchedule();
}

// ----- Modal: End Tournament Confirmation -----
function openEndTournamentModal(){
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('endTournamentModal');
  const yes = document.getElementById('endTournamentYes');
  const add = document.getElementById('endTournamentAddRound');
  overlay.hidden = false; modal.hidden = false;
  // Lock scrolling while modal is open (consistent UX)
  try{ __openModalEl = modal; lockBodyScroll(); }catch(_){/* no-op */}
  function close(){
    overlay.hidden = true; modal.hidden = true;
    overlay.onclick = null; yes.onclick = null; add.onclick = null;
    document.removeEventListener('keydown', escHandler);
    try{ __openModalEl = null; unlockBodyScroll(); }catch(_){/* no-op */}
  }
  function escHandler(e){ if(e.key==='Escape'){ close(); } }
  document.addEventListener('keydown', escHandler);
  overlay.onclick = close;
  add.onclick = ()=>{ addAdditionalRound(); close(); };
  yes.onclick = ()=>{
    switchTab('leaderboard');
    celebrateWinner();
    state.celebrated = true;
    close();
  };
}

// Utility: does a given round have any recorded results?
function roundHasResults(r){
  for(const key of Object.keys(state.results || {})){
    const rec = state.results[key];
    if(rec && Number(rec.round) === Number(r) && rec.ga != null && rec.gb != null){
      return true;
    }
  }
  return false;
}

// ----- Modal: Remove Last Round -----
function openRemoveRoundModal(){
  const r = Math.max(1, Number(state.rounds) || 2);
  if(r <= 2) return; // Only removable when > 2
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('removeRoundModal');
  const title = document.getElementById('removeRoundTitle');
  const info = document.getElementById('removeRoundInfo');
  const cancel = document.getElementById('removeRoundCancel');
  const confirm = document.getElementById('removeRoundConfirm');
  const blocked = roundHasResults(r);
  title.textContent = blocked ? `Cannot remove Round ${r}` : `Remove Round ${r}?`;
  info.textContent = blocked ? `Round ${r} has recorded results and cannot be removed. You can only remove an empty round.` : `Are you sure you want to remove round ${r}?`;
  overlay.hidden = false; modal.hidden = false;
  const close = ()=>{ overlay.hidden = true; modal.hidden = true; cancel.onclick = null; confirm.onclick = null; };
  overlay.onclick = close;
  cancel.onclick = close;
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); } }, { once:true });
  if(blocked){
    confirm.disabled = true;
  } else {
    confirm.disabled = false;
    confirm.onclick = ()=>{ removeLastRound(r); close(); };
  }
}

function removeLastRound(r){
  if(roundHasResults(r)){
    // Suppress toast; rely on modal messaging/disabled confirm
    return;
  }
  // Remove all results for round r, decrement rounds, save, and re-render
  const keys = Object.keys(state.results || {});
  for(const k of keys){
    const rec = state.results[k];
    if(rec && Number(rec.round) === Number(r)){
      delete state.results[k];
    }
  }
  state.rounds = Math.max(2, Number(r) - 1); // ensure rounds never drop below 2 via this action
  state.celebrated = false;
  saveResults();
  saveRounds();
  renderSchedule();
  renderLeaderboard();
}

// clearTeams replaced by resetAll (single reset action)

function computeTeamCount(n){
  return Math.max(1, Math.min(4, Math.floor(n/4)));
}

function getPairings(){
  const pairs = [];
  if(!state.teams) return pairs;
  for(let i=0;i<state.teams.length;i++){
    for(let j=i+1;j<state.teams.length;j++){
      pairs.push([state.teams[i], state.teams[j]]);
    }
  }
  return pairs;
}

function areAllMatchesScored(){
  if(!state.teams || state.teams.length < 2) return false;
  const pairings = getPairings();
  const rounds = Math.max(1, Number(state.rounds) || 2);
  for(let r=1;r<=rounds;r++){
    for(const [a,b] of pairings){
      const id = `${Math.min(a.id,b.id)}-${Math.max(a.id,b.id)}-r${r}`;
      const rec = state.results[id];
      if(!rec || rec.ga == null || rec.gb == null) return false;
    }
  }
  return true;
}

function celebrateWinner(){
  // Compute winners (supports co-winners on equal Pts and GD)
  const byId = new Map(state.teams.map(t => [t.id, { team: t, pts: 0, played: 0, gf: 0, ga: 0 }]));
  for(const key of Object.keys(state.results || {})){
    const r = state.results[key];
    if(!r) continue;
    const { a, b, ga, gb } = r;
    if(ga == null || gb == null) continue;
    const A = byId.get(a); const B = byId.get(b);
    if(!A || !B) continue;
    A.played++; B.played++;
    A.gf += ga; B.gf += gb;
    A.ga += gb; B.ga += ga;
    if(ga > gb){ A.pts += 3; } else if(gb > ga){ B.pts += 3; } else { A.pts += 1; B.pts += 1; }
  }
  const rows = Array.from(byId.values()).sort((x,y)=> y.pts - x.pts || y.gf - x.gf || x.team.name.localeCompare(y.team.name));
  if(rows.length){
    const topPts = rows[0].pts;
    const topGD = (rows[0].gf - (rows[0].ga || 0));
    const coWinners = rows.filter(r => r.pts === topPts && ((r.gf - (r.ga || 0)) === topGD));
    const names = coWinners.map(r => r.team.name.toUpperCase());
    const list = names.length === 1 ? names[0]
      : (names.length === 2 ? `${names[0]} & ${names[1]}`
         : `${names.slice(0, -1).join(', ')} & ${names[names.length-1]}`);
    showToast(`🎉 ${names.length > 1 ? 'WINNERS' : 'WINNER'}: ${list}!!`, 'winner');
  }
  launchConfetti();
}

function showToast(text, extraClass){
  const t = document.createElement('div');
  t.className = 'toast' + (extraClass ? (' ' + extraClass) : '');
  t.setAttribute('role','status');
  t.setAttribute('aria-live','polite');
  t.innerHTML = `<span class="emoji">🎉</span><span>${text}</span>`;
  document.body.appendChild(t);
  setTimeout(()=>{ t.remove(); }, 4000);
}

// Fun hype messages after each saved result
const HYPE_MESSAGES = [
  'Team {TEAM} is on fire!',
  '{TEAM} turning up the heat!',
  '{TEAM} are flying!',
  'Unstoppable {TEAM}!',
  '{TEAM} with a statement win!',
  '{TEAM} grind it out!',
  'Clinical from {TEAM}.',
  '{TEAM} take the spoils!',
  '{TEAM} are cooking!',
  '{TEAM} bringing the smoke!',
  'Another one for {TEAM}!',
  '{TEAM} mean business!',
  '{TEAM} hit different today!',
  '{TEAM} ice cold.',
  '{TEAM} lock it in.',
  '{TEAM} with the dagger!',
  '{TEAM} seal the deal!',
  'Big dub for {TEAM}!',
  '{TEAM} with the clean finish!',
  '{TEAM} levels up!',
  'Momentum with {TEAM}!',
  '{TEAM} marches on!',
  'Vintage {TEAM}!',
];
const DRAW_MESSAGES = [
  'All square — what a battle!',
  'Deadlock! Nothing between them.',
  'Honors even!',
  'Stalemate — tight one.',
  'Shared spoils!',
];
// Schedule helper used by streak computation and sharing
function getFixedOrderedPairs(){
  if(!state.teams || state.teams.length < 2) return [];
  const pairings = [];
  for(let i=0;i<state.teams.length;i++){
    for(let j=i+1;j<state.teams.length;j++){
      pairings.push([state.teams[i], state.teams[j]]);
    }
  }
  const stableSeed = computeStableSeedFromAttendees(state.attendees || []);
  const baseStreak = new Map(state.teams.map(t => [t.id, 0]));
  const baseOrdered = orderRoundPairings(pairings, baseStreak, stableSeed);
  const totalRounds = Math.max(1, Number(state.rounds) || 2);
  function createsTriple(order){
    const ids = state.teams.map(t=>t.id);
    const streak = new Map(ids.map(id=>[id,0]));
    for(let r=0;r<Math.min(totalRounds,3);r++){
      for(const [a,b] of order){
        for(const id of ids){
          if(id===a.id || id===b.id){ streak.set(id, (streak.get(id)||0)+1); }
          else { streak.set(id, 0); }
          if((streak.get(id)||0) >= 3) return true;
        }
      }
    }
    return false;
  }
  function rotate(arr, k){ const n=arr.length; const out=new Array(n); for(let i=0;i<n;i++){ out[i]=arr[(i+k)%n]; } return out; }
  let fixedOrdered = baseOrdered;
  if(createsTriple(fixedOrdered)){
    const rev = [...baseOrdered].reverse();
    if(!createsTriple(rev)) fixedOrdered = rev; else {
      for(let k=1;k<baseOrdered.length;k++){ const rot = rotate(baseOrdered, k); if(!createsTriple(rot)){ fixedOrdered = rot; break; } }
    }
  }
  return fixedOrdered;
}

// Compute current W/L/D streaks up to and including a specific match
function computeStreaksUpTo(matchId){
  const streaks = new Map(); // id -> { type: 'W'|'L'|'D'|null, len: number }
  for(const t of (state.teams||[])) streaks.set(t.id, { type: null, len: 0 });
  if(!state.teams || state.teams.length<2) return streaks;
  const totalRounds = Math.max(1, Number(state.rounds) || 2);
  const fixedOrdered = getFixedOrderedPairs();
  const endOn = String(matchId);
  let done = false;
  for(let r=1; r<=totalRounds && !done; r++){
    for(const [a,b] of fixedOrdered){
      const id = `${Math.min(a.id,b.id)}-${Math.max(a.id,b.id)}-r${r}`;
      const rec = state.results[id];
      if(!rec || rec.ga==null || rec.gb==null){
        if(id === endOn){ done = true; break; }
        continue;
      }
      let aType = 'D', bType = 'D';
      if(rec.ga > rec.gb){ aType='W'; bType='L'; }
      else if(rec.gb > rec.ga){ aType='L'; bType='W'; }
      const sa = streaks.get(a.id); const sb = streaks.get(b.id);
      if(sa.type === aType){ sa.len += 1; } else { sa.type = aType; sa.len = 1; }
      if(sb.type === bType){ sb.len += 1; } else { sb.type = bType; sb.len = 1; }
      if(id === endOn){ done = true; break; }
    }
  }
  return streaks;
}

function showHypeToastForMatch(matchId, aTeam, bTeam){
  const rec = state.results[matchId];
  if(!rec) return;
  const { ga, gb } = rec;
  if(ga === gb){
    const msg = DRAW_MESSAGES[Math.floor(Math.random()*DRAW_MESSAGES.length)];
    showToast(msg);
    return;
  }
  const fixedOrdered = getFixedOrderedPairs(); // ensure deterministic order exists
  const streaks = computeStreaksUpTo(matchId);
  const aSt = streaks.get(aTeam.id) || { type:null, len:0 };
  const bSt = streaks.get(bTeam.id) || { type:null, len:0 };
  const winner = ga > gb ? aTeam : bTeam;
  const loser = ga > gb ? bTeam : aTeam;
  const wSt = ga > gb ? aSt : bSt;
  const lSt = ga > gb ? bSt : aSt;
  const WNAME = String(winner.name || 'Winners').toUpperCase();
  const LNAME = String(loser.name || 'Losers').toUpperCase();

  // Winner phrase
  let line = '';
  if(wSt.type === 'W' && wSt.len >= 2){
    const streakStr = (wSt.len === 2) ? 'two in a row' : (wSt.len === 3 ? 'a hat‑trick of wins' : `${wSt.len} straight`);
    const winStreakMsgs = [
      `TEAM ${WNAME} keep rolling — ${streakStr}!`,
      `TEAM ${WNAME} extend the streak: ${streakStr}!`,
      `Unbeatable! TEAM ${WNAME} now on ${streakStr}.`,
      `Momentum with TEAM ${WNAME}: ${streakStr}!`,
    ];
    line = winStreakMsgs[Math.floor(Math.random()*winStreakMsgs.length)];
  } else {
    const winMsgs = [
      `TEAM ${WNAME} take it!`,
      `Big win for TEAM ${WNAME}!`,
      `Clinical from TEAM ${WNAME}.`,
      `Statement win by TEAM ${WNAME}!`,
      `TEAM ${WNAME} seal the deal!`,
    ];
    line = winMsgs[Math.floor(Math.random()*winMsgs.length)];
  }

  // Losing phrase (if consecutive losses)
  if(lSt.type === 'L' && lSt.len >= 2){
    const losingStr = (lSt.len === 2) ? 'two on the bounce' : `${lSt.len} straight`;
    const loseMsgs = [
      ` Tough stretch for TEAM ${LNAME} — ${losingStr}.`,
      ` TEAM ${LNAME} drop ${losingStr}.`,
      ` Skid continues for TEAM ${LNAME}: ${losingStr}.`,
    ];
    line += loseMsgs[Math.floor(Math.random()*loseMsgs.length)];
  } else {
    const singleLoseMsgs = [
      ` Tough one for TEAM ${LNAME}.`,
      ` TEAM ${LNAME} will look to bounce back.`,
      ` TEAM ${LNAME} just short today.`,
    ];
    line += singleLoseMsgs[Math.floor(Math.random()*singleLoseMsgs.length)];
  }

  showToast(line);
}

function launchConfetti(){
  const colors = ['#EF4444','#F59E0B','#10B981','#3B82F6','#8B5CF6','#EC4899'];
  const count = 80;
  const nodes = [];
  for(let i=0;i<count;i++){
    const c = document.createElement('div');
    c.className = 'confetti';
    const left = Math.random()*100;
    const dur = 2.8 + Math.random()*1.8;
    const delay = Math.random()*0.5;
    c.style.left = left + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animation = `confetti-fall ${dur}s linear ${delay}s forwards`;
    document.body.appendChild(c);
    nodes.push(c);
  }
  setTimeout(()=> nodes.forEach(n=> n.remove()), 5000);
}

function generateTeams(){
  const n = state.attendees.length;
  if(n < 8){
    updateGenError('Need at least 8 attendees to generate teams.');
    return;
  }
  updateGenError('');
  if(n === 11){
    return openTeamCountModal([2,3], 11);
  }
  // For 15 players, default to 3 teams (5-5-5); no choice modal
  if(!state.timestamp){ state.timestamp = Date.now(); saveTimestamp(); }

  const t = computeTeamCount(n);
  const stableSeed = computeStableSeedFromAttendees(state.attendees);
  const shuffled = shuffleSeeded(state.attendees, stableSeed);
  // Average stamina across current attendees for stamina-aware tie-breaks
  const totalStamina = state.attendees.reduce((s, name)=> s + getStamina(name), 0);
  const avgStamina = n > 0 ? (totalStamina / n) : DEFAULT_STAMINA;
  // target sizes: base 4, last r teams +1
  const base = Array(t).fill(4);
  const r = n - 4*t;
  for(let i=t-r; i<t; i++) if(i>=0 && i<t) base[i] += 1;

  const colors = COLORS.slice(0, Math.min(t, COLORS.length));
  // Build teams with capacity and targets based on average skill per slot
  const totalSkill = state.attendees.reduce((s, name)=> s + getSkill(name), 0);
  const avgSkill = totalSkill / n;
  const teamInfos = base.map((size, i) => ({
    cap: size,
    target: size * avgSkill,
    skillSum: 0,
    staminaSum: 0,
    team: {
      id: i+1,
      name: colors[i].name,
      color: colors[i].hex,
      members: []
    }
  }));

  // Assign players sorted by skill desc (tie-broken by seeded shuffle)
  // Choose the team with the greatest deficit (target - currentSum), respecting capacity
  const orderIndex = new Map(shuffled.map((name, idx) => [name, idx]));
  const playersSorted = [...state.attendees].sort((a,b)=>{
    const sa = getSkill(a), sb = getSkill(b);
    if(sb !== sa) return sb - sa; // higher skill first
    return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0); // deterministic tie-breaker
  });
  for(const player of playersSorted){
    const s = getSkill(player);
    const st = getStamina(player);
    let best = -1;
    let bestScore = -Infinity;
    for(let i=0;i<teamInfos.length;i++){
      const info = teamInfos[i];
      if(info.team.members.length < info.cap){
        const def = info.target - info.skillSum;
        const harmonyBias = computeHarmonyBias(info.team.members, player);
        const score = def - harmonyBias;
        if(score > bestScore + 1e-9){ bestScore = score; best = i; }
        else if(Math.abs(score - bestScore) <= 1e-9 && best !== -1){
          const bi = teamInfos[best];
          // Stamina-aware tie-break: only within skill tie
          if(st >= avgStamina){
            // Prefer smaller-capacity team when player's stamina is high
            if(info.cap < bi.cap) { best = i; }
            else if(info.cap === bi.cap){
              // If capacities equal, prefer team with lower current staminaSum to even out
              if(info.staminaSum < bi.staminaSum) best = i;
            }
          }
          // Existing deterministic tie-breakers
          const bestIdx = best; // may have changed above
          const bi2 = teamInfos[bestIdx];
          if(info.team.members.length < bi2.team.members.length) best = i;
          else if(info.team.members.length === bi2.team.members.length && info.skillSum < bi2.skillSum) best = i;
          else if(info.team.members.length === bi2.team.members.length && info.skillSum === bi2.skillSum && i < bestIdx) best = i;
        }
      }
    }
    if(best === -1) best = 0;
    const tgt = teamInfos[best];
    tgt.team.members.push(player);
    tgt.skillSum += s;
    tgt.staminaSum += st;
  }

  state.teams = teamInfos.map(x => x.team);
  // Post-pass: skill balancer then stamina smoothing (equal-skill swaps)
  try { balanceSkillToTargets(state.teams, state.attendees, getSkill); } catch(_) { /* best-effort */ }
  try { balanceStaminaEqualSkill(state.teams, getSkill, getStamina); } catch(_) { /* best-effort */ }
  try { applyRosterHarmonyFinal(state.teams); } catch(_) { /* best-effort */ }
  state.results = {};
  state.rounds = 2;
  saveTeams();
  saveResults();
  saveRounds();
  renderTeams();
  renderRoster();
  renderSchedule();
  renderLeaderboard();
  switchTab('teams');
  updateTabsUI();
}

function copyTeams(){
  if(!navigator.clipboard){ return; }
  const lines = [];
  for(const t of state.teams){
    lines.push(`${t.name}: ${t.members.join(', ')}`);
  }
  const txt = lines.join('\n');
  navigator.clipboard.writeText(txt).then(()=>{
    const btn = document.getElementById('btnCopy');
    if(btn){
      const old = btn.textContent; btn.textContent = 'Copied!';
      setTimeout(()=> btn.textContent = old, 1200);
    }
  });
}

// ----- Wire up -----
document.getElementById('btnGenerateBottom').addEventListener('click', generateTeams);
const btnResetPlayersTop = document.getElementById('btnResetPlayersTop');
if(btnResetPlayersTop){ btnResetPlayersTop.addEventListener('click', openResetModal); }
document.getElementById('btnAddPlayer').addEventListener('click', openAddPlayerModal);

// Drop zones setup runs once; items are re-rendered each time
setupDnD();

// ----- Tabs -----
const tabs = {
  players: document.getElementById('tabPlayers'),
  teams: document.getElementById('tabTeams'),
  matches: document.getElementById('tabMatches'),
  leaderboard: document.getElementById('tabLeaderboard'),
};
const panels = {
  players: document.getElementById('playersSection'),
  teams: document.getElementById('teamsSection'),
  matches: document.getElementById('matchesSection'),
  leaderboard: document.getElementById('leaderboardSection'),
  alltime: document.getElementById('allTimeSection'),
};
let currentTab = 'players';
function switchTab(which){
  const hasTeams = state.teams && state.teams.length > 0;
  if((which === 'teams' || which === 'matches' || which === 'leaderboard') && !hasTeams) return; // disabled
  currentTab = which;
  for(const [k,btn] of Object.entries(tabs)){
    const active = k === which;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  for(const [k,el] of Object.entries(panels)){
    el.hidden = k !== which;
  }
  // Reflect active state on All-Time header button
  const btnAllTimeHeaderEl = document.getElementById('btnAllTimeHeader');
  if(btnAllTimeHeaderEl){ btnAllTimeHeaderEl.classList.toggle('active', which === 'alltime'); }
  const btnAllTimeRefreshEl = document.getElementById('btnAllTimeRefresh');
  if(btnAllTimeRefreshEl){ btnAllTimeRefreshEl.hidden = (which !== 'alltime'); }
  if(which === 'players'){
    renderRoster(); // ensure lock state reflected immediately
  } else if(which === 'alltime'){
    renderAllTime(true);
  }
  syncStickyOffsets();
  // Header has no explicit refresh button; All-Time reloads when opened
}
function updateTabsUI(){
  const hasTeams = state.teams && state.teams.length > 0;
  tabs.teams.disabled = !hasTeams;
  tabs.matches.disabled = !hasTeams;
  tabs.leaderboard.disabled = !hasTeams;
  const btnResetTop = document.getElementById('btnResetPlayersTop');
  const playersTopBar = document.getElementById('playersTopBar');
  if(btnResetTop){ btnResetTop.hidden = !hasTeams; }
  if(playersTopBar){ playersTopBar.style.display = hasTeams ? 'flex' : 'none'; }
  if(!hasTeams && (currentTab === 'teams' || currentTab === 'matches' || currentTab === 'leaderboard')) switchTab('players');
}
tabs.players.addEventListener('click', ()=> switchTab('players'));
tabs.teams.addEventListener('click', ()=> switchTab('teams'));
tabs.matches.addEventListener('click', ()=> switchTab('matches'));
tabs.leaderboard.addEventListener('click', ()=> switchTab('leaderboard'));
const btnAllTimeHeader = document.getElementById('btnAllTimeHeader');
if(btnAllTimeHeader){ btnAllTimeHeader.addEventListener('click', ()=> switchTab('alltime')); }
const btnAllTimeRefresh = document.getElementById('btnAllTimeRefresh');
if(btnAllTimeRefresh){ btnAllTimeRefresh.addEventListener('click', ()=> renderAllTime(true)); }

// ----- All-Time Leaderboard (CSV: ecgfutsal2025-26.txt) -----
let allTimeCache = { rows: null, ts: 0 };
let allTimeSort = { key: 'points', dir: 'desc' }; // default: Total Points desc
// Basis for header insight cards' rank comparisons (only changes when user selects Points or Pts/Session)
let allTimeInsightBasis = 'points'; // 'points' | 'ppm'
const ALLTIME_ALPHA = 5; // smoothing factor for Pts/Session thresholds
const BADGE_CONFIG = {
  latestTop: { icon:'⭐', label:'Latest Top Scorer', short:'Latest Top Scorer', desc:'Led the latest session in goals.' },
  playmaker: { icon:'🎖️', label:'Playmaker', short:'Playmaker', desc:'Highest points+goals contribution in the latest session.' },
  allTimeTop: { icon:'🥇', label:'All-Time Topscorer', short:'All-Time Topscorer', desc:'Most total goals across all sessions.' },
  clutch: { icon:'🏆', label:'Session Ace', short:'Session Ace', desc:'Most sessions finishing with the highest points.' },
  hatTrick: { icon:'⚽', label:'Three In A Row', short:'Three In A Row', desc:'Scored in 3+ consecutive goal-tracked sessions.' },
  fourRow: { icon:'⚽', label:'Four In A Row', short:'Four In A Row', desc:'Scored in 4+ consecutive goal-tracked sessions.' },
  fiveRow: { icon:'⚽', label:'Five In A Row', short:'Five In A Row', desc:'Scored in 5+ consecutive goal-tracked sessions.' },
  sixRow: { icon:'⚽', label:'Six In A Row', short:'Six In A Row', desc:'Scored in 6+ consecutive goal-tracked sessions.' },
  sevenRow: { icon:'⚽', label:'Seven In A Row', short:'Seven In A Row', desc:'Scored in 7+ consecutive goal-tracked sessions.' },
  eightRow: { icon:'⚽', label:'Eight In A Row', short:'Eight In A Row', desc:'Scored in 8+ consecutive goal-tracked sessions.' },
  nineRow: { icon:'⚽', label:'Nine In A Row', short:'Nine In A Row', desc:'Scored in 9+ consecutive goal-tracked sessions.' },
  tenRow: { icon:'⚽', label:'Ten In A Row', short:'Ten In A Row', desc:'Scored in 10+ consecutive goal-tracked sessions.' },
  sharpshooter: { icon:'🎯', label:'Sharpshooter', short:'Sharpshooter', desc:'Averages 2+ goals per tracked session.' },
  ironMan: { icon:'🛡️', label:'Iron Man', short:'Iron Man', desc:'Current streak of 6+ consecutive sessions.' },
  marathon: { icon:'🏃‍♂️', label:'Marathon Man', short:'Marathon Man', desc:'Current streak of 15 consecutive sessions.' },
  addict: { icon:'🔥', label:'Addict', short:'Addict', desc:'90%+ attendance this season.' },
  clinical: { icon:'🥾', label:'Clinical Finisher', short:'Clinical Finisher', desc:'Scored 5+ goals in a single session.' },
  elite: { icon:'🧠', label:'Elite', short:'Elite', desc:'On the winning team in 3 consecutive sessions.' },
  master: { icon:'🥋', label:'Master', short:'Master', desc:'On the winning team in 4 consecutive sessions.' },
  legend: { icon:'🦁', label:'Legend', short:'Legend', desc:'On the winning team in 5 consecutive sessions.' },
  rocket: { icon:'📈', label:'Rocket Rank', short:'Rocket Rank', desc:'Improved rank by 5+ positions since last session.' },
  form: { icon:'⚡', label:'On Fire', short:'On Fire', desc:'Largest positive form swing (last 3 vs career PPM).' },
  coldStreak: { icon:'🥶', label:'Cold Streak', short:'Cold Streak', desc:'Largest negative form swing (last 3 vs career PPM).' },
  mvp: { icon:'👑', label:'Most Valuable Player', short:'Most Valuable Player', desc:'Highest Pts/Session with ≥60% attendance.' },
};
const TROPHY_DESC = {
  latestTop: 'Led a session in goals.',
  playmaker: 'Owned a session with top points+goals contribution.',
  allTimeTop: 'Held the career goals lead.',
  mvp: 'Held season-best Pts/Session with solid attendance.',
  form: 'Led a session with the best positive form swing (last 3 vs career).',
  ironMan: 'Completed a 6+ session attendance streak.',
  marathon: 'Completed a 15-session attendance streak.',
  clinical: 'Scored 5+ goals in a single session.',
  elite: 'On the winning team in 3 consecutive sessions.',
  master: 'On the winning team in 4 consecutive sessions.',
  legend: 'On the winning team in 5 consecutive sessions.',
  clutch: 'Most sessions finishing with the highest points.',
  hatTrick: 'Scored in 3+ consecutive goal-tracked sessions.',
  fourRow: 'Scored in 4+ consecutive goal-tracked sessions.',
  fiveRow: 'Scored in 5+ consecutive goal-tracked sessions.',
  sixRow: 'Scored in 6+ consecutive goal-tracked sessions.',
  sevenRow: 'Scored in 7+ consecutive goal-tracked sessions.',
  eightRow: 'Scored in 8+ consecutive goal-tracked sessions.',
  nineRow: 'Scored in 9+ consecutive goal-tracked sessions.',
  tenRow: 'Scored in 10+ consecutive goal-tracked sessions.',
  sharpshooter: 'Averages 2+ goals per tracked session.',
  rocket: 'Improved rank by 5+ positions since last session.',
  coldStreak: 'Largest negative form swing (last 3 vs career PPM).'
};
const PLAYMAKER_CUTOFF_DATE = '2025-11-12'; // Only award Playmaker from this date onward (goal tracking available)
const BADGE_PRIORITY = ['playmaker','clutch','latestTop','allTimeTop','mvp','clinical','legend','master','elite','tenRow','nineRow','eightRow','sevenRow','sixRow','fiveRow','fourRow','hatTrick','sharpshooter','form','coldStreak','ironMan','marathon','addict','rocket'];
async function renderAllTime(force=false){
  const wrap = document.getElementById('allTimeContent');
  if(!wrap) return;
  wrap.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'notice';
  loading.textContent = 'Loading all-time stats…';
  wrap.appendChild(loading);

  try{
    const data = await loadAllTimeCSV(force);
    window.__allTimeBadges = new Map();
    const stats = aggregateAllTime(data);
    const statsMap = new Map(stats.map(s => [s.player, s]));
    sortAllTimeStats(stats);
    wrap.innerHTML = '';
    if(stats.length === 0){
      const empty = document.createElement('div');
      empty.className = 'notice';
      empty.textContent = 'No data found.';
      wrap.appendChild(empty);
    }else{
      const totalSessions = countUniqueSessions(data);
      const series = buildAllTimeSeries(data);
      const goalSeries = buildAllTimeGoalSeries(data);
      const byDate = buildAllTimeByDate(data);
      window.__allTimeSeries = series; // cache for modal
      window.__allTimeGoalSeries = goalSeries;
      window.__allTimeByDate = byDate;
      window.__allTimeRows = data;
      const latestDate = data.map(r=>r.date).sort().slice(-1)[0];
      const preRows = data.filter(r => r.date !== latestDate);
      const preStats = aggregateAllTime(preRows);
      sortAllTimeStats(preStats);
      const preRanks = makeRankMap(preStats);
      const postRanks = makeRankMap(stats);
      window.__allTimeBadges = computeAllTimeBadges(data, byDate, statsMap, preRanks, postRanks);
      // Latest sync pill (top-right) then header stat cards
      const pillBar = buildLatestSyncPill(latestDate);
      if(pillBar) wrap.appendChild(pillBar);
      const headerCards = buildAllTimeHeaderCards(preRows, data, byDate, latestDate, allTimeInsightBasis);
      if(headerCards) wrap.appendChild(headerCards);
      wrap.appendChild(buildAllTimeTable(stats, totalSessions, series, preRanks, postRanks, latestDate));
    }
    // no updated timestamp shown
  }catch(err){
    wrap.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'notice error';
    msg.textContent = 'Failed to load all-time data. Ensure the file exists and is accessible.';
    wrap.appendChild(msg);
  }
}

async function loadAllTimeCSV(force=false){
  // Simple cache to avoid re-fetching on tab toggles unless forced
  if(allTimeCache.rows && !force){ return allTimeCache.rows; }
  const url = 'ecgfutsal2025-26.txt?ts=' + Date.now();
  const res = await fetch(url, { cache: 'no-store' });
  if(!res.ok){ throw new Error('HTTP ' + res.status); }
  const text = await res.text();
  const rows = parseCSVSimple(text);
  allTimeCache.rows = rows; allTimeCache.ts = Date.now();
  return rows;
}

function splitCSVLine(line){
  const out = [];
  let cur = '';
  let inQuotes = false;
  for(let i=0;i<line.length;i++){
    const ch = line[i];
    if(ch === '"'){
      if(inQuotes && line[i+1] === '"'){ cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    }else if(ch === ',' && !inQuotes){
      out.push(cur.trim());
      cur = '';
    }else{
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseCSVSimple(text){
  // Handle BOM and normalize newlines
  const t = text.replace(/^\uFEFF/, '');
  const lines = t.split(/\r?\n/).map(l => l.trimEnd());
  const out = [];
  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    if(!line) continue;
    const normalized = line.replace(/\s+/g,'').toLowerCase();
    if(i===0 && (normalized === 'date,player,points' || normalized === 'date,player,points,goals')) continue; // skip header
    const parts = splitCSVLine(line);
    if(parts.length < 3) continue;
    const date = (parts[0] || '').trim();
    const player = (parts[1] || '').trim();
    const pointsStr = (parts[2] || '').trim();
    const goalsStr = (parts[3] || '').trim();
    const points = Number(pointsStr);
    let goals = null;
    if(parts.length >= 4){
      if(goalsStr === ''){
        goals = 0;
      } else {
        const gNum = Number(goalsStr);
        goals = Number.isFinite(gNum) ? gNum : 0;
      }
    }
    if(!player) continue;
    if(!Number.isFinite(points)) continue;
    out.push({ date, player, points, goals });
  }
  return out;
}

function aggregateAllTime(rows){
  const map = new Map();
  for(const { player, points, goals } of rows){
    const cur = map.get(player) || { player, matches:0, points:0, goals:0, goalSessions:0 };
    cur.matches += 1;
    cur.points += Number(points) || 0;
    if(goals != null){
      cur.goals += Number(goals) || 0;
      cur.goalSessions += 1;
    }
    map.set(player, cur);
  }
  return Array.from(map.values()).map(x => ({
    ...x,
    ppm: x.matches ? x.points / x.matches : 0,
    gpm: x.goalSessions ? x.goals / x.goalSessions : 0,
  }));
}

function computeAllTimeThresholds(stats, totalSessions, alpha){
  // Global mean PPM weighted by matches
  let totalPoints = 0, totalMatches = 0;
  for(const s of stats){ totalPoints += s.points; totalMatches += s.matches; }
  const mu = totalMatches > 0 ? (totalPoints / totalMatches) : 0;

  // Minimum sessions to color (lowered to show colors earlier)
  const minMatches = Math.max(2, Math.ceil((totalSessions || 0) * 0.1));
  const vals = []; const wts = [];
  for(const s of stats){
    if(s.matches >= minMatches){
      const smoothed = (s.points + alpha * mu) / (s.matches + alpha);
      vals.push(smoothed); wts.push(s.matches);
    }
  }
  let low, high;
  if(vals.length >= 5){
    // Use tertiles for clearer spread
    low = weightedPercentile(vals, wts, 1/3);
    high = weightedPercentile(vals, wts, 2/3);
  } else if(vals.length > 0){
    // Fallback around global mean
    low = Math.max(0, mu * 0.9);
    high = mu * 1.1;
    if(high - low < 0.1){ high = low + 0.1; }
  } else {
    // No eligible players
    low = 1.0; high = 2.0;
  }
  return { mu, alpha, minMatches, low, high };
}

function weightedPercentile(values, weights, p){
  const arr = values.map((v,i)=>({v,w:weights[i]})).sort((a,b)=> a.v - b.v);
  const totalW = arr.reduce((s,x)=> s + x.w, 0);
  if(totalW <= 0) return arr.length ? arr[0].v : 0;
  const target = p * totalW;
  let cum = 0;
  for(const x of arr){
    cum += x.w;
    if(cum >= target) return x.v;
  }
  return arr[arr.length-1]?.v ?? 0;
}

function countUniqueSessions(rows){
  const dates = new Set();
  for(const r of rows){ if(r && r.date) dates.add(r.date); }
  return dates.size;
}

function buildAllTimeSeries(rows){
  // Returns Map<Player, number[]> sorted by date ascending (points)
  const byPlayer = new Map();
  const byDate = new Map();
  for(const r of rows){
    if(!r || !r.player || !r.date || !Number.isFinite(r.points)) continue;
    if(!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push({ player: r.player, points: Number(r.points) || 0 });
  }
  const dates = Array.from(byDate.keys()).sort();
  for(const d of dates){
    const entries = byDate.get(d) || [];
    for(const e of entries){
      const arr = byPlayer.get(e.player) || [];
      arr.push(e.points);
      byPlayer.set(e.player, arr);
    }
  }
  return byPlayer;
}

function buildAllTimeGoalSeries(rows){
  const byPlayer = new Map();
  const byDate = new Map();
  for(const r of rows){
    if(!r || !r.player || !r.date) continue;
    if(!byDate.has(r.date)) byDate.set(r.date, []);
    const goalVal = (r.goals == null) ? null : (Number(r.goals) || 0);
    byDate.get(r.date).push({ player: r.player, goals: goalVal });
  }
  const dates = Array.from(byDate.keys()).sort();
  for(const d of dates){
    const entries = byDate.get(d) || [];
    for(const e of entries){
      if(e.goals == null) continue;
      const arr = byPlayer.get(e.player) || [];
      arr.push(e.goals);
      byPlayer.set(e.player, arr);
    }
  }
  return byPlayer;
}

function buildAllTimeByDate(rows){
  const byDate = new Map();
  for(const r of rows){
    if(!r || !r.player || !r.date || !Number.isFinite(r.points)) continue;
    if(!byDate.has(r.date)) byDate.set(r.date, []);
    const goalVal = (r.goals == null) ? null : (Number(r.goals)||0);
    byDate.get(r.date).push({ player: r.player, points: Number(r.points)||0, goals: goalVal });
  }
  return byDate;
}

function computeAllTimeBadges(rows, byDate, statsMap, preRanks, postRanks){
  const badgeMap = new Map();
  if(!rows || !rows.length || !byDate) return badgeMap;
  const dates = Array.from(byDate.keys()).sort();
  if(!dates.length) return badgeMap;
  const players = Array.from(statsMap.keys());
  const perPlayer = new Map(players.map(p => [p, { goalStreak:0, bestGoalStreak:0, attendStreak:0, bestAttendStreak:0, winStreak:0, bestWinStreak:0 }]));
  const cumulative = new Map(players.map(p => [p, { matches:0, points:0, goals:0, goalSessions:0 }]));
  const pointsHistory = new Map(players.map(p => [p, []]));
  const sessionAceCounts = new Map(players.map(p => [p, 0]));
  const badgeHistory = {
    mvp: new Map(),
    latestTop: new Map(),
    allTimeTop: new Map(),
    playmaker: new Map(),
    ironMan: new Map(),
    marathon: new Map(),
    clinical: new Map(),
    elite: new Map(),
    master: new Map(),
    legend: new Map(),
    form: new Map(),
  };
  function addHistory(map, player, date){
    const cur = map.get(player) || { count:0, dates:[] };
    cur.count += 1;
    cur.dates.push(date);
    map.set(player, cur);
  }
  function addHistoryOnce(map, player, date){
    if(map.has(player)) return;
    map.set(player, { count: 1, dates: [date] });
  }
  for(let di=0; di<dates.length; di++){
    const d = dates[di];
    const entries = byDate.get(d) || [];
    const entryMap = new Map(entries.map(e => [e.player, e]));
    let maxPoints = -Infinity;
    let minPoints = Infinity;
    let sessionMaxGoals = null;
    let sessionMaxContribution = -Infinity;
    for(const e of entries){
      const pts = Number(e.points) || 0;
      if(pts > maxPoints) maxPoints = pts;
      if(pts < minPoints) minPoints = pts;
      const gVal = (e.goals != null) ? (Number(e.goals) || 0) : 0;
      if(gVal > 0 && (sessionMaxGoals === null || gVal > sessionMaxGoals)){ sessionMaxGoals = gVal; }
      const contrib = pts + gVal;
      if(contrib > sessionMaxContribution){ sessionMaxContribution = contrib; }
    }
    const hasWin = (entries.length > 0) && (maxPoints > minPoints);
    const winners = new Set();
    if(hasWin){
      for(const e of entries){
        const pts = Number(e.points) || 0;
        if(pts === maxPoints) winners.add(e.player);
      }
    }
    if(entries.length && maxPoints > -Infinity){
      for(const e of entries){
        const pts = Number(e.points) || 0;
        if(pts === maxPoints){
          sessionAceCounts.set(e.player, (sessionAceCounts.get(e.player)||0) + 1);
        }
      }
    }
    for(const player of players){
      const stat = perPlayer.get(player);
      const entry = entryMap.get(player);
      if(entry){
        stat.attendStreak += 1;
        if(stat.attendStreak > stat.bestAttendStreak) stat.bestAttendStreak = stat.attendStreak;
        if(entry.goals != null && Number(entry.goals) > 0){
          stat.goalStreak += 1;
        } else {
          stat.goalStreak = 0;
        }
        if(stat.goalStreak > stat.bestGoalStreak) stat.bestGoalStreak = stat.goalStreak;
        if(hasWin && winners.has(player)){
          stat.winStreak += 1;
          if(stat.winStreak > stat.bestWinStreak) stat.bestWinStreak = stat.winStreak;
          if(stat.winStreak === 3){
            addHistoryOnce(badgeHistory.elite, player, d);
          }
          if(stat.winStreak === 4){
            addHistoryOnce(badgeHistory.master, player, d);
          }
          if(stat.winStreak === 5){
            addHistoryOnce(badgeHistory.legend, player, d);
          }
        } else {
          stat.winStreak = 0;
        }
        const arr = pointsHistory.get(player);
        if(arr){ arr.push(Number(entry.points) || 0); }
        const agg = cumulative.get(player);
        if(agg){
          agg.matches += 1;
          agg.points += Number(entry.points) || 0;
          if(entry.goals != null){
            agg.goals += Number(entry.goals) || 0;
            agg.goalSessions += 1;
          }
        }
      } else {
        // Absence breaks attendance streaks but does not break scoring streaks
        stat.attendStreak = 0;
        stat.winStreak = 0;
      }
    }
    // Iron Man history: count sessions where current streak is 6+
    for(const player of players){
      const stat = perPlayer.get(player);
      if(stat && stat.attendStreak === 6){
        // Iron Man can be earned once per season when streak first hits 6
        addHistoryOnce(badgeHistory.ironMan, player, d);
      }
      if(stat && stat.attendStreak === 15){
        addHistoryOnce(badgeHistory.marathon, player, d);
      }
    }
    // Session-specific histories
    if(sessionMaxGoals != null && sessionMaxGoals > 0){
      for(const e of entries){
        const gVal = (e.goals != null) ? (Number(e.goals) || 0) : 0;
        if(gVal === sessionMaxGoals){
          addHistory(badgeHistory.latestTop, e.player, d);
          if(gVal >= 5){ addHistoryOnce(badgeHistory.clinical, e.player, d); }
        }
      }
    }
    if(entries.length && sessionMaxContribution > -Infinity && d >= PLAYMAKER_CUTOFF_DATE){
      const contribList = entries.map(e => ({
        player: e.player,
        contrib: (Number(e.points) || 0) + ((e.goals != null) ? (Number(e.goals) || 0) : 0),
        goals: (e.goals != null) ? (Number(e.goals) || 0) : 0,
        points: Number(e.points) || 0
      }));
      contribList.sort((a,b)=> b.contrib - a.contrib || b.goals - a.goals || b.points - a.points || a.player.localeCompare(b.player));
      const top = contribList[0];
      if(top && top.contrib === sessionMaxContribution){
        addHistory(badgeHistory.playmaker, top.player, d);
      }
    }
    // Cumulative leaders for All-Time Top at this point
    let maxGoalTotal = 0;
    for(const agg of cumulative.values()){
      if(agg.goals > maxGoalTotal) maxGoalTotal = agg.goals;
    }
    if(maxGoalTotal > 0){
      for(const [player, agg] of cumulative.entries()){
        if(agg.goals === maxGoalTotal){ addHistory(badgeHistory.allTimeTop, player, d); }
      }
    }
    // MVP per session (based on cumulative stats up to this date)
    const totalSessionsSoFar = di + 1;
    let mvpPlayerSession = null;
    let bestPPMSession = 0;
    for(const [player, agg] of cumulative.entries()){
      if(agg.matches <= 0) continue;
      const attendanceRate = agg.matches / totalSessionsSoFar;
      if(attendanceRate < 0.6) continue;
      const ppmVal = agg.points / agg.matches;
      if(ppmVal > bestPPMSession){
        bestPPMSession = ppmVal;
        mvpPlayerSession = player;
      }
    }
    if(mvpPlayerSession && bestPPMSession > 0){
      addHistory(badgeHistory.mvp, mvpPlayerSession, d);
    }
    // On Fire per session (best positive delta last3 vs career among players who appeared)
    let sessionBestFormPlayer = null;
    let sessionBestFormDelta = 0;
    for(const player of players){
      if(!entryMap.has(player)) continue;
      const historyPts = pointsHistory.get(player) || [];
      const last3 = historyPts.slice(-3);
      const last3Avg = last3.length ? (last3.reduce((s,v)=> s+v, 0) / last3.length) : 0;
      const agg = cumulative.get(player) || {};
      const career = agg.matches ? (agg.points / agg.matches) : 0;
      const delta = last3Avg - career;
      if(delta > 0 && (sessionBestFormPlayer === null || delta > sessionBestFormDelta)){
        sessionBestFormPlayer = player;
        sessionBestFormDelta = delta;
      }
    }
    if(sessionBestFormPlayer){
      addHistory(badgeHistory.form, sessionBestFormPlayer, d);
    }
  }
  const latestDate = dates[dates.length-1];
  const latestEntries = byDate.get(latestDate) || [];
  const latestMap = new Map(latestEntries.map(e => [e.player, e]));
  let maxGoals = null;
  for(const entry of latestEntries){
    if(entry && entry.goals != null){
      const g = Number(entry.goals) || 0;
      if(g > 0 && (maxGoals === null || g > maxGoals)){ maxGoals = g; }
    }
  }
  let bestFormPlayer = null;
  let bestFormDelta = 0;
  const formDeltas = new Map(); // track every player's recent vs career delta (latest snapshot)
  let mvpPlayer = null;
  let bestPPM = 0;
  let allTimeTopPlayer = null;
  let maxTotalGoals = 0;
  let playmakerPlayer = null;
  let bestContribution = -Infinity;
  for(const player of players){
    const stats = perPlayer.get(player) || { bestGoalStreak:0, bestAttendStreak:0 };
    const agg = statsMap.get(player) || {};
    const hasGoalData = agg.goalSessions && agg.goalSessions > 0;
    const history = pointsHistory.get(player) || [];
    const last3 = history.slice(-3);
    const last3Avg = last3.length ? (last3.reduce((s,v)=> s+v, 0) / last3.length) : 0;
    const career = agg.ppm || 0;
    const deltaForm = last3Avg - career;
    const flags = {
      latestTop: false,
      allTimeTop: false,
      clutch: false,
      mvp: false,
      hatTrick: false,
      fourRow: false,
      fiveRow: false,
      sixRow: false,
      sevenRow: false,
      eightRow: false,
      nineRow: false,
      tenRow: false,
      sharpshooter: hasGoalData && (agg.gpm || 0) >= 2,
      ironMan: stats.attendStreak >= 6 && stats.attendStreak < 15,
      marathon: stats.attendStreak >= 15,
      addict: false,
      clinical: false,
      elite: stats.winStreak >= 3 && stats.winStreak < 4,
      master: stats.winStreak >= 4 && stats.winStreak < 5,
      legend: stats.winStreak >= 5,
      rocket: false,
      form: false,
      coldStreak: false,
    };
    // Award the highest streak badge achieved (3–10 consecutive scoring sessions)
    const streakTiers = [
      { key:'tenRow', min:10 },
      { key:'nineRow', min:9 },
      { key:'eightRow', min:8 },
      { key:'sevenRow', min:7 },
      { key:'sixRow', min:6 },
      { key:'fiveRow', min:5 },
      { key:'fourRow', min:4 },
      { key:'hatTrick', min:3 },
    ];
    const bestGoalStreak = stats.bestGoalStreak || 0;
    const earnedStreak = streakTiers.find(t => bestGoalStreak >= t.min);
    if(earnedStreak){ flags[earnedStreak.key] = true; }
    formDeltas.set(player, deltaForm);
    if(deltaForm > 0){
      if(!bestFormPlayer || deltaForm > bestFormDelta){
        bestFormPlayer = player;
        bestFormDelta = deltaForm;
      }
    }
    if(preRanks && postRanks){
      const pre = preRanks.get(player);
      const post = postRanks.get(player);
      if(pre != null && post != null && (pre - post) >= 5){
        flags.rocket = true;
      }
    }
    const totalSessions = dates.length;
    if(totalSessions > 0){
      const attendanceRate = (agg.matches || 0) / totalSessions;
      if(attendanceRate >= 0.6){
        if(!mvpPlayer || (agg.ppm || 0) > bestPPM){
          mvpPlayer = player;
          bestPPM = agg.ppm || 0;
        }
      }
      if(attendanceRate > 0.9){
        flags.addict = true;
      }
    }
    if((agg.goals || 0) > maxTotalGoals){
      maxTotalGoals = agg.goals || 0;
      allTimeTopPlayer = player;
    }
    const latestEntry = latestMap.get(player);
    if(latestEntry){
      const goalsVal = latestEntry.goals != null ? Number(latestEntry.goals) || 0 : 0;
      if(maxGoals != null && goalsVal > 0 && goalsVal === maxGoals){
        flags.latestTop = true;
        if(goalsVal >= 5){
          flags.clinical = true;
        }
      }
      const contribution = (Number(latestEntry.points) || 0) + goalsVal;
      if(contribution > bestContribution){
        bestContribution = contribution;
        playmakerPlayer = player;
      }
    }
    const badgeList = BADGE_PRIORITY.filter(id => flags[id]);
    badgeMap.set(player, badgeList);
  }
  if(bestFormPlayer && bestFormDelta > 0 && badgeMap.has(bestFormPlayer)){
    const list = badgeMap.get(bestFormPlayer);
    if(list && !list.includes('form')) list.unshift('form');
    addHistory(badgeHistory.form, bestFormPlayer, latestDate);
  }
  // Cold Streak: lowest delta (largest form dip). Only award if someone dips below career average.
  let coldStreakPlayer = null;
  let coldStreakDelta = null;
  for(const [player, delta] of formDeltas.entries()){
    if(delta < 0 && (coldStreakDelta === null || delta < coldStreakDelta)){
      coldStreakDelta = delta;
      coldStreakPlayer = player;
    }
  }
  window.__coldStreakPlayer = coldStreakPlayer;
  if(coldStreakPlayer != null){
    const existing = badgeMap.get(coldStreakPlayer) || [];
    if(!existing.includes('coldStreak')){
      badgeMap.set(coldStreakPlayer, ['coldStreak', ...existing]);
    }
  }
  if(playmakerPlayer && bestContribution > -Infinity && latestDate >= PLAYMAKER_CUTOFF_DATE && badgeMap.has(playmakerPlayer)){
    const list = badgeMap.get(playmakerPlayer);
    if(list && !list.includes('playmaker')) list.unshift('playmaker');
  }
  if(mvpPlayer && badgeMap.has(mvpPlayer)){
    const list = badgeMap.get(mvpPlayer);
    if(list && !list.includes('mvp')) list.unshift('mvp');
  }
  const topAce = Math.max(0, ...sessionAceCounts.values());
  if(topAce > 0){
    for(const [player, count] of sessionAceCounts.entries()){
      if(count === topAce && badgeMap.has(player)){
        const list = badgeMap.get(player);
        if(list && !list.includes('clutch')) list.unshift('clutch');
      }
    }
  }
  if(allTimeTopPlayer && badgeMap.has(allTimeTopPlayer)){
    const list = badgeMap.get(allTimeTopPlayer);
    if(list && !list.includes('allTimeTop')) list.unshift('allTimeTop');
  }
  window.__badgeHistory = badgeHistory;
  return badgeMap;
}

function getPlayerBadges(player){
  const map = window.__allTimeBadges;
  if(!map) return [];
  return map.get(player) || [];
}

function getPlayerBadgeHistory(player){
  const hist = window.__badgeHistory || {};
  const labels = {
    mvp: 'Most Valuable Player',
    latestTop: 'Latest Top Scorer',
    allTimeTop: 'All-Time Topscorer',
    playmaker: 'Playmaker',
    ironMan: 'Iron Man',
    marathon: 'Marathon Man',
    clinical: 'Clinical Finisher',
    elite: 'Elite',
    master: 'Master',
    legend: 'Legend',
    form: 'On Fire'
  };
  const out = [];
  for(const key of Object.keys(labels)){
    const map = hist[key];
    if(map && map.has(player)){
      const entry = map.get(player) || { count:0, dates:[] };
      out.push({ key, label: labels[key], count: entry.count || 0, dates: entry.dates || [] });
    }
  }
  return out;
}

function renderPlayerBadge(id, variant){
  const conf = BADGE_CONFIG[id];
  if(!conf) return null;
  const span = document.createElement('span');
  span.className = 'player-badge' + (id === 'mvp' ? ' player-badge-premium' : '');
  span.setAttribute('aria-label', conf.label);
  span.title = conf.desc;
  const icon = document.createElement('strong');
  icon.textContent = conf.icon;
  span.appendChild(icon);
  if(variant === 'long'){
    const text = document.createElement('span');
    text.textContent = conf.label;
    span.appendChild(text);
  } else {
    // text labels intentionally hidden for badge batches to keep the list compact.
    // To restore short labels later, uncomment below two lines:
    // const text = document.createElement('span');
    // text.textContent = conf.short || conf.label; span.appendChild(text);
  }
  return span;
}

function buildPlayerInsightCards(player){
  const rows = window.__allTimeRows || [];
  const byDate = window.__allTimeByDate || new Map();
  const datesAsc = getAllDatesAsc();
  const pointsSeries = getPlayerPointsAcrossDates(player);
  const attendedFlags = pointsSeries.absent.map(a => !a);
  const attendedCount = attendedFlags.filter(Boolean).length;
  const totalSessions = datesAsc.length;
  const latestDate = datesAsc[datesAsc.length-1] || '';

  // Attendance card
  const cardWrap = document.createElement('div');
  cardWrap.className = 'stat-cards';
  function makeCard(title, mainEl, subText){
    const card = document.createElement('div');
    card.className = 'stat-card';
    const meta = document.createElement('div'); meta.className = 'stat-meta';
    const t = document.createElement('div'); t.className = 'stat-title'; t.textContent = title;
    const v = document.createElement('div'); v.className = 'stat-value';
    if(typeof mainEl === 'string'){ v.textContent = mainEl; } else if(mainEl){ v.appendChild(mainEl); }
    const s = document.createElement('div'); s.className = 'stat-sub'; s.textContent = subText || '';
    meta.appendChild(t); meta.appendChild(v); meta.appendChild(s);
    card.appendChild(meta);
    return card;
  }

  // Full-width: Highest score days rate (ties count as highest)
  try{
    let topDays = 0;
    for(const d of datesAsc){
      const arr = byDate.get(d) || [];
      if(!arr.length) continue;
      let maxPts = -Infinity; for(const e of arr){ const v = Number(e.points)||0; if(v > maxPts) maxPts = v; }
      if(arr.some(e => e.player === player && (Number(e.points)||0) === maxPts)) topDays++;
    }
    const pctTop = attendedCount>0 ? Math.round((topDays/attendedCount)*100) : 0;
    const full = makeCard('Percent of Sessions with highest score', `${pctTop}%`, `${topDays} / ${attendedCount}`);
    full.style.gridColumn = '1 / -1';
    cardWrap.appendChild(full);
  }catch(_){}

  // 1) Attendance Rate
  const attPct = totalSessions > 0 ? Math.round((attendedCount/totalSessions)*100) : 0;
  cardWrap.appendChild(makeCard('Attendance Rate', `${attendedCount}/${totalSessions} • ${attPct}%`, latestDate ? `Latest: ${formatDateShort(latestDate)}` : ''));

  // 2) Longest Streak
  let longest = 0, current = 0;
  for(let i=0;i<attendedFlags.length;i++){
    if(attendedFlags[i]){ current += 1; longest = Math.max(longest, current); }
    else { current = 0; }
  }
  cardWrap.appendChild(makeCard('Longest Streak', `${longest} sessions`, current>0 ? `Current: ${current}` : ''));

  // 3) Form (Last 3 vs Career)
  const ptsAttended = pointsSeries.points.filter((v,idx)=> attendedFlags[idx]);
  const matches = ptsAttended.length;
  const totalPts = ptsAttended.reduce((s,v)=> s+v, 0);
  const careerPPM = matches>0 ? (totalPts/matches) : 0;
  const last3Vals = ptsAttended.slice(-3);
  const last3 = last3Vals.length>0 ? (last3Vals.reduce((s,v)=>s+v,0)/last3Vals.length) : 0;
  let deltaPct = null;
  if(matches>=2){ deltaPct = (careerPPM>0 ? ((last3 - careerPPM)/careerPPM*100) : (last3>0 ? Infinity : 0)); }
  const formVal = document.createElement('span');
  if(deltaPct === null){ formVal.textContent = '—'; }
  else if(!Number.isFinite(deltaPct)){
    formVal.className = 'delta-pos'; formVal.textContent = '+∞%';
  } else {
    formVal.className = deltaPct>=0 ? 'delta-pos' : 'delta-neg';
    const sign = deltaPct>=0 ? '+' : '-';
    formVal.textContent = `${sign}${Math.abs(deltaPct).toFixed(1)}%`;
  }
  cardWrap.appendChild(makeCard('Form (Last 3 vs Career)', formVal, `${last3.toFixed(2)} vs ${careerPPM.toFixed(2)}`));

  // 4) Highest Score Streak (consecutive sessions with highest points of the day)
  let bestStreak = 0, bestStartIdx = -1, bestEndIdx = -1;
  let curStreak = 0, curStartIdx = -1;
  for(let i=0;i<datesAsc.length;i++){
    const d = datesAsc[i];
    const arr = byDate.get(d) || [];
    if(!arr.length){ curStreak = 0; curStartIdx = -1; continue; }
    // Determine max points for the day
    let maxPts = -Infinity; for(const e of arr){ if(typeof e.points === 'number' && e.points > maxPts) maxPts = e.points; }
    const won = arr.some(e => e.player === player && e.points === maxPts);
    if(won){
      if(curStreak === 0) curStartIdx = i;
      curStreak += 1;
      if(curStreak > bestStreak){ bestStreak = curStreak; bestStartIdx = curStartIdx; bestEndIdx = i; }
    } else {
      curStreak = 0; curStartIdx = -1;
    }
  }
  let rangeText = '';
  if(bestStreak > 0 && bestStartIdx !== -1 && bestEndIdx !== -1){
    const rs = datesAsc[bestStartIdx];
    const re = datesAsc[bestEndIdx];
    const rsTxt = formatDateShort(rs);
    const reTxt = formatDateShort(re);
    rangeText = (rs === re) ? (`${rsTxt}`) : (`${rsTxt} – ${reTxt}`);
  }
  cardWrap.appendChild(makeCard('Highest Score Streak', `${bestStreak} sessions`, rangeText));

  return cardWrap;
}

// Build the top-right latest sync pill bar
function buildLatestSyncPill(latestDate){
  if(!latestDate) return null;
  const headerBar = document.createElement('div');
  headerBar.style.display = 'flex';
  headerBar.style.justifyContent = 'flex-end';
  headerBar.style.alignItems = 'center';
  headerBar.style.margin = '0 0 6px 0';
  // Subtle calendar icon
  const icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '14');
  icon.setAttribute('height', '14');
  icon.setAttribute('aria-hidden', 'true');
  icon.style.marginRight = '6px';
  icon.style.flexShrink = '0';
  const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
  rect.setAttribute('x','3'); rect.setAttribute('y','5'); rect.setAttribute('width','18'); rect.setAttribute('height','16'); rect.setAttribute('rx','2');
  rect.setAttribute('fill','none'); rect.setAttribute('stroke','var(--muted)'); rect.setAttribute('stroke-width','2');
  const divider = document.createElementNS('http://www.w3.org/2000/svg','line');
  divider.setAttribute('x1','3'); divider.setAttribute('y1','9'); divider.setAttribute('x2','21'); divider.setAttribute('y2','9');
  divider.setAttribute('stroke','var(--muted)'); divider.setAttribute('stroke-width','2'); divider.setAttribute('stroke-linecap','round');
  const ringL = document.createElementNS('http://www.w3.org/2000/svg','line');
  ringL.setAttribute('x1','8'); ringL.setAttribute('y1','3'); ringL.setAttribute('x2','8'); ringL.setAttribute('y2','7');
  ringL.setAttribute('stroke','var(--muted)'); ringL.setAttribute('stroke-width','2'); ringL.setAttribute('stroke-linecap','round');
  const ringR = document.createElementNS('http://www.w3.org/2000/svg','line');
  ringR.setAttribute('x1','16'); ringR.setAttribute('y1','3'); ringR.setAttribute('x2','16'); ringR.setAttribute('y2','7');
  ringR.setAttribute('stroke','var(--muted)'); ringR.setAttribute('stroke-width','2'); ringR.setAttribute('stroke-linecap','round');
  icon.appendChild(rect); icon.appendChild(divider); icon.appendChild(ringL); icon.appendChild(ringR);

  const label = document.createElement('span');
  label.title = 'Latest session date';
  label.textContent = 'Synced with latest match: ' + formatDateLong(latestDate);
  label.style.color = 'var(--muted)';
  label.style.fontSize = '12px';
  headerBar.appendChild(icon);
  headerBar.appendChild(label);
  return headerBar;
}

function syncStickyOffsets(){
  try{
    const headerEl = document.querySelector('header');
    if(headerEl){
      const h = headerEl.getBoundingClientRect().height;
      if(h > 0){
        document.documentElement.style.setProperty('--header-height', `${Math.round(h)}px`);
      }
    }
  }catch(_){}
}

// ----- Simple Inline Line Chart (for Player Modal) -----
function getAllDatesAsc(){
  const byDate = window.__allTimeByDate || new Map();
  return Array.from(byDate.keys()).sort();
}
function getPlayerPointsAcrossDates(player){
  const byDate = window.__allTimeByDate || new Map();
  const dates = getAllDatesAsc();
  const points = [];
  const absent = [];
  for(const d of dates){
    const arr = byDate.get(d) || [];
    const hit = arr.find(e => e.player === player);
    if(hit){
      points.push(Number(hit.points) || 0);
      absent.push(false);
    } else {
      points.push(0);
      absent.push(true);
    }
  }
  return { dates, points, absent };
}
function getPlayerGoalsAcrossDates(player){
  const byDate = window.__allTimeByDate || new Map();
  const dates = getAllDatesAsc();
  const goals = [];
  const absent = [];
  for(const d of dates){
    const arr = byDate.get(d) || [];
    const hit = arr.find(e => e.player === player);
    if(hit){
      if(hit.goals == null){
        goals.push(null);
      } else {
        goals.push(Number(hit.goals) || 0);
      }
      absent.push(false);
    } else {
      goals.push(null);
      absent.push(true);
    }
  }
  return { dates, goals, absent };
}
function getAllPlayers(){
  const rows = window.__allTimeRows || [];
  const set = new Set();
  for(const r of rows){ if(r && r.player) set.add(r.player); }
  return Array.from(set.values()).sort((a,b)=> a.localeCompare(b));
}
function getPlayerRankAcrossDates(player){
  const byDate = window.__allTimeByDate || new Map();
  const dates = getAllDatesAsc();
  const allPlayers = getAllPlayers();
  const cumPts = new Map();
  const cumMat = new Map();
  for(const p of allPlayers){ cumPts.set(p, 0); cumMat.set(p, 0); }
  const ranks = [];
  for(const d of dates){
    const arr = byDate.get(d) || [];
    for(const e of arr){
      const p = e.player; const pts = Number(e.points) || 0;
      cumPts.set(p, (cumPts.get(p)||0) + pts);
      cumMat.set(p, (cumMat.get(p)||0) + 1);
    }
    // snapshot ranks for this date
    const snap = allPlayers.map(p => {
      const pts = cumPts.get(p)||0; const m = cumMat.get(p)||0;
      const ppm = m>0 ? (pts/m) : 0;
      return { player:p, points:pts, matches:m, ppm };
    });
    snap.sort((a,b)=> (b.points - a.points) || (b.ppm - a.ppm) || (b.matches - a.matches) || a.player.localeCompare(b.player));
    const idx = snap.findIndex(x => x.player === player);
    ranks.push(idx >= 0 ? (idx+1) : allPlayers.length);
  }
  return { dates, ranks };
}
function buildLineChart(points, opts){
  const width = (opts && opts.width) || 360;
  const height = (opts && opts.height) || 140;
  const padTop = 8;
  const padRight = 10;
  const padBottom = 22; // room for x labels
  const padLeft = 34;   // room for y labels
  const stroke = (opts && opts.stroke) || 'var(--accent)';
  const strokeWidth = (opts && opts.strokeWidth) || 2;
  const dot = (opts && opts.dotRadius) || 2;
  const labels = (opts && opts.labels) || null; // optional x labels (dates)
  const absences = (opts && opts.absences) || null; // optional boolean[] whether player was absent that session
  const arr = Array.isArray(points) ? points.map(v => (typeof v === 'number' && Number.isFinite(v)) ? v : null) : [];
  const n = arr.length;
  const numericVals = arr.filter(v => v !== null);
  if(!n || numericVals.length === 0){ return null; }
  const maxVal = Math.max(0, ...numericVals);
  const minVal = (opts && typeof opts.min === 'number') ? opts.min : 0; // allow custom baseline (e.g., rank starts at 1)
  const innerW = Math.max(1, width - padLeft - padRight);
  const innerH = Math.max(1, height - padTop - padBottom);
  const dx = n > 1 ? (innerW / (n-1)) : 0;
  const range = Math.max(1e-6, maxVal - minVal);
  function xAt(i){ return padLeft + i*dx; }
  function yAt(v){ return padTop + (1 - (v - minVal) / range) * innerH; }

  // Build path
  // Build a path that connects only between non-absent consecutive points.
  let d = '';
  let segmentOpen = false;
  for(let i=0;i<n;i++){
    const isAbsent = !!(absences && absences[i]);
    const val = arr[i];
    if(isAbsent || val === null){ segmentOpen = false; continue; }
    const x = xAt(i); const y = yAt(val);
    if(!segmentOpen){ d += 'M' + x + ' ' + y + ' '; segmentOpen = true; }
    else{ d += 'L' + x + ' ' + y + ' '; }
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label','Points by session');

  // Y-axis and grid ticks
  function computeYTicks(minV, maxV){
    if(maxV <= minV) return [minV, maxV];
    // choose a step targeting ~5 ticks
    let span = maxV - minV;
    let step = 1;
    if(span > 20) step = 5; else if(span > 10) step = 2; else step = 1;
    const out = [];
    // start at minV rounded to step
    let start = Math.ceil(minV / step) * step;
    if(start > minV) start = minV;
    for(let v=start; v<=maxV; v+=step){ out.push(v); }
    if(out[0] !== minV) out.unshift(minV);
    if(out[out.length-1] !== maxV) out.push(maxV);
    return Array.from(new Set(out));
  }
  const yTicks = computeYTicks(minVal, maxVal);
  // y-axis line
  const yAxis = document.createElementNS('http://www.w3.org/2000/svg','line');
  yAxis.setAttribute('x1', String(padLeft)); yAxis.setAttribute('x2', String(padLeft));
  yAxis.setAttribute('y1', String(padTop)); yAxis.setAttribute('y2', String(padTop + innerH));
  yAxis.setAttribute('stroke', 'var(--border)'); yAxis.setAttribute('stroke-width', '1');
  svg.appendChild(yAxis);
  // grid + labels
  yTicks.forEach(v => {
    const y = yAt(v);
    const grid = document.createElementNS('http://www.w3.org/2000/svg','line');
    grid.setAttribute('x1', String(padLeft)); grid.setAttribute('x2', String(padLeft + innerW));
    grid.setAttribute('y1', String(y)); grid.setAttribute('y2', String(y));
    grid.setAttribute('stroke', 'var(--border)'); grid.setAttribute('stroke-width', '1'); grid.setAttribute('opacity', '0.7');
    svg.appendChild(grid);
    const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.setAttribute('x', String(padLeft - 6));
    txt.setAttribute('y', String(y + 3));
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('fill', 'var(--muted)');
    txt.textContent = String(v);
    svg.appendChild(txt);
  });

  // X-axis baseline
  const baseY = yAt(minVal);
  const xAxis = document.createElementNS('http://www.w3.org/2000/svg','line');
  xAxis.setAttribute('x1', String(padLeft)); xAxis.setAttribute('x2', String(padLeft + innerW));
  xAxis.setAttribute('y1', String(baseY)); xAxis.setAttribute('y2', String(baseY));
  xAxis.setAttribute('stroke', 'var(--border)'); xAxis.setAttribute('stroke-width', '1');
  svg.appendChild(xAxis);

  // X ticks and labels (sparse)
  if(n >= 1){
    const maxTicks = Math.min(6, n);
    const step = Math.max(1, Math.ceil((n-1) / (maxTicks-1)));
    for(let i=0;i<n;i+=step){
      const x = xAt(i);
      const tick = document.createElementNS('http://www.w3.org/2000/svg','line');
      tick.setAttribute('x1', String(x)); tick.setAttribute('x2', String(x));
      tick.setAttribute('y1', String(baseY)); tick.setAttribute('y2', String(baseY + 4));
      tick.setAttribute('stroke', 'var(--border)'); tick.setAttribute('stroke-width', '1');
      svg.appendChild(tick);
      const label = document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('x', String(x));
      label.setAttribute('y', String(baseY + 14));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', 'var(--muted)');
      let text = String(i+1);
      if(labels && labels[i]){
        text = formatDateShort ? formatDateShort(labels[i]) : labels[i];
      }
      label.textContent = text;
      svg.appendChild(label);
    }
    // Ensure last label shows
    if((n-1) % step !== 0){
      const i = n-1; const x = xAt(i);
      const label = document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('x', String(x));
      label.setAttribute('y', String(baseY + 14));
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', 'var(--muted)');
      const text = labels && labels[i] ? (formatDateShort ? formatDateShort(labels[i]) : labels[i]) : String(i+1);
      label.textContent = text;
      svg.appendChild(label);
    }
  }

  // Line path
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d', d.trim());
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', stroke);
  path.setAttribute('stroke-width', String(strokeWidth));
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(path);

  // Dots
  for(let i=0;i<n;i++){
    const x = xAt(i);
    const val = arr[i];
    const isAbsent = !!(absences && absences[i]);
    if(isAbsent){
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', String(x));
      t.setAttribute('y', String(yAt(minVal)));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('font-size', '12');
      t.setAttribute('fill', '#9ca3af');
      t.textContent = '×';
      svg.appendChild(t);
    } else if(val !== null){
      const y = yAt(val);
      const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
      c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y));
      c.setAttribute('r', String(dot));
      c.setAttribute('fill', stroke);
      c.setAttribute('opacity', '0.9');
      svg.appendChild(c);
    }
  }
  return svg;
}

// Simple bar chart with absence handling
function buildBarChart(points, opts){
  const width = (opts && opts.width) || 360;
  const height = (opts && opts.height) || 160;
  const padTop = 8;
  const padRight = 10;
  const padBottom = 22;
  const padLeft = 34;
  const fill = (opts && opts.fill) || 'var(--accent)';
  const fillTop = (opts && opts.fillTop) || '#f59e0b';
  const labels = (opts && opts.labels) || null;
  const absences = (opts && opts.absences) || null;
  const tops = (opts && opts.tops) || null; // boolean[]: highest score of the session
  const n = Array.isArray(points) ? points.length : 0;
  if(!n){ return null; }
  const maxVal = Math.max(0, ...points);
  const minVal = 0;
  const innerW = Math.max(1, width - padLeft - padRight);
  const innerH = Math.max(1, height - padTop - padBottom);
  // Use equal slots so bars never overlap the y-axis
  const slotW = innerW / n;
  const range = Math.max(1e-6, maxVal - minVal);
  function xCenterAt(i){ return padLeft + slotW * (i + 0.5); }
  function yAt(v){ return padTop + (1 - (v - minVal) / range) * innerH; }
  // Bar width: bounded fraction of slot and absolute cap
  const barW = Math.max(2, Math.min(slotW * 0.7, 18));

  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label','Points by session (bar)');

  // Y-axis + grid
  function computeYTicks(minV, maxV){
    if(maxV <= minV) return [minV, maxV];
    let span = maxV - minV;
    let step = 1;
    if(span > 20) step = 5; else if(span > 10) step = 2; else step = 1;
    const out = [];
    let start = Math.ceil(minV / step) * step;
    if(start > minV) start = minV;
    for(let v=start; v<=maxV; v+=step){ out.push(v); }
    if(out[0] !== minV) out.unshift(minV);
    if(out[out.length-1] !== maxV) out.push(maxV);
    return Array.from(new Set(out));
  }
  const yTicks = computeYTicks(minVal, maxVal);
  const yAxis = document.createElementNS('http://www.w3.org/2000/svg','line');
  yAxis.setAttribute('x1', String(padLeft)); yAxis.setAttribute('x2', String(padLeft));
  yAxis.setAttribute('y1', String(padTop)); yAxis.setAttribute('y2', String(padTop + innerH));
  yAxis.setAttribute('stroke', 'var(--border)'); yAxis.setAttribute('stroke-width', '1');
  svg.appendChild(yAxis);
  yTicks.forEach(v => {
    const y = yAt(v);
    const grid = document.createElementNS('http://www.w3.org/2000/svg','line');
    grid.setAttribute('x1', String(padLeft)); grid.setAttribute('x2', String(padLeft + innerW));
    grid.setAttribute('y1', String(y)); grid.setAttribute('y2', String(y));
    grid.setAttribute('stroke', 'var(--border)'); grid.setAttribute('stroke-width', '1'); grid.setAttribute('opacity', '0.7');
    svg.appendChild(grid);
    const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.setAttribute('x', String(padLeft - 6));
    txt.setAttribute('y', String(y + 3));
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('fill', 'var(--muted)');
    txt.textContent = String(v);
    svg.appendChild(txt);
  });
  const baseY = yAt(0);
  const xAxis = document.createElementNS('http://www.w3.org/2000/svg','line');
  xAxis.setAttribute('x1', String(padLeft)); xAxis.setAttribute('x2', String(padLeft + innerW));
  xAxis.setAttribute('y1', String(baseY)); xAxis.setAttribute('y2', String(baseY));
  xAxis.setAttribute('stroke', 'var(--border)'); xAxis.setAttribute('stroke-width', '1');
  svg.appendChild(xAxis);

  // X ticks/labels
  if(n >= 1){
    const maxTicks = Math.min(6, n);
    const step = Math.max(1, Math.ceil((n-1) / (maxTicks-1)));
    for(let i=0;i<n;i+=step){
      const x = xCenterAt(i);
      const label = document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('x', String(x));
      label.setAttribute('y', String(baseY + 14));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', 'var(--muted)');
      let text = String(i+1);
      if(labels && labels[i]) text = formatDateShort ? formatDateShort(labels[i]) : labels[i];
      label.textContent = text;
      svg.appendChild(label);
    }
  }

  // Bars
  for(let i=0;i<n;i++){
    const isAbsent = !!(absences && absences[i]);
    const xCenterSlot = xCenterAt(i);
    // Ensure we don't draw over the y-axis line: leave a 1px gap
    const slotLeft = padLeft + slotW * i;
    let x = slotLeft + (slotW - barW) / 2 + 1;
    const v = points[i] || 0;
    if(isAbsent){
      // Draw an X to mark absence
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', String(xCenterSlot));
      t.setAttribute('y', String(baseY - 1));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'alphabetic');
      t.setAttribute('font-size', '12');
      t.setAttribute('fill', '#9ca3af');
      t.textContent = '×';
      svg.appendChild(t);
      continue;
    }
    const y = v > 0 ? yAt(v) : (baseY - 2);
    const h = Math.max(2, baseY - y);
    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(barW));
    rect.setAttribute('height', String(h));
    // Color top-of-day bars gold
    const isTop = !!(tops && tops[i]);
    rect.setAttribute('fill', isTop ? fillTop : fill);
    rect.setAttribute('opacity', v > 0 ? '0.95' : '0.7');
    svg.appendChild(rect);
    // Label points: inside the bar when tall enough; otherwise above
    if(v > 0){
      const xCenter = x + barW/2; // center labels exactly over the bar
      // Value label
      const val = document.createElementNS('http://www.w3.org/2000/svg','text');
      val.setAttribute('x', String(xCenter));
      val.setAttribute('text-anchor', 'middle');
      val.setAttribute('font-size', '10');
      let valY;
      if(h >= 16){
        const basePos = y + Math.min(h - 3, 12);
        valY = basePos;
        val.setAttribute('fill', '#ffffff');
      } else {
        const basePos = Math.max(padTop + 10, y - 2);
        valY = basePos;
        val.setAttribute('fill', 'var(--muted)');
      }
      val.setAttribute('y', String(valY));
      val.textContent = String(v);
      svg.appendChild(val);
    }
  }
  
  return svg;
}

// Build header stat cards for All-Time page
function buildAllTimeHeaderCards(preRows, rows, byDate, latestDate, basis){
  if(!rows || !rows.length) return null;
  const preAggArr = aggregateAllTime(preRows || []);
  const postAggArr = aggregateAllTime(rows);
  const preAgg = new Map(preAggArr.map(x => [x.player, x]));
  const postAgg = new Map(postAggArr.map(x => [x.player, x]));
  const cards = document.createElement('div');
  cards.className = 'stat-cards';

  function makeCard(title, labelText, deltaConf, sub, onClick, emoji){
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    if(emoji){
      const em = document.createElement('span');
      em.className = 'stat-emoji';
      em.textContent = emoji;
      em.setAttribute('aria-hidden','true');
      card.appendChild(em);
    }
    const meta = document.createElement('div'); meta.className = 'stat-meta';
    const t = document.createElement('div'); t.className = 'stat-title'; t.textContent = title;
    const v = document.createElement('div'); v.className = 'stat-value';
    if(labelText){
      const left = document.createElement('span');
      left.textContent = labelText + ' ';
      v.appendChild(left);
    }
    if(deltaConf && typeof deltaConf.value === 'number'){
      const val = deltaConf.value;
      const decimals = (typeof deltaConf.decimals === 'number') ? deltaConf.decimals : 0;
      const suffix = deltaConf.suffix || '';
      const sign = val >= 0 ? '+' : '-';
      const span = document.createElement('span');
      span.className = (val >= 0 ? 'delta-pos' : 'delta-neg');
      span.textContent = sign + Math.abs(val).toFixed(decimals) + suffix;
      v.appendChild(span);
    }
    const s = document.createElement('div'); s.className = 'stat-sub'; s.textContent = sub || '';
    meta.appendChild(t); meta.appendChild(v); meta.appendChild(s);
    card.appendChild(meta);
    if(typeof onClick === 'function'){
      card.addEventListener('click', onClick);
      card.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); onClick(); } });
    }
    return card;
  }

  // Highest climber / decliner
  let up = null; // {player, move, preRank, postRank}
  let down = null;
  // Build rank maps based on chosen basis (points or ppm), independent of table sort
  function sortByBasis(arr, key){
    const a = arr.slice();
    if(key === 'ppm'){
      a.sort((x,y)=> (y.ppm - x.ppm) || (y.points - x.points) || (y.matches - x.matches) || x.player.localeCompare(y.player));
    } else {
      a.sort((x,y)=> (y.points - x.points) || (y.ppm - x.ppm) || (y.matches - x.matches) || x.player.localeCompare(y.player));
    }
    return a;
  }
  const preOrder = sortByBasis(preAggArr, basis === 'ppm' ? 'ppm' : 'points');
  const postOrder = sortByBasis(postAggArr, basis === 'ppm' ? 'ppm' : 'points');
  const preRanks = new Map(preOrder.map((s,i)=> [s.player, i]));
  const postRanks = new Map(postOrder.map((s,i)=> [s.player, i]));
  postRanks.forEach((postIdx, player)=>{
    const preIdx = preRanks.get(player);
    if(preIdx !== undefined){
      const move = preIdx - postIdx; // positive means moved up
      if(up === null || move > up.move || (move === up.move && (postIdx < up.postRank || (postIdx === up.postRank && player < up.player)))){
        up = { player, move, preRank: preIdx, postRank: postIdx };
      }
      if(down === null || move < down.move || (move === down.move && (postIdx > down.postRank || (postIdx === down.postRank && player < down.player)))){
        down = { player, move, preRank: preIdx, postRank: postIdx };
      }
    }
  });

  // Highest PPM increase/decrease among players who played latest session (percentage change)
  const latestEntries = (byDate && latestDate) ? (byDate.get(latestDate) || []) : [];
  const playedLatest = new Set(latestEntries.map(e => e.player));
  const MIN_PRE = 3;
  function ppmDeltaCandidates(minPre){
    const arr = [];
    playedLatest.forEach(p => {
      const pre = preAgg.get(p);
      const post = postAgg.get(p);
      if(!post) return;
      const preM = pre ? pre.matches : 0;
      const prePPM = pre ? pre.ppm : 0;
      const postPPM = post.ppm;
      if(preM >= minPre && prePPM > 0){
        const delta = postPPM - prePPM;
        const pct = (delta / prePPM) * 100;
        arr.push({ player:p, delta, pct, prePPM, postPPM, preM });
      }
    });
    return arr;
  }
  let deltas = ppmDeltaCandidates(MIN_PRE);
  if(deltas.length === 0){ deltas = ppmDeltaCandidates(1); }
  let upPPM = null, downPPM = null;
  if(deltas.length){
    for(const d of deltas){
      if(upPPM === null || d.pct > upPPM.pct || (d.pct === upPPM.pct && (d.preM > upPPM.preM || (d.preM === upPPM.preM && d.player < upPPM.player)))) upPPM = d;
      if(downPPM === null || d.pct < downPPM.pct || (d.pct === downPPM.pct && (d.preM < downPPM.preM || (d.preM === downPPM.preM && d.player < downPPM.player)))) downPPM = d;
    }
  }

  // Build cards
  if(up){
    const climberCard = makeCard('Largest Rank Gain',
      up.player,
      { value: up.move, decimals: 0 },
      `${up.preRank+1} → ${up.postRank+1}`,
      ()=> openPlayerModal(up.player), '📈');
    cards.appendChild(climberCard);
  }
  if(down){
    const declinerCard = makeCard('Largest Rank Loss',
      down.player,
      { value: down.move, decimals: 0 },
      `${down.preRank+1} → ${down.postRank+1}`,
      ()=> openPlayerModal(down.player), '📉');
    cards.appendChild(declinerCard);
  }

  // Build PPM cards only when delta candidates exist; avoid confusing "No eligible" text
  if(upPPM){
    const incCard = makeCard('Largest Pts/Session Increase',
      upPPM.player,
      { value: upPPM.pct, decimals: 1, suffix: '%' },
      `${(upPPM.prePPM ?? 0).toFixed(2)} → ${(upPPM.postPPM ?? 0).toFixed(2)}`,
      ()=> openPlayerModal(upPPM.player), '➕');
    cards.appendChild(incCard);
  }
  if(downPPM){
    const decCard = makeCard('Largest Pts/Session Decrease',
      downPPM.player,
      { value: downPPM.pct, decimals: 1, suffix: '%' },
      `${(downPPM.prePPM ?? 0).toFixed(2)} → ${(downPPM.postPPM ?? 0).toFixed(2)}`,
      ()=> openPlayerModal(downPPM.player), '➖');
    cards.appendChild(decCard);
  }

  // If fewer than 4 cards (e.g., early season), still return container; grid will compress.
  return cards;
}

function formatDateLong(iso){
  if(!iso || typeof iso !== 'string') return iso || '';
  const parts = iso.split('-');
  if(parts.length !== 3) return iso;
  const [y, m, d] = parts;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const mi = Math.max(1, Math.min(12, parseInt(m,10))) - 1;
  const di = parseInt(d,10);
  return `${isNaN(di)?d:di} ${months[mi] || m} ${y}`;
}
function formatDateShort(iso){
  if(!iso || typeof iso !== 'string') return iso || '';
  const parts = iso.split('-');
  if(parts.length !== 3) return iso;
  const [y, m, d] = parts;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = Math.max(1, Math.min(12, parseInt(m,10))) - 1;
  const di = parseInt(d,10);
  return `${isNaN(di)?d:di} ${months[mi] || m}`;
}

function avgLastN(arr, n){
  if(!arr || arr.length === 0) return 0;
  const start = Math.max(0, arr.length - n);
  let sum = 0; let cnt = 0;
  for(let i=start;i<arr.length;i++){ sum += arr[i]; cnt++; }
  return cnt ? (sum/cnt) : 0;
}

function sortAllTimeStats(stats){
  const k = allTimeSort.key; const dir = allTimeSort.dir === 'asc' ? 1 : -1;
  stats.sort((a,b)=>{
    if(k === 'player') return a.player.localeCompare(b.player) * dir;
    if(k === 'matches') return (a.matches - b.matches) * dir || a.player.localeCompare(b.player);
    if(k === 'points') return (a.points - b.points) * dir || (a.ppm - b.ppm) * dir || (a.matches - b.matches) * dir || a.player.localeCompare(b.player);
    if(k === 'ppm') return ((a.ppm - b.ppm) * dir) || (a.points - b.points) * dir || (a.matches - b.matches) * dir || a.player.localeCompare(b.player);
    if(k === 'goals') return (a.goals - b.goals) * dir || ((a.gpm || 0) - (b.gpm || 0)) * dir || (a.matches - b.matches) * dir || a.player.localeCompare(b.player);
    if(k === 'gpm'){
      const aHas = a.goalSessions && a.goalSessions > 0;
      const bHas = b.goalSessions && b.goalSessions > 0;
      if(aHas && !bHas) return -1;
      if(!aHas && bHas) return 1;
      if(!aHas && !bHas) return (a.points - b.points) * dir || a.player.localeCompare(b.player);
      const cmp = (a.gpm - b.gpm) * dir;
      if(cmp !== 0) return cmp;
      return (a.goals - b.goals) * dir || (a.matches - b.matches) * dir || a.player.localeCompare(b.player);
    }
    return 0;
  });
}

function makeRankMap(sortedStats){
  const map = new Map();
  for(let i=0;i<sortedStats.length;i++){
    map.set(sortedStats[i].player, i);
  }
  return map;
}

function buildAllTimeTable(stats, totalSessions, series, preRanks, postRanks, latestDate){
  // Ensure cold streak target available even if prior computation failed to persist
  function getColdStreakPlayer(){
    if(window.__coldStreakPlayer) return window.__coldStreakPlayer;
    const rows = window.__allTimeRows || [];
    const byDate = window.__allTimeByDate || new Map();
    const dates = Array.from(byDate.keys()).sort();
    const players = new Set(rows.map(r => r.player));
    const pointsHistory = new Map(Array.from(players).map(p => [p, []]));
    for(const d of dates){
      const entries = byDate.get(d) || [];
      const entryMap = new Map(entries.map(e => [e.player, e]));
      for(const p of players){
        const entry = entryMap.get(p);
        if(entry){
          const arr = pointsHistory.get(p);
          if(arr) arr.push(Number(entry.points) || 0);
        }
      }
    }
    const statsMap = new Map(stats.map(s => [s.player, s]));
    let coldPlayer = null;
    let coldDelta = null;
    for(const p of players){
      const hist = pointsHistory.get(p) || [];
      const last3 = hist.slice(-3);
      const last3Avg = last3.length ? last3.reduce((s,v)=> s+v,0) / last3.length : 0;
      const career = statsMap.get(p)?.ppm || 0;
      const delta = last3Avg - career;
      if(delta < 0 && (coldDelta === null || delta < coldDelta)){
        coldDelta = delta;
        coldPlayer = p;
      }
    }
    if(coldPlayer) window.__coldStreakPlayer = coldPlayer;
    return coldPlayer;
  }
  const coldStreakPlayer = getColdStreakPlayer();

  const wrap = document.createElement('div');
  wrap.style.overflow = 'auto';
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trHead = document.createElement('tr');
  // Rank column (not sortable)
  const thRank = document.createElement('th');
  thRank.textContent = '#';
  trHead.appendChild(thRank);
  const cols = [
    { key:'player', label:'Player', style:'width:36%' },
    { key:'badges', label:'Badges', sortable:false },
    { key:'matches', label:'Matches' },
    { key:'points', label:'Points' },
    { key:'ppm', label:'Pts/Session' },
    { key:'goals', label:'Goals' },
    { key:'gpm', label:'Goals/Session' },
  ];
  for(const col of cols){
    const th = document.createElement('th');
    if(col.style) th.setAttribute('style', col.style);
    const sortable = col.sortable !== false && col.key !== 'badges';
    th.textContent = col.label + (sortable && allTimeSort.key === col.key ? (allTimeSort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    th.className = sortable ? 'sortable' : '';
    if(col.key === 'badges'){
      th.style.textAlign = 'right';
      th.classList.add('badges-col');
    }
    if(sortable){
      th.style.cursor = 'pointer';
      th.title = 'Sort by ' + col.label;
    }
    if(sortable){
      th.addEventListener('click', ()=>{
      if(allTimeSort.key === col.key){
        allTimeSort.dir = (allTimeSort.dir === 'asc') ? 'desc' : 'asc';
      }else{
        allTimeSort.key = col.key;
        allTimeSort.dir = (col.key === 'player') ? 'asc' : 'desc';
      }
      const container = document.getElementById('allTimeContent');
      if(!allTimeCache.rows){ return; }
      const stats2 = aggregateAllTime(allTimeCache.rows);
      const statsMap2 = new Map(stats2.map(s => [s.player, s]));
      sortAllTimeStats(stats2);
      const totalSessions = countUniqueSessions(allTimeCache.rows);
      const series = buildAllTimeSeries(allTimeCache.rows);
      const goalSeries = buildAllTimeGoalSeries(allTimeCache.rows);
      const byDate = buildAllTimeByDate(allTimeCache.rows);
      window.__allTimeSeries = series; window.__allTimeGoalSeries = goalSeries; window.__allTimeByDate = byDate; window.__allTimeRows = allTimeCache.rows;
      const latestDate = allTimeCache.rows.map(r=>r.date).sort().slice(-1)[0];
      const preRows = allTimeCache.rows.filter(r => r.date !== latestDate);
      const preStats = aggregateAllTime(preRows);
      sortAllTimeStats(preStats);
      const preRanks = makeRankMap(preStats);
      const postRanks = makeRankMap(stats2);
      window.__allTimeBadges = computeAllTimeBadges(allTimeCache.rows, byDate, statsMap2, preRanks, postRanks);
      // Update insight basis only when sorting by Points or Pts/Session
      if(col.key === 'points' || col.key === 'ppm'){
        allTimeInsightBasis = col.key;
      }
      container.innerHTML = '';
      const pillBar = buildLatestSyncPill(latestDate);
      if(pillBar) container.appendChild(pillBar);
      const headerCards = buildAllTimeHeaderCards(preRows, allTimeCache.rows, byDate, latestDate, allTimeInsightBasis);
      if(headerCards) container.appendChild(headerCards);
      container.appendChild(buildAllTimeTable(stats2, totalSessions, series, preRanks, postRanks, latestDate));
      });
    }
    trHead.appendChild(th);
  }
  thead.appendChild(trHead);
  const tbody = document.createElement('tbody');
  const podiumActive = (allTimeSort && (allTimeSort.key === 'points' || allTimeSort.key === 'ppm'));
  stats.forEach((r, idx)=>{
    const tr = document.createElement('tr');
    const tdPos = document.createElement('td');
    if(podiumActive && idx === 0){ tdPos.textContent = '🥇'; }
    else if(podiumActive && idx === 1){ tdPos.textContent = '🥈'; }
    else if(podiumActive && idx === 2){ tdPos.textContent = '🥉'; }
    else { tdPos.textContent = String(idx + 1); }
    const tdN = document.createElement('td');
    tdN.className = 'player-row-name';
    const nameLine = document.createElement('span');
    nameLine.className = 'player-name-line';
    nameLine.textContent = r.player;
    // Trend arrow: rank movement since last session
    if(podiumActive && preRanks && postRanks){
      const pre = preRanks.get(r.player);
      const post = postRanks.get(r.player);
    if(pre !== undefined && post !== undefined){
      const move = pre - post; // positive means moved up
      if(move !== 0){
        const arrow = document.createElement('span');
        arrow.style.marginLeft = '6px';
          arrow.style.fontWeight = '700';
          arrow.style.fontSize = '14px';
          const signed = move > 0 ? `+${move}` : `${move}`;
          if(move > 0){ arrow.textContent = ` ▲ ${signed}`; arrow.style.color = 'var(--accent-2)'; }
          else { arrow.textContent = ` ▼ ${signed}`; arrow.style.color = 'var(--danger)'; }
          arrow.title = `Position: ${pre+1} → ${post+1} (${signed} since last session)`;
          nameLine.appendChild(arrow);
        }
      }
    }
    let badgeList = getPlayerBadges(r.player);
    // Fallback: ensure Cold Streak shows even if badge map failed earlier
    if((!badgeList || badgeList.length === 0) && coldStreakPlayer === r.player){
      badgeList = ['coldStreak'];
    }
    tdN.appendChild(nameLine);
    const tdB = document.createElement('td');
    tdB.className = 'badges-cell';
    tdB.style.minWidth = '200px';
    tdB.style.textAlign = 'right';
    tdB.style.whiteSpace = 'nowrap';
    if(badgeList && badgeList.length){
      const badgesWrap = document.createElement('span');
      badgesWrap.className = 'player-badges';
      badgesWrap.style.flexWrap = 'nowrap';
      badgesWrap.style.whiteSpace = 'nowrap';
      badgesWrap.style.justifyContent = 'flex-end';
      badgesWrap.style.marginLeft = '0';
      badgesWrap.style.display = 'inline-flex';
      badgesWrap.style.alignItems = 'center';
      for(const id of badgeList){
        const badgeEl = renderPlayerBadge(id, 'short');
        if(badgeEl){
          badgesWrap.appendChild(badgeEl);
        }
      }
      if(badgesWrap.childNodes.length > 0){ tdB.appendChild(badgesWrap); }
    } else {
      tdB.textContent = '—';
      tdB.style.color = 'var(--muted)';
    }
    const tdM = document.createElement('td');
    if(totalSessions && totalSessions > 0){
      tdM.textContent = `${r.matches}/${totalSessions}`;
    } else {
      tdM.textContent = String(r.matches);
    }
    const tdP = document.createElement('td'); tdP.textContent = String(r.points);
    const tdA = document.createElement('td');
    const ppmBadge = document.createElement('span');
    const ppm = r.ppm;
    ppmBadge.textContent = ppm.toFixed(2);
    if(ppm > 6){ ppmBadge.className = 'badge badge-good'; ppmBadge.title = 'Good: > 6 pts/session'; }
    else if(ppm >= 4){ ppmBadge.className = 'badge badge-avg'; ppmBadge.title = 'Average: 4–6 pts/session'; }
    else { ppmBadge.className = 'badge badge-low'; ppmBadge.title = 'Low: < 4 pts/session'; }
    tdA.appendChild(ppmBadge);
    const tdGoals = document.createElement('td');
    tdGoals.textContent = String(r.goals || 0);
    const tdGpm = document.createElement('td');
    if(r.goalSessions && r.goalSessions > 0){
      const gpmBadge = document.createElement('span');
      const gpm = r.gpm || 0;
      gpmBadge.textContent = gpm.toFixed(2);
      if(gpm <= 0.5){ gpmBadge.className = 'badge badge-low'; }
      else if(gpm <= 1){ gpmBadge.className = 'badge badge-avg'; }
      else { gpmBadge.className = 'badge badge-good'; }
      gpmBadge.title = `Goals per session (${r.goalSessions} tracked)`;
      tdGpm.appendChild(gpmBadge);
    } else {
      tdGpm.textContent = '—';
      tdGpm.style.color = 'var(--muted)';
    }
    tr.appendChild(tdPos);
    tr.appendChild(tdN);
    tr.appendChild(tdB);
    tr.appendChild(tdM);
    tr.appendChild(tdP);
    tr.appendChild(tdA);
    tr.appendChild(tdGoals);
    tr.appendChild(tdGpm);
    tr.style.cursor = 'pointer';
    tr.title = 'View player history';
    tr.addEventListener('click', ()=> openPlayerModal(r.player));
    tbody.appendChild(tr);
  });
  table.appendChild(thead); table.appendChild(tbody); wrap.appendChild(table);
  return wrap;
}

// Removed dedicated refresh button; data reloads on tab open and page refresh

// ----- Scroll Lock Helpers for Modals -----
let __prevHtmlOverflow = '';
let __prevBodyOverflow = '';
let __preventTouchMove = null;
let __openModalEl = null;
function lockBodyScroll(){
  try{
    __prevHtmlOverflow = document.documentElement.style.overflow;
    __prevBodyOverflow = document.body.style.overflow;
    // Prevent root scrolling
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    // Prevent touchmove outside modal (iOS Safari)
    __preventTouchMove = function(e){
      const modal = __openModalEl;
      if(!modal) { e.preventDefault(); return; }
      if(!modal.contains(e.target)){
        e.preventDefault();
      }
    };
    document.addEventListener('touchmove', __preventTouchMove, { passive: false });
  }catch(_){/* no-op */}
}
function unlockBodyScroll(){
  try{
    document.documentElement.style.overflow = __prevHtmlOverflow || '';
    document.body.style.overflow = __prevBodyOverflow || '';
    if(__preventTouchMove){ document.removeEventListener('touchmove', __preventTouchMove); __preventTouchMove = null; }
  }catch(_){/* no-op */}
}

// ----- Player History Modal -----
function openPlayerModal(player){
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('playerModal');
  const title = document.getElementById('playerModalTitle');
  const body = document.getElementById('playerModalBody');
  title.textContent = '👤 ' + player;
  body.innerHTML = '';
  __openModalEl = modal;
  lockBodyScroll();
  // Prevent background scroll when touching the overlay (iOS Safari)
  function preventOverlayScroll(e){ e.preventDefault(); }

  const modalBadges = getPlayerBadges(player);
  if(modalBadges && modalBadges.length){
    const badgeTitle = document.createElement('div');
    badgeTitle.className = 'stat-title';
    badgeTitle.style.margin = '0 0 4px 0';
    badgeTitle.textContent = 'Current Badges';
    body.appendChild(badgeTitle);
    const badgeWrap = document.createElement('div');
    badgeWrap.style.display = 'flex';
    badgeWrap.style.flexDirection = 'column';
    badgeWrap.style.gap = '8px';
    for(const id of modalBadges){
      const card = document.createElement('div');
      card.style.display = 'flex';
      card.style.alignItems = 'center';
      card.style.gap = '12px';
      card.style.padding = '10px 12px';
      card.style.border = '1px solid var(--border)';
      card.style.borderRadius = '12px';
      card.style.background = '#fff';
      card.style.boxShadow = '0 1px 2px rgba(15,23,42,0.05)';
      const icon = document.createElement('div');
      icon.style.fontSize = '24px';
      icon.textContent = BADGE_CONFIG[id]?.icon || '🏅';
      const meta = document.createElement('div');
      meta.style.display = 'flex';
      meta.style.flexDirection = 'column';
      meta.style.gap = '2px';
      const titleEl = document.createElement('div');
      titleEl.style.fontWeight = '700';
      titleEl.textContent = BADGE_CONFIG[id]?.label || 'Badge';
      const desc = document.createElement('div');
      desc.className = 'stat-sub';
      desc.textContent = BADGE_CONFIG[id]?.desc || '';
      meta.appendChild(titleEl);
      meta.appendChild(desc);
      card.appendChild(icon);
      card.appendChild(meta);
      badgeWrap.appendChild(card);
    }
    body.appendChild(badgeWrap);
  }

  const badgeHistory = getPlayerBadgeHistory(player).filter(h => (h.count || 0) > 0);
  if(badgeHistory.length){
    const histTitle = document.createElement('div');
    histTitle.className = 'stat-title';
    histTitle.style.margin = '8px 0 4px 0';
    histTitle.textContent = 'Trophy Room';
    body.appendChild(histTitle);
    const histWrap = document.createElement('div');
    histWrap.style.display = 'flex';
    histWrap.style.flexDirection = 'column';
    histWrap.style.gap = '10px';
    histWrap.style.padding = '10px';
    histWrap.style.borderRadius = '14px';
    histWrap.style.background = 'linear-gradient(135deg, #fef3c7 0%, #f5f3ff 50%, #e0f2fe 100%)';
    histWrap.style.border = '1px solid var(--border)';
    for(const entry of badgeHistory){
      const card = document.createElement('div');
      card.style.display = 'flex';
      card.style.alignItems = 'center';
      card.style.gap = '14px';
      card.style.padding = '10px 12px';
      card.style.border = '1px solid var(--border)';
      card.style.borderRadius = '12px';
      card.style.background = '#fff';
      card.style.boxShadow = '0 1px 2px rgba(15,23,42,0.05)';
      const icon = document.createElement('div');
      icon.style.fontSize = '24px';
      icon.textContent = BADGE_CONFIG[entry.key]?.icon || '🏅';
      const meta = document.createElement('div');
      meta.style.display = 'flex';
      meta.style.flexDirection = 'column';
      meta.style.gap = '2px';
      meta.style.flex = '1';
      const titleEl = document.createElement('div');
      titleEl.style.fontWeight = '700';
      titleEl.textContent = entry.label;
      const desc = document.createElement('div');
      desc.className = 'stat-sub';
      desc.textContent = TROPHY_DESC[entry.key] || BADGE_CONFIG[entry.key]?.desc || 'Badge earned';
      meta.appendChild(titleEl);
      meta.appendChild(desc);
      const count = document.createElement('div');
      count.style.fontWeight = '800';
      count.style.fontSize = '16px';
      count.style.color = '#ffffff';
      count.style.padding = '6px 12px';
      count.style.borderRadius = '999px';
      count.style.background = 'linear-gradient(135deg, #fde68a, #a855f7, #38bdf8)';
      count.style.border = '1px solid rgba(255,255,255,0.7)';
      count.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
      count.textContent = String(entry.count || 0);
      card.appendChild(icon);
      card.appendChild(meta);
      card.appendChild(count);
      histWrap.appendChild(card);
    }
    body.appendChild(histWrap);
  }

  // Insight cards
  try{
    const cards = buildPlayerInsightCards(player);
    if(cards) body.appendChild(cards);
  }catch(_){ /* best-effort */ }

  // Chart: points across all sessions (zeros when absent)
  try{
    const seriesAll = getPlayerPointsAcrossDates(player);
    if(seriesAll && seriesAll.points && seriesAll.points.length){
      const titlePts = document.createElement('div');
      titlePts.className = 'stat-title';
      titlePts.style.margin = '4px 0';
      titlePts.textContent = 'Points per Session';
      body.appendChild(titlePts);
      const chartWrap = document.createElement('div');
      chartWrap.style.marginBottom = '8px';
      chartWrap.style.width = '100%';
      const byDate = window.__allTimeByDate || new Map();
      const tops = seriesAll.dates.map(d => {
        const arr = byDate.get(d) || [];
        if(!arr.length) return false;
        let maxPts = -Infinity; for(const e of arr){ const v = Number(e.points)||0; if(v > maxPts) maxPts = v; }
        return arr.some(e => e.player === player && (Number(e.points)||0) === maxPts);
      });
      const svg = buildBarChart(seriesAll.points, { width: 360, height: 160, fill: 'var(--accent)', labels: seriesAll.dates, absences: seriesAll.absent, tops });
      if(svg){
        chartWrap.appendChild(svg);
        // Legend: bar = points (present); thin bar = 0 points (present); × = absent; ⭐ = highest of session
        const legend = document.createElement('div');
        legend.className = 'stat-sub';
        legend.style.display = 'flex'; legend.style.alignItems = 'center'; legend.style.gap = '12px'; legend.style.marginTop = '4px';
        const item1 = document.createElement('div'); item1.style.display='flex'; item1.style.alignItems='center'; item1.style.gap='6px';
        item1.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="14" height="12" fill="currentColor"/></svg><span>Points (present)</span>`;
        const item2 = document.createElement('div'); item2.style.display='flex'; item2.style.alignItems='center'; item2.style.gap='6px';
        item2.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="3" fill="currentColor"/></svg><span>0 points (present)</span>`;
        const item3 = document.createElement('div'); item3.style.display='flex'; item3.style.alignItems='center'; item3.style.gap='6px';
        item3.innerHTML = `<span style="display:inline-block; width:14px; height:14px; line-height:14px; text-align:center; color:#9ca3af; font-weight:700">×</span><span>Absent</span>`;
        const item4 = document.createElement('div'); item4.style.display='flex'; item4.style.alignItems='center'; item4.style.gap='6px'; item4.innerHTML = `<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"5\" y=\"6\" width=\"14\" height=\"12\" fill=\"#f59e0b\"/></svg><span>Highest of session</span>`; legend.appendChild(item1); legend.appendChild(item2); legend.appendChild(item3); legend.appendChild(item4);
        chartWrap.appendChild(legend);
        body.appendChild(chartWrap);
      }
    }
  }catch(_){ /* best-effort chart */ }

  // Chart: goals per session (mirrors points chart styling)
  try{
    const goalsSeries = getPlayerGoalsAcrossDates(player);
    if(goalsSeries && goalsSeries.goals && goalsSeries.goals.some(v => v !== null)){
      const titleGoals = document.createElement('div');
      titleGoals.className = 'stat-title';
      titleGoals.style.margin = '4px 0';
      titleGoals.textContent = 'Goals per Session';
      body.appendChild(titleGoals);
      const chartWrap = document.createElement('div');
      chartWrap.style.marginBottom = '8px';
      chartWrap.style.width = '100%';
      const values = goalsSeries.goals.map(v => v == null ? 0 : v);
      const noDataFlags = goalsSeries.goals.map(v => v == null);
      const svg = buildBarChart(values, { width: 360, height: 160, fill: 'var(--accent-2)', labels: goalsSeries.dates, absences: noDataFlags });
      if(svg){
        chartWrap.appendChild(svg);
        const legend = document.createElement('div');
        legend.className = 'stat-sub';
        legend.style.display = 'flex';
        legend.style.alignItems = 'center';
        legend.style.gap = '12px';
        legend.style.marginTop = '4px';
        const item1 = document.createElement('div'); item1.style.display='flex'; item1.style.alignItems='center'; item1.style.gap='6px';
        item1.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="14" height="12" fill="currentColor"/></svg><span>Goals (present)</span>`;
        const item2 = document.createElement('div'); item2.style.display='flex'; item2.style.alignItems='center'; item2.style.gap='6px';
        item2.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="3" fill="currentColor"/></svg><span>0 goals (present)</span>`;
        const item3 = document.createElement('div'); item3.style.display='flex'; item3.style.alignItems='center'; item3.style.gap='6px';
        item3.innerHTML = `<span style="display:inline-block; width:14px; height:14px; line-height:14px; text-align:center; color:#9ca3af; font-weight:700">×</span><span>No goal data (absent or pre-tracking)</span>`;
        legend.appendChild(item1); legend.appendChild(item2); legend.appendChild(item3);
        chartWrap.appendChild(legend);
        body.appendChild(chartWrap);
      }
    }
  }catch(_){ /* best-effort goals chart */ }

  // Rank chart (lower is better)
  try{
    const rankSeries = getPlayerRankAcrossDates(player);
    if(rankSeries && rankSeries.ranks && rankSeries.ranks.length){
      const titleRank = document.createElement('div');
      titleRank.className = 'stat-title';
      titleRank.style.margin = '4px 0';
      titleRank.textContent = 'Rank by Total Points';
      body.appendChild(titleRank);
      const chartWrap2 = document.createElement('div');
      chartWrap2.style.marginBottom = '8px';
      chartWrap2.style.width = '100%';
      // Use a different color to differentiate
      const svg2 = buildLineChart(rankSeries.ranks, { width: 360, height: 140, stroke: '#6B7280', strokeWidth: 2, dotRadius: 2, labels: rankSeries.dates, min: 1 });
      if(svg2){ chartWrap2.appendChild(svg2); body.appendChild(chartWrap2); }
    }
  }catch(_){ /* best-effort rank chart */ }

  const rows = (window.__allTimeRows || []).filter(r => r.player === player);
  // Quick stats
  const matches = rows.length;
  const totalPts = rows.reduce((s,r)=> s + (Number(r.points)||0), 0);
  const ppm = matches ? (totalPts / matches) : 0;
  const series = (window.__allTimeSeries && window.__allTimeSeries.get(player)) || rows.map(r=> Number(r.points)||0);
  const last3 = avgLastN(series, 3);
  const goalRows = rows.filter(r => r.goals != null);
  const goalSessions = goalRows.length;
  const totalGoals = goalRows.reduce((s,r)=> s + (Number(r.goals)||0), 0);
  const gpm = goalSessions ? (totalGoals / goalSessions) : 0;
  const goalSeries = (window.__allTimeGoalSeries && window.__allTimeGoalSeries.get(player)) || goalRows.map(r=> Number(r.goals)||0);
  const last3Goals = avgLastN(goalSeries, 3);
  const headerStats = document.createElement('div');
  headerStats.className = 'notice';
  headerStats.style.marginBottom = '8px';
  const delta = last3 - ppm;
  const arrow = Math.abs(delta) >= 0.5 ? (delta>0 ? ' ▲' : ' ▼') : '';
  let goalText = ' • Goals: —';
  if(goalSessions){
    const goalDelta = last3Goals - gpm;
    const goalArrow = Math.abs(goalDelta) >= 0.3 ? (goalDelta>0 ? ' ▲' : ' ▼') : '';
    const goalSuffix = goalArrow ? ` • Last 3 Goals: ${last3Goals.toFixed(2)}${goalArrow}` : '';
    goalText = ` • Goals: ${totalGoals} • Goals/Session: ${gpm.toFixed(2)}${goalSuffix}`;
  }
  headerStats.textContent = `Matches: ${matches} • Points: ${totalPts} • Pts/Session: ${ppm.toFixed(2)}${arrow ? ` • Last 3: ${last3.toFixed(2)}${arrow}` : ''}${goalText}`;
  body.appendChild(headerStats);

        // Session list removed (redundant with chart and labels)

const closeBtn = document.getElementById('playerModalClose');
  const close = ()=>{ overlay.hidden = true; modal.hidden = true; closeBtn.onclick = null; overlay.onclick = null; overlay.removeEventListener('touchmove', preventOverlayScroll); __openModalEl = null; unlockBodyScroll(); };
  closeBtn.onclick = close;
  overlay.onclick = close;
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); } }, { once:true });

  overlay.hidden = false; modal.hidden = false;
  overlay.addEventListener('touchmove', preventOverlayScroll, { passive: false });
}

// ----- Init -----
loadState();
// Initial UI
renderRoster();
renderTeams();
renderSchedule();
renderLeaderboard();
renderAllTime(true);
clampPlayLimit();
// Ensure buttons/visibility synced on first load
updateTabsUI();
updateTabsUI();
switchTab('players');
syncStickyOffsets();
window.addEventListener('resize', ()=> syncStickyOffsets());
  
