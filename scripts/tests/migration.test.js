import { migrateState, CURRENT_VERSION } from '../state/migrations.js';

test('migrateState cleans legacy/no-version data', ()=>{
  const raw = {
    players: ['A','',null],
    attendees: ['X', 5],
    teams: [{ members:['A', null] }],
    results: { bad:'x' },
    rounds: 'NaN',
    timestamp: 'not-a-number',
    prevRanks: { a:'x' }
  };
  const { state, reset, notice } = migrateState(raw, null);
  assert(reset, 'Should flag reset');
  assert(notice, 'Should have notice');
  assertDeepEqual(state.players, ['A']);
  assertDeepEqual(state.attendees, ['X']);
  assertEqual(state.rounds, 2);
  assertEqual(state.timestamp, null);
});

test('migrateState returns unchanged when version matches', ()=>{
  const raw = { players:['A'], attendees:[], teams:[], results:{}, rounds:2, timestamp:null, prevRanks:{} };
  const res = migrateState(raw, CURRENT_VERSION);
  assert(!res.reset);
  assertEqual(res.state.players[0], 'A');
});
