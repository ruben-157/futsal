const seen = new Set();

export function logError(code, message, detail){
  const key = `${code}:${message}`;
  if(seen.has(key)) return;
  seen.add(key);
  if(typeof console !== 'undefined' && console.error){
    if(detail !== undefined){
      console.error(`[${code}] ${message}`, detail);
    } else {
      console.error(`[${code}] ${message}`);
    }
  }
}
