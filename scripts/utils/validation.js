const warned = new Set();

export function reportWarning(code, message, detail){
  const key = `${code}:${message}`;
  if(warned.has(key)) return;
  warned.add(key);
  if(typeof console !== 'undefined' && console.warn){
    if(detail !== undefined){
      console.warn(`[${code}] ${message}`, detail);
    } else {
      console.warn(`[${code}] ${message}`);
    }
  }
}

export function safeJSONParse(raw, fallback, code, context){
  if(raw === null || raw === undefined || raw === '') return fallback;
  try{
    return JSON.parse(raw);
  }catch(err){
    if(code) reportWarning(code, context || 'JSON parse failed', err);
    return fallback;
  }
}

export function sanitizePlayerList(value, fallback=[]){
  if(!Array.isArray(value)){
    return { value: [...fallback], reset: true, reason: 'Expected array of players' };
  }
  const cleaned = value
    .map(v => typeof v === 'string' ? v.trim() : '')
    .filter(Boolean);
  if(cleaned.length === 0){
    return { value: [...fallback], reset: true, reason: 'Player list empty after cleaning' };
  }
  return { value: cleaned, reset: cleaned.length !== value.length, reason: null };
}

export function sanitizeAttendees(value){
  if(!Array.isArray(value)){
    return { value: [], reset: true, reason: 'Expected array of attendees' };
  }
  const cleaned = value
    .map(v => typeof v === 'string' ? v.trim() : '')
    .filter(Boolean);
  return { value: cleaned, reset: cleaned.length !== value.length, reason: cleaned.length !== value.length ? 'Removed invalid attendee entries' : null };
}

export function sanitizeTeams(value){
  if(!Array.isArray(value)){
    return { value: [], reset: !!value, reason: 'Teams was not an array' };
  }
  const cleaned = [];
  let changed = false;
  value.forEach((team, idx) => {
    if(!team || typeof team !== 'object') { changed = true; return; }
    const members = Array.isArray(team.members)
      ? team.members.map(m => typeof m === 'string' ? m.trim() : '').filter(Boolean)
      : [];
    const sanitized = { ...team, members };
    if(!sanitized.id) { sanitized.id = `team-${idx}`; changed = true; }
    if(!sanitized.name || typeof sanitized.name !== 'string'){
      sanitized.name = sanitized.color || `Team ${idx+1}`;
      changed = true;
    }
    cleaned.push(sanitized);
    if(members.length !== (team.members || []).length){ changed = true; }
  });
  return { value: cleaned, reset: changed, reason: changed ? 'Teams contained invalid entries' : null };
}

export function sanitizeResultsMap(value){
  if(!value || typeof value !== 'object'){
    return { value: {}, reset: !!value, reason: 'Results was not an object' };
  }
  const cleaned = {};
  let changed = false;
  for(const [key, entry] of Object.entries(value)){
    if(!entry || typeof entry !== 'object'){ changed = true; continue; }
    const safe = { ...entry };
    safe.round = normalizePositiveInt(entry.round, 1);
    if(entry.round !== safe.round) changed = true;

    if('ga' in entry){
      const n = normalizeNumber(entry.ga, 0);
      if(n !== entry.ga) changed = true;
      safe.ga = n;
    }
    if('gb' in entry){
      const n = normalizeNumber(entry.gb, 0);
      if(n !== entry.gb) changed = true;
      safe.gb = n;
    }
    const gpa = sanitizeScoreMap(entry.gpa);
    const gpb = sanitizeScoreMap(entry.gpb);
    const gpaDraft = sanitizeScoreMap(entry.gpaDraft);
    const gpbDraft = sanitizeScoreMap(entry.gpbDraft);
    if(entry.gpa !== gpa || entry.gpb !== gpb || entry.gpaDraft !== gpaDraft || entry.gpbDraft !== gpbDraft) changed = true;
    if(gpa) safe.gpa = gpa; else delete safe.gpa;
    if(gpb) safe.gpb = gpb; else delete safe.gpb;
    if(gpaDraft) safe.gpaDraft = gpaDraft; else if('gpaDraft' in safe) delete safe.gpaDraft;
    if(gpbDraft) safe.gpbDraft = gpbDraft; else if('gpbDraft' in safe) delete safe.gpbDraft;

    const gaDraft = normalizeOptionalNumber(entry.gaDraft);
    const gbDraft = normalizeOptionalNumber(entry.gbDraft);
    if(gaDraft !== entry.gaDraft || gbDraft !== entry.gbDraft) changed = true;
    if(gaDraft !== null) safe.gaDraft = gaDraft; else if('gaDraft' in safe) delete safe.gaDraft;
    if(gbDraft !== null) safe.gbDraft = gbDraft; else if('gbDraft' in safe) delete safe.gbDraft;

    cleaned[key] = safe;
  }
  return { value: cleaned, reset: changed, reason: changed ? 'Cleaned invalid result entries' : null };
}

export function sanitizeRounds(value, fallback=2){
  const n = normalizePositiveInt(value, fallback);
  const reset = !Number.isFinite(value) || n !== value;
  return { value: n, reset, reason: reset ? 'Rounds was not a valid positive number' : null };
}

export function sanitizePrevRanks(value){
  if(!value || typeof value !== 'object'){
    return { value: {}, reset: !!value, reason: 'Prev ranks was not an object' };
  }
  const cleaned = {};
  let changed = false;
  for(const [k, v] of Object.entries(value)){
    const n = normalizeNumber(v, null);
    if(n === null){ changed = true; continue; }
    cleaned[k] = n;
    if(n !== v) changed = true;
  }
  return { value: cleaned, reset: changed, reason: changed ? 'Prev ranks contained invalid entries' : null };
}

export function sanitizeTimestamp(value){
  const n = normalizeNumber(value, null);
  const reset = value !== null && n === null;
  return { value: n, reset, reason: reset ? 'Timestamp was invalid' : null };
}

export function sanitizeBoolean(value, fallback=false){
  if(value === null || value === undefined) return { value: fallback, reset: false, reason: null };
  if(typeof value === 'boolean') return { value, reset: false, reason: null };
  if(value === 'true' || value === 'false') return { value: value === 'true', reset: true, reason: 'Boolean stored as string' };
  return { value: fallback, reset: true, reason: 'Invalid boolean' };
}

function sanitizeScoreMap(obj){
  if(!obj || typeof obj !== 'object') return null;
  const out = {};
  for(const [k,v] of Object.entries(obj)){
    const key = typeof k === 'string' ? k.trim() : '';
    if(!key) continue;
    const n = normalizeNumber(v, null);
    if(n === null) continue;
    out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

function normalizePositiveInt(value, fallback=1){
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  if(Number.isFinite(n) && n > 0) return n;
  return fallback;
}

function normalizeNumber(value, fallback=0){
  const n = typeof value === 'number' ? value : parseFloat(value);
  if(Number.isFinite(n)) return n;
  return fallback;
}

function normalizeOptionalNumber(value){
  if(value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
