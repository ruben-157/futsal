import { logError } from '../utils/logging.js';

test('logError dedupes same code/message', ()=>{
  const calls = [];
  const orig = console.error;
  console.error = (...args)=> calls.push(args);
  try{
    logError('E1','msg');
    logError('E1','msg');
    assertEqual(calls.length, 1);
    assert(String(calls[0][0]).includes('[E1]'));
  } finally {
    console.error = orig;
  }
});

test('logError forwards detail object', ()=>{
  const calls = [];
  const orig = console.error;
  console.error = (...args)=> calls.push(args);
  const detail = { foo:'bar' };
  try{
    logError('E2','boom', detail);
    assertEqual(calls.length, 1);
    assert(calls[0].some(arg => arg === detail), 'detail passed through');
  } finally {
    console.error = orig;
  }
});
