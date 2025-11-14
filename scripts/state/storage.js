import { DEFAULT_PLAYERS } from '../data/config.js';

export const KEYS = {
  players: 'futsal.players',
  attendees: 'futsal.match.attendees',
  teams: 'futsal.match.teams',
  timestamp: 'futsal.match.timestamp',
  results: 'futsal.match.results',
  rounds: 'futsal.match.rounds',
  prefTrackScorers: 'futsal.pref.trackScorers',
  prevRanks: 'futsal.leaderboard.prevRanks'
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
  const p = localStorage.getItem(KEYS.players);
  if(!p){
    localStorage.setItem(KEYS.players, JSON.stringify(DEFAULT_PLAYERS));
    state.players = [...DEFAULT_PLAYERS];
  } else {
    try{ state.players = JSON.parse(p) || []; }catch{ state.players = [...DEFAULT_PLAYERS]; }
    if(!Array.isArray(state.players) || state.players.length === 0){
      state.players = [...DEFAULT_PLAYERS];
      localStorage.setItem(KEYS.players, JSON.stringify(state.players));
    }
  }

  try{ state.attendees = JSON.parse(localStorage.getItem(KEYS.attendees) || '[]'); }catch{ state.attendees = []; }
  try{ state.teams = JSON.parse(localStorage.getItem(KEYS.teams) || '[]'); }catch{ state.teams = []; }
  const ts = localStorage.getItem(KEYS.timestamp);
  state.timestamp = ts ? Number(ts) : null;
  try{ state.results = JSON.parse(localStorage.getItem(KEYS.results) || '{}'); }catch{ state.results = {}; }
  const rd = localStorage.getItem(KEYS.rounds);
  state.rounds = rd ? Math.max(1, parseInt(rd, 10) || 2) : 2;
  state.prevRanks = getPrevRanks();
}

export const saveAttendees = () => localStorage.setItem(KEYS.attendees, JSON.stringify(state.attendees));
export const savePlayers = () => localStorage.setItem(KEYS.players, JSON.stringify(state.players));
export const saveTeams = () => localStorage.setItem(KEYS.teams, JSON.stringify(state.teams));
export const saveTimestamp = () => { if(state.timestamp) localStorage.setItem(KEYS.timestamp, String(state.timestamp)); };
export const saveResults = () => localStorage.setItem(KEYS.results, JSON.stringify(state.results));
export const saveRounds = () => localStorage.setItem(KEYS.rounds, String(state.rounds));

export function getTrackScorersPref(){
  const v = localStorage.getItem(KEYS.prefTrackScorers);
  return v === null ? false : v === 'true';
}

export const setTrackScorersPref = (on) => localStorage.setItem(KEYS.prefTrackScorers, on ? 'true' : 'false');

export function getPrevRanks(){
  try{ return JSON.parse(localStorage.getItem(KEYS.prevRanks) || '{}'); }catch{ return {}; }
}

export function savePrevRanksFromRows(rows){
  const obj = {};
  rows.forEach((r, idx)=>{ obj[r.team.id] = idx; });
  localStorage.setItem(KEYS.prevRanks, JSON.stringify(obj));
}
