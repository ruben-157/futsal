import { balanceSkillToTargets, balanceStaminaEqualSkill } from '../logic/balance.js';

function makeGetSkill(map){
  return (name) => map[name] ?? 3;
}
function makeGetStamina(map){
  return (name) => map[name] ?? 3;
}

test('balanceSkillToTargets reduces skill deviation while keeping members', ()=>{
  const teams = [
    { members:['A','B'] },
    { members:['C','D'] },
  ];
  const skills = { A:5, B:5, C:1, D:1 };
  const attendees = Object.keys(skills);
  const getSkill = makeGetSkill(skills);
  const beforeSums = teams.map(t => t.members.reduce((s,n)=> s+getSkill(n),0));
  const avg = attendees.reduce((s,n)=> s+getSkill(n),0) / attendees.length;
  const targets = teams.map(t => t.members.length * avg);
  const beforeError = Math.abs(beforeSums[0]-targets[0]) + Math.abs(beforeSums[1]-targets[1]);

  balanceSkillToTargets(teams, attendees, getSkill);

  const afterSums = teams.map(t => t.members.reduce((s,n)=> s+getSkill(n),0));
  const afterError = Math.abs(afterSums[0]-targets[0]) + Math.abs(afterSums[1]-targets[1]);
  assert(afterError < beforeError, 'Skill deviation should decrease');
  // Membership preserved (no losses)
  const allMembers = teams.flatMap(t => t.members).sort();
  assertDeepEqual(allMembers, attendees.sort());
});

test('balanceStaminaEqualSkill smooths stamina when skills are equal', ()=>{
  const teams = [
    { members:['A','B'] }, // high stamina
    { members:['C','D'] }  // low stamina
  ];
  const skills = { A:3, B:3, C:3, D:3 };
  const stamina = { A:5, B:5, C:1, D:1 };
  const getSkill = makeGetSkill(skills);
  const getStamina = makeGetStamina(stamina);
  const beforeAvgs = teams.map(t => t.members.reduce((s,n)=> s+getStamina(n),0) / t.members.length);
  const beforeDiff = Math.abs(beforeAvgs[0] - beforeAvgs[1]);

  balanceStaminaEqualSkill(teams, getSkill, getStamina);

  const afterAvgs = teams.map(t => t.members.reduce((s,n)=> s+getStamina(n),0) / t.members.length);
  const afterDiff = Math.abs(afterAvgs[0] - afterAvgs[1]);
  assert(afterDiff < beforeDiff, 'Stamina averages should converge');
  // Skill totals unchanged per team
  const skillSums = teams.map(t => t.members.reduce((s,n)=> s+getSkill(n),0));
  assertEqual(skillSums[0], 6);
  assertEqual(skillSums[1], 6);
});
