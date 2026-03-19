import { getSkill, getStamina } from '../data/config.js';
import { balanceSkillToTargets, balanceStaminaEqualSkill } from '../logic/balance.js';
import {
  computeBandClashError,
  computeSkillError,
  computeStaminaError,
  computeTeamCapacities,
  filterCandidatePool,
  normalizeTeamSignature,
  solveTeams
} from '../logic/team-generator.js';
import { mulberry32, shuffleSeeded } from '../utils/random.js';

const INVESTIGATED_ROSTER = [
  'Aklilu','Danny','David','Frits','Gerjan','Job',
  'Lenn','Ramtin','Rene','Ruben','Thijs','Timo'
];

const BENCHMARK_ROSTERS = [
  ['Aklilu','Aron','Bas','Bjorn','Gerjan','Job','Ruben','Thijs'],
  ['Aklilu','Aurant','Bas','Bjorn','Danny','Gerjan','Job','Nathan','Ruben','Thijs'],
  INVESTIGATED_ROSTER,
  ['Aklilu','Amir','Bas','Bjorn','Danny','Emiel','Gerjan','Job','Nathan','Rene','Ruben','Sem','Thijs','Timo'],
  ['Aklilu','Amir','Bas','Bjorn','Danny','Emiel','Frits','Gerjan','Job','Lenn','Nathan','Ramtin','Rene','Ruben','Sem','Thijs'],
  ['Aklilu','Amir','Aurant','Bas','Bjorn','Danny','Emiel','Frits','Gerjan','Job','Lenn','Nathan','Ramtin','Rene','Ruben','Sem','Thijs','Timo']
];

function baselineSolveTeams(attendees, seed, teamCountOverride=null){
  const n = attendees.length;
  const capacities = computeTeamCapacities(n, teamCountOverride);
  const shuffled = shuffleSeeded(attendees, seed);
  const avgStamina = attendees.reduce((sum, name) => sum + getStamina(name), 0) / n;
  const avgSkill = attendees.reduce((sum, name) => sum + getSkill(name), 0) / n;
  const teamInfos = capacities.map((cap, index) => ({
    cap,
    target: cap * avgSkill,
    skillSum: 0,
    staminaSum: 0,
    team: {
      id: index + 1,
      name: `Team ${index + 1}`,
      color: `#${index + 1}`,
      members: []
    }
  }));
  const orderIndex = new Map(shuffled.map((name, index) => [name, index]));
  const playersSorted = [...attendees].sort((a, b) => getSkill(b) - getSkill(a) || (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
  for(const player of playersSorted){
    const playerSkill = getSkill(player);
    const playerStamina = getStamina(player);
    let best = -1;
    let bestScore = -Infinity;
    for(let i = 0; i < teamInfos.length; i++){
      const info = teamInfos[i];
      if(info.team.members.length >= info.cap) continue;
      const score = info.target - info.skillSum;
      if(score > bestScore + 1e-9){
        bestScore = score;
        best = i;
      } else if(Math.abs(score - bestScore) <= 1e-9 && best !== -1){
        const currentBest = teamInfos[best];
        if(playerStamina >= avgStamina){
          if(info.cap < currentBest.cap){
            best = i;
          } else if(info.cap === currentBest.cap && info.staminaSum < currentBest.staminaSum){
            best = i;
          }
        }
        const bestInfo = teamInfos[best];
        if(info.team.members.length < bestInfo.team.members.length){
          best = i;
        } else if(info.team.members.length === bestInfo.team.members.length && info.skillSum < bestInfo.skillSum){
          best = i;
        } else if(info.team.members.length === bestInfo.team.members.length && info.skillSum === bestInfo.skillSum && i < best){
          best = i;
        }
      }
    }
    const target = teamInfos[best === -1 ? 0 : best];
    target.team.members.push(player);
    target.skillSum += playerSkill;
    target.staminaSum += playerStamina;
  }
  const teams = teamInfos.map(info => ({
    id: info.team.id,
    name: info.team.name,
    color: info.team.color,
    members: [...info.team.members]
  }));
  balanceSkillToTargets(teams, attendees, getSkill);
  balanceStaminaEqualSkill(teams, getSkill, getStamina);
  return teams;
}

function sameTeamRate(attendees, solver, playerA, playerB, seeds){
  let sameTeam = 0;
  for(const seed of seeds){
    const teams = solver(attendees, seed);
    if(teams.some(team => team.members.includes(playerA) && team.members.includes(playerB))){
      sameTeam += 1;
    }
  }
  return sameTeam / seeds.length;
}

test('computeTeamCapacities preserves current team count rules', ()=>{
  assertDeepEqual(computeTeamCapacities(8), [4, 4]);
  assertDeepEqual(computeTeamCapacities(10), [5, 5]);
  assertDeepEqual(computeTeamCapacities(15), [5, 5, 5]);
  assertDeepEqual(computeTeamCapacities(17), [4, 4, 4, 5]);
  assertDeepEqual(computeTeamCapacities(20), [5, 5, 5, 5]);
  assertDeepEqual(computeTeamCapacities(11, 2), [5, 6]);
  assertDeepEqual(computeTeamCapacities(11, 3), [3, 4, 4]);
});

test('filterCandidatePool dedupes and keeps only near-optimal candidates', ()=>{
  const survivors = filterCandidatePool([
    { signature:'A', skillError:1.0, staminaError:1.0, bandClashError:4, teams:[{ members:['A'] }] },
    { signature:'A', skillError:1.0, staminaError:0.9, bandClashError:2, teams:[{ members:['A'] }] },
    { signature:'B', skillError:1.07, staminaError:0.5, bandClashError:0, teams:[{ members:['B'] }] },
    { signature:'C', skillError:1.02, staminaError:1.2, bandClashError:0, teams:[{ members:['C'] }] },
    { signature:'D', skillError:1.03, staminaError:0.94, bandClashError:4, teams:[{ members:['D'] }] },
    { signature:'E', skillError:1.05, staminaError:0.95, bandClashError:3, teams:[{ members:['E'] }] }
  ]);
  assertDeepEqual(
    survivors.map(candidate => candidate.signature).sort(),
    ['A', 'E']
  );
});

test('solveTeams preserves membership and capacity rules', ()=>{
  const attendees = INVESTIGATED_ROSTER.slice();
  const teams = solveTeams({
    attendees,
    rng: mulberry32(7),
    getSkill,
    getStamina
  });
  const capacities = computeTeamCapacities(attendees.length).slice().sort((a, b) => a - b);
  const sizes = teams.map(team => team.members.length).sort((a, b) => a - b);
  const members = teams.flatMap(team => team.members).sort((a, b) => a.localeCompare(b));
  assertDeepEqual(sizes, capacities);
  assertDeepEqual(members, attendees.slice().sort((a, b) => a.localeCompare(b)));
});

test('solveTeams preserves 11-player override capacities', ()=>{
  const attendees = [
    'Aklilu','Danny','David','Frits','Gerjan','Job',
    'Lenn','Ramtin','Rene','Ruben','Thijs'
  ];
  const teams = solveTeams({
    attendees,
    teamCountOverride: 3,
    rng: mulberry32(17),
    getSkill,
    getStamina
  });
  const sizes = teams.map(team => team.members.length).sort((a, b) => a - b);
  assertDeepEqual(sizes, [3, 4, 4]);
});

test('solveTeams produces multiple layouts for the same roster', ()=>{
  const seeds = Array.from({ length: 40 }, (_, index) => index + 1);
  const signatures = new Set();
  for(const seed of seeds){
    const teams = solveTeams({
      attendees: BENCHMARK_ROSTERS[3],
      rng: mulberry32(seed),
      getSkill,
      getStamina
    });
    signatures.add(normalizeTeamSignature(teams));
  }
  assert(signatures.size > 1, 'Expected more than one distinct layout');
});

test('solveTeams keeps average balance within strict tolerance of baseline', ()=>{
  const seeds = Array.from({ length: 12 }, (_, index) => index + 1);
  let baselineSkill = 0;
  let baselineStamina = 0;
  let nextSkill = 0;
  let nextStamina = 0;
  let total = 0;
  for(const attendees of BENCHMARK_ROSTERS){
    for(const seed of seeds){
      const baselineTeams = baselineSolveTeams(attendees, seed);
      const nextTeams = solveTeams({
        attendees,
        rng: mulberry32(seed),
        getSkill,
        getStamina
      });
      baselineSkill += computeSkillError(baselineTeams, attendees, getSkill);
      baselineStamina += computeStaminaError(baselineTeams, attendees, getStamina);
      nextSkill += computeSkillError(nextTeams, attendees, getSkill);
      nextStamina += computeStaminaError(nextTeams, attendees, getStamina);
      total += 1;
    }
  }
  const baselineSkillAvg = baselineSkill / total;
  const baselineStaminaAvg = baselineStamina / total;
  const nextSkillAvg = nextSkill / total;
  const nextStaminaAvg = nextStamina / total;
  assert(nextSkillAvg <= baselineSkillAvg + 0.05, `Skill error drifted too far: ${nextSkillAvg} vs ${baselineSkillAvg}`);
  assert(nextStaminaAvg <= baselineStaminaAvg + 0.05, `Stamina error drifted too far: ${nextStaminaAvg} vs ${baselineStaminaAvg}`);
});

test('investigated roster gets more varied and lowers Ruben/Thijs pair rate', ()=>{
  const seeds = Array.from({ length: 100 }, (_, index) => index + 1);
  const baselineRate = sameTeamRate(INVESTIGATED_ROSTER, (attendees, seed) => baselineSolveTeams(attendees, seed), 'Ruben', 'Thijs', seeds);
  const nextSignatures = new Set();
  let nextSameTeam = 0;

  for(const seed of seeds){
    const teams = solveTeams({
      attendees: INVESTIGATED_ROSTER,
      rng: mulberry32(seed),
      getSkill,
      getStamina
    });
    nextSignatures.add(normalizeTeamSignature(teams));
    if(teams.some(team => team.members.includes('Ruben') && team.members.includes('Thijs'))){
      nextSameTeam += 1;
    }
  }

  const nextRate = nextSameTeam / seeds.length;
  assert(nextSignatures.size > 2, `Expected more than 2 layouts, got ${nextSignatures.size}`);
  assert(nextRate < baselineRate, `Expected Ruben/Thijs pair rate to drop (${nextRate} vs ${baselineRate})`);
});

test('band clash score penalizes same-band stacking', ()=>{
  const bands = new Map([
    ['A', 0], ['B', 0],
    ['C', 1], ['D', 1]
  ]);
  const stacked = [
    { members:['A', 'B'] },
    { members:['C', 'D'] }
  ];
  const spread = [
    { members:['A', 'C'] },
    { members:['B', 'D'] }
  ];
  assert(computeBandClashError(stacked, bands) > computeBandClashError(spread, bands));
});
