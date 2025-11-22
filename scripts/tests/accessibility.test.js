import { buildAllTimeCSVWarningNotice } from '../utils/accessibility.js';

function domStub(){
  // Very small DOM stubs for createElement/textContent usage
  const createElement = (tag) => {
    const el = {
      tag,
      children: [],
      className: '',
      style: {},
      attributes: {},
      setAttribute(name, value){ this.attributes[name] = String(value); },
      appendChild(child){ this.children.push(child); return child; },
      set textContent(val){ this._text = val; },
      get textContent(){ return this._text; }
    };
    return el;
  };
  global.document = { createElement };
}

test('buildAllTimeCSVWarningNotice returns null when no skips', ()=>{
  domStub();
  const n = buildAllTimeCSVWarningNotice([], 0);
  assertEqual(n, null);
});

test('buildAllTimeCSVWarningNotice emits notice and status when skips present', ()=>{
  domStub();
  const n = buildAllTimeCSVWarningNotice([{ line:2, reason:'Missing date/player/points' }], 1);
  assert(n, 'notice should exist');
  assertEqual(n.className, 'notice');
  assertEqual(n.attributes.role, 'status');
  assertEqual(n.attributes['aria-live'], 'polite');
  assert(n.textContent.includes('Skipped 1 row'), 'Should mention skipped count');
});
