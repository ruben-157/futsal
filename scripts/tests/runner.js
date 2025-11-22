// Tiny dev-only test runner (no deps). Usage:
// node scripts/tests/runner.js

const results = [];

function test(name, fn){
  results.push(runTest(name, fn));
}

function runTest(name, fn){
  const start = Date.now();
  try{
    const out = fn();
    if(out && typeof out.then === 'function'){
      throw new Error('Async tests not supported in this tiny runner');
    }
    return { name, status: 'passed', ms: Date.now() - start };
  }catch(err){
    return { name, status: 'failed', ms: Date.now() - start, error: err };
  }
}

function assert(condition, message='Assertion failed'){
  if(!condition) throw new Error(message);
}

function assertEqual(a, b, message='Expected values to be equal'){
  if(a !== b){
    throw new Error(`${message}. Got ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  }
}

function assertDeepEqual(a, b, message='Expected values to be deeply equal'){
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if(ja !== jb){
    throw new Error(`${message}. Got ${ja} !== ${jb}`);
  }
}

// Export globals to test files
global.test = test;
global.assert = assert;
global.assertEqual = assertEqual;
global.assertDeepEqual = assertDeepEqual;

// Load test files
Promise.resolve()
  .then(()=>import('./validation.test.js'))
  .then(()=>import('./accessibility.test.js'))
  .then(()=>import('./team-balance.test.js'))
  .then(report)
  .catch((err)=>{
    console.error('Failed to load tests', err);
    process.exit(1);
  });

function report(){
  const failed = results.filter(r => r.status === 'failed');
  const passed = results.filter(r => r.status === 'passed');
  for(const r of results){
    if(r.status === 'passed'){
      console.log(`✅ ${r.name} (${r.ms}ms)`);
    }else{
      console.error(`❌ ${r.name} (${r.ms}ms)`);
      console.error(r.error && r.error.stack ? r.error.stack : r.error);
    }
  }
  console.log(`\n${passed.length} passed, ${failed.length} failed, ${results.length} total`);
  process.exit(failed.length ? 1 : 0);
}
