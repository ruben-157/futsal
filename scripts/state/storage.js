import { DEFAULT_PLAYERS } from '../data/config.js';
import {
  reportWarning,
  safeJSONParse,
  sanitizePlayerList,
  sanitizeAttendees,
  sanitizeTeams,
  sanitizeResultsMap,
  sanitizeRounds,
  sanitizePrevRanks,
  sanitizeTimestamp,
  sanitizeBoolean
} from '../utils/validation.js';
import { logError } from '../utils/logging.js';
import { migrateState, CURRENT_VERSION, persistVersion } from './migrations.js';

export const KEYS = {
  players: 'futsal.players',
  attendees: 'futsal.match.attendees',
  teams: 'futsal.match.teams',
  timestamp: 'futsal.match.timestamp',
  results: 'futsal.match.results',
  rounds: 'futsal.match.rounds',
  prefTrackScorers: 'futsal.pref.trackScorers',
  prevRanks: 'futsal.leaderboard.prevRanks',
  version: 'futsal.version'
};

export const state = {
  players: [],
  attendees: [],
  teams: [],
  timestamp: null,
  results: {},
  rounds: 2,
  celebrated: false,
  prevRanks: {}
};

export function loadState(){
  const versionRaw = localStorage.getItem(KEYS.version);
  const storedVersion = versionRaw ? parseInt(versionRaw, 10) : null;
  const rawPlayers = localStorage.getItem(KEYS.players);
  const parsedPlayers = safeJSONParse(rawPlayers, null, 'VAL001', 'Failed to parse players from storage');
  const players = sanitizePlayerList(parsedPlayers, DEFAULT_PLAYERS);
  state.players = players.value;
  if(players.reset){
    localStorage.setItem(KEYS.players, JSON.stringify(state.players));
    reportWarning('VAL101', players.reason || 'Players reset to defaults');
  }

  const parsedAttendees = safeJSONParse(localStorage.getItem(KEYS.attendees), [], 'VAL002', 'Failed to parse attendees');
  const attendees = sanitizeAttendees(parsedAttendees);
  state.attendees = attendees.value;
  if(attendees.reset){
    localStorage.setItem(KEYS.attendees, JSON.stringify(state.attendees));
    reportWarning('VAL102', attendees.reason || 'Cleaned attendee list');
  }

  const parsedTeams = safeJSONParse(localStorage.getItem(KEYS.teams), [], 'VAL003', 'Failed to parse teams');
  const teams = sanitizeTeams(parsedTeams);
  state.teams = teams.value;
  if(teams.reset){
    localStorage.setItem(KEYS.teams, JSON.stringify(state.teams));
    reportWarning('VAL103', teams.reason || 'Cleaned teams state');
  }

  const ts = sanitizeTimestamp(safeJSONParse(localStorage.getItem(KEYS.timestamp), null, 'VAL004', 'Failed to parse timestamp'));
  state.timestamp = ts.value;
  if(ts.reset){
    localStorage.removeItem(KEYS.timestamp);
    reportWarning('VAL104', ts.reason || 'Removed invalid timestamp');
  }

  const parsedResults = safeJSONParse(localStorage.getItem(KEYS.results), {}, 'VAL005', 'Failed to parse results');
  const results = sanitizeResultsMap(parsedResults);
  state.results = results.value;
  if(results.reset){
    localStorage.setItem(KEYS.results, JSON.stringify(state.results));
    reportWarning('VAL105', results.reason || 'Cleaned results state');
  }

  const rd = sanitizeRounds(safeJSONParse(localStorage.getItem(KEYS.rounds), null, 'VAL006', 'Failed to parse rounds'));
  state.rounds = rd.value;
  if(rd.reset){
    localStorage.setItem(KEYS.rounds, String(state.rounds));
    reportWarning('VAL106', rd.reason || 'Reset rounds to default');
  }

  const pref = sanitizeBoolean(localStorage.getItem(KEYS.prefTrackScorers));
  if(pref.reset){
    setTrackScorersPref(pref.value);
    reportWarning('VAL107', pref.reason || 'Reset track scorers pref');
  }
  const prevRanks = sanitizePrevRanks(getPrevRanks());
  state.prevRanks = prevRanks.value;
  if(prevRanks.reset){
    localStorage.setItem(KEYS.prevRanks, JSON.stringify(state.prevRanks));
    reportWarning('VAL108', prevRanks.reason || 'Cleaned prev ranks cache');
  }

  // Run migration if needed
  const { state: migrated, reset, notice } = migrateState(state, storedVersion);
  Object.assign(state, migrated);
  const persisted = persistVersion();
  if(!persisted){
    logError('ERR_STORE_VERSION', 'Failed to persist version flag');
  }
  if(reset && notice){
    localStorage.setItem(KEYS.version, String(CURRENT_VERSION));
    localStorage.setItem(KEYS.players, JSON.stringify(state.players));
    localStorage.setItem(KEYS.attendees, JSON.stringify(state.attendees));
    localStorage.setItem(KEYS.teams, JSON.stringify(state.teams));
    localStorage.setItem(KEYS.results, JSON.stringify(state.results));
    localStorage.setItem(KEYS.rounds, String(state.rounds));
    if(state.timestamp) localStorage.setItem(KEYS.timestamp, String(state.timestamp));
    localStorage.setItem(KEYS.prevRanks, JSON.stringify(state.prevRanks));
    reportWarning('MIGRATION', notice);
  }
}

function safeSetItem(key, value, code, context){
  try{
    localStorage.setItem(key, value);
    return true;
  }catch(err){
    logError(code, context || `Failed to save ${key}`, err);
    return false;
  }
}

export const saveAttendees = () => safeSetItem(KEYS.attendees, JSON.stringify(state.attendees), 'ERR_STORE_ATTENDEES', 'Failed to save attendees');
export const savePlayers = () => safeSetItem(KEYS.players, JSON.stringify(state.players), 'ERR_STORE_PLAYERS', 'Failed to save players');
export const saveTeams = () => safeSetItem(KEYS.teams, JSON.stringify(state.teams), 'ERR_STORE_TEAMS', 'Failed to save teams');
export const saveTimestamp = () => { if(state.timestamp) safeSetItem(KEYS.timestamp, String(state.timestamp), 'ERR_STORE_TS', 'Failed to save timestamp'); };
export const saveResults = () => safeSetItem(KEYS.results, JSON.stringify(state.results), 'ERR_STORE_RESULTS', 'Failed to save results');
export const saveRounds = () => safeSetItem(KEYS.rounds, String(state.rounds), 'ERR_STORE_ROUNDS', 'Failed to save rounds');

export function getTrackScorersPref(){
  const pref = sanitizeBoolean(localStorage.getItem(KEYS.prefTrackScorers));
  if(pref.reset) setTrackScorersPref(pref.value);
  return pref.value;
}

export const setTrackScorersPref = (on) => localStorage.setItem(KEYS.prefTrackScorers, on ? 'true' : 'false');

export function getPrevRanks(){
  return safeJSONParse(localStorage.getItem(KEYS.prevRanks), {}, 'VAL109', 'Failed to parse prev ranks');
}

export function savePrevRanksFromRows(rows){
  const obj = {};
  rows.forEach((r, idx)=>{ obj[r.team.id] = idx; });
  localStorage.setItem(KEYS.prevRanks, JSON.stringify(obj));
}
