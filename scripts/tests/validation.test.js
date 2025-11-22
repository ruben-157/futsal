import {
  sanitizePlayerList,
  sanitizeAttendees,
  sanitizeTeams,
  sanitizeResultsMap,
  sanitizeRounds,
  sanitizePrevRanks,
  sanitizeTimestamp,
  sanitizeBoolean,
  safeJSONParse,
  reportWarning
} from '../utils/validation.js';

test('sanitizePlayerList falls back to defaults when empty/invalid', ()=>{
  const res = sanitizePlayerList({}, ['A','B']);
  assertDeepEqual(res.value, ['A','B']);
  assert(res.reset, 'Should mark reset');
});

test('sanitizeAttendees trims and drops falsy', ()=>{
  const res = sanitizeAttendees([' a ', '', null, 'b']);
  assertDeepEqual(res.value, ['a','b']);
});

test('sanitizeTeams cleans members and ids', ()=>{
  const res = sanitizeTeams([{ name:'Red', members:[' a ', 5] }, 'bad']);
  assert(res.reset, 'Should mark reset due to invalid entries');
  assertEqual(res.value.length, 1);
  assertDeepEqual(res.value[0].members, ['a']);
  assert(res.value[0].id, 'auto id assigned');
});

test('sanitizeResultsMap drops bad entries and normalizes numbers', ()=>{
  const res = sanitizeResultsMap({
    good: { round: '2', ga: '3', gb: 'x', gpa:{A:'1'}, gpbDraft:{B:'y'} },
    bad: 'noop'
  });
  assert(res.reset, 'Should clean results');
  assert(res.value.good.ga === 3, 'ga normalized');
  assert(res.value.good.gb === 0, 'gb fallback to 0');
  assertDeepEqual(res.value.good.gpa, { A:1 });
  assert(!res.value.good.gpbDraft, 'invalid draft removed');
  assert(!('bad' in res.value), 'bad entry removed');
});

test('sanitizeRounds clamps to positive int', ()=>{
  const res = sanitizeRounds('NaN', 2);
  assertEqual(res.value, 2);
  assert(res.reset);
});

test('sanitizePrevRanks filters invalid values', ()=>{
  const res = sanitizePrevRanks({ ok:1, bad:'x' });
  assert(res.reset);
  assertDeepEqual(res.value, { ok:1 });
});

test('sanitizeTimestamp nulls invalid values', ()=>{
  const res = sanitizeTimestamp('nope');
  assert(res.reset);
  assertEqual(res.value, null);
});

test('sanitizeBoolean handles strings and invalids', ()=>{
  assertEqual(sanitizeBoolean('true').value, true);
  assertEqual(sanitizeBoolean('false').value, false);
  const res = sanitizeBoolean('weird', true);
  assert(res.reset);
  assertEqual(res.value, true);
});

test('safeJSONParse returns fallback on error', ()=>{
  const val = safeJSONParse('{"a":1}', {}, 'X', 'ctx');
  assertEqual(val.a, 1);
  const fb = safeJSONParse('{bad', { fallback:true }, 'X', 'ctx');
  assertEqual(fb.fallback, true);
});

test('reportWarning dedupes repeated messages', ()=>{
  const calls = [];
  const origWarn = console.warn;
  console.warn = (...args) => { calls.push(args); };
  try{
    reportWarning('CODE', 'same');
    reportWarning('CODE', 'same');
    assertEqual(calls.length, 1);
    assert(String(calls[0][0]).includes('[CODE]'));
  }finally{
    console.warn = origWarn;
  }
});
