export function buildAllTimeCSVWarningNotice(warnings=[], skipped=0){
  const skipCount = skipped || 0;
  const hasGoalWarnings = (warnings || []).some(w => typeof w.reason === 'string' && w.reason.toLowerCase().includes('goals'));
  if(!skipCount && !hasGoalWarnings) return null;
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.style.color = 'var(--danger)';
  notice.setAttribute('role','status');
  notice.setAttribute('aria-live','polite');
  const parts = [];
  if(skipCount){
    parts.push(`Skipped ${skipCount} row${skipCount === 1 ? '' : 's'} with missing date/player/points`);
  }
  if(hasGoalWarnings){
    parts.push('Rows with non-numeric goals were defaulted to 0');
  }
  notice.textContent = parts.join('. ') + '. See console [AT201] for details.';
  return notice;
}
