function betterSwapCandidate(i, j, a, b, bestI, bestJ, bestA, bestB){
  if(bestI === -1) return true;
  if(i < bestI) return true;
  if(i > bestI) return false;
  if(j < bestJ) return true;
  if(j > bestJ) return false;
  if(a < bestA) return true;
  if(a > bestA) return false;
  return b < bestB;
}

export function balanceSkillToTargets(teams, attendees, getSkill){
  if(!teams || teams.length < 2) return;
  const roster = attendees || [];
  if(roster.length === 0) return;
  const totalSkill = roster.reduce((s,n)=> s + getSkill(n), 0);
  const avg = totalSkill / roster.length;
  const eps = 1e-9;
  const maxPasses = 8;
  for(let pass=0; pass<maxPasses; pass++){
    const sizes = teams.map(t => (t.members||[]).length);
    const sums = teams.map(t => (t.members||[]).reduce((s,n)=> s + getSkill(n), 0));
    const targets = sizes.map(sz => sz * avg);
    let bestDelta = 0;
    let bestI = -1, bestJ = -1, bestA = null, bestB = null;
    for(let i=0;i<teams.length;i++){
      for(let j=i+1;j<teams.length;j++){
        const ti = teams[i], tj = teams[j];
        const mi = [...(ti.members||[])].sort((a,b)=> a.localeCompare(b));
        const mj = [...(tj.members||[])].sort((a,b)=> a.localeCompare(b));
        const beforeErr = Math.abs(sums[i]-targets[i]) + Math.abs(sums[j]-targets[j]);
        for(const a of mi){
          const sa = getSkill(a);
          for(const b of mj){
            const sb = getSkill(b);
            const afterI = sums[i] - sa + sb;
            const afterJ = sums[j] - sb + sa;
            const afterErr = Math.abs(afterI - targets[i]) + Math.abs(afterJ - targets[j]);
            const delta = beforeErr - afterErr;
            const improves = delta > bestDelta + eps;
            const ties = !improves && Math.abs(delta - bestDelta) <= eps && delta > eps;
            if(improves || (ties && betterSwapCandidate(i, j, a, b, bestI, bestJ, bestA, bestB))){
              bestDelta = delta;
              bestI = i; bestJ = j; bestA = a; bestB = b;
            }
          }
        }
      }
    }
    if(bestDelta > eps && bestI !== -1){
      const ti = teams[bestI], tj = teams[bestJ];
      ti.members[ti.members.indexOf(bestA)] = bestB;
      tj.members[tj.members.indexOf(bestB)] = bestA;
    } else {
      break;
    }
  }
}

export function balanceStaminaEqualSkill(teams, getSkill, getStamina){
  if(!teams || teams.length < 2) return;
  const eps = 1e-9;
  const maxPasses = 8;
  for(let pass=0; pass<maxPasses; pass++){
    const sizes = teams.map(t => (t.members || []).length);
    const sums = teams.map(t => (t.members || []).reduce((s,n)=> s + getStamina(n), 0));
    const avgs = sums.map((s,i)=> sizes[i] ? (s / sizes[i]) : 0);
    let bestGain = 0;
    let bestI = -1, bestJ = -1, bestA = null, bestB = null;
    for(let i=0;i<teams.length;i++){
      for(let j=i+1;j<teams.length;j++){
        const ti = teams[i], tj = teams[j];
        const si = sizes[i], sj = sizes[j];
        const mi = [...(ti.members||[])].sort((a,b)=> a.localeCompare(b));
        const mj = [...(tj.members||[])].sort((a,b)=> a.localeCompare(b));
        const beforeDiff = Math.abs(avgs[i] - avgs[j]);
        for(const a of mi){
          for(const b of mj){
            if(getSkill(a) !== getSkill(b)) continue;
            const sa = getStamina(a), sb = getStamina(b);
            let gain = 0;
            if(si < sj){
              if(sb <= sa) continue;
              const beforeSmall = avgs[i];
              const afterSmall = (sums[i] + (sb - sa)) / si;
              gain = afterSmall - beforeSmall;
            } else if (si > sj){
              if(sa <= sb) continue;
              const beforeSmall = avgs[j];
              const afterSmall = (sums[j] + (sa - sb)) / sj;
              gain = afterSmall - beforeSmall;
            } else {
              const after_i = (sums[i] + (sb - sa)) / si;
              const after_j = (sums[j] + (sa - sb)) / sj;
              const afterDiff = Math.abs(after_i - after_j);
              gain = beforeDiff - afterDiff;
            }
            const improves = gain > bestGain + eps;
            const ties = !improves && Math.abs(gain - bestGain) <= eps && gain > eps;
            if(improves || (ties && betterSwapCandidate(i, j, a, b, bestI, bestJ, bestA, bestB))){
              bestGain = gain;
              bestI = i; bestJ = j; bestA = a; bestB = b;
            }
          }
        }
      }
    }
    if(bestGain > eps && bestI !== -1){
      const ti = teams[bestI], tj = teams[bestJ];
      ti.members[ti.members.indexOf(bestA)] = bestB;
      tj.members[tj.members.indexOf(bestB)] = bestA;
    } else {
      break;
    }
  }
}
