import { sanitizePlayerList, sanitizeAttendees, sanitizeTeams, sanitizeResultsMap, sanitizeRounds, sanitizePrevRanks, sanitizeTimestamp } from '../utils/validation.js';
import { DEFAULT_PLAYERS } from '../data/config.js';
import { KEYS } from './storage.js';

export const CURRENT_VERSION = 1;

export function migrateState(raw, version){
  // version may be null/undefined for legacy
  if(version === CURRENT_VERSION) return { state: raw, reset: false, notice: null };
  // Legacy/no version: sanitize to current shape
  const migrated = { ...raw };
  const players = sanitizePlayerList(raw.players, DEFAULT_PLAYERS);
  migrated.players = players.value;
  const attendees = sanitizeAttendees(raw.attendees);
  migrated.attendees = attendees.value;
  const teams = sanitizeTeams(raw.teams);
  migrated.teams = teams.value;
  const results = sanitizeResultsMap(raw.results);
  migrated.results = results.value;
  const rounds = sanitizeRounds(raw.rounds, 2);
  migrated.rounds = rounds.value;
  const ts = sanitizeTimestamp(raw.timestamp);
  migrated.timestamp = ts.value;
  const prevRanks = sanitizePrevRanks(raw.prevRanks);
  migrated.prevRanks = prevRanks.value;
  const reset = players.reset || attendees.reset || teams.reset || results.reset || rounds.reset || ts.reset || prevRanks.reset;
  const notice = reset ? 'Saved data was cleaned for compatibility.' : null;
  return { state: migrated, reset, notice };
}

export function persistVersion(){
  try{
    localStorage.setItem(KEYS.version, String(CURRENT_VERSION));
    return true;
  }catch(_){ return false; }
}
