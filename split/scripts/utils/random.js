export function mulberry32(a){
  return function(){
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STABLE_WINDOW_MS = 60 * 60 * 1000;

export function fnv1a32(str){
  let h = 0x811c9dc5>>>0;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h>>>0;
}

export function computeStableSeedFromAttendees(attendees){
  const bucket = Math.floor(Date.now()/STABLE_WINDOW_MS);
  const key = attendees.slice().sort((a,b)=>a.localeCompare(b)).join('|') + '|' + bucket;
  return fnv1a32(key);
}

export function shuffleSeeded(arr, seed){
  const rng = mulberry32(seed >>> 0);
  const a = [...arr];
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(rng() * (i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
