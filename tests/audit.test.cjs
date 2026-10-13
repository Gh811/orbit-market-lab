const assert = require('node:assert/strict');
const { analyzeCandle } = require('../assets/insight.js');
const { verify, reliability } = require('../assets/audit.js');

const bars = Array.from({ length: 130 }, (_, i) => ({
  t: 1_700_000_000_000 + i * 60_000,
  o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i,
  v: i % 5 === 4 ? 250 : 100
}));
const index = 119;
const original = analyzeCandle(bars.slice(0, index + 1), index, { historical: true });
const outcome = verify(bars, index);
assert.deepEqual(outcome.original, original);
assert.equal(outcome.direction, 'up');
assert.equal(outcome.outcome, 'up');
assert.equal(outcome.verdict, 'confirmed');

const pending = verify(bars, index, index + 5);
assert.equal(pending.ready, false);
assert.equal(pending.remaining, 1);

const reversed = bars.map(bar => ({ ...bar }));
for (let i = index + 1; i <= index + 5; i++) reversed[i].c = bars[index].c - (i - index) * 2;
assert.equal(verify(reversed, index).verdict, 'missed');
assert.deepEqual(verify(reversed, index).original, original);
const frozen = { ...original, title: '当时保留的原始判断' };
assert.equal(verify(reversed, index, reversed.length, frozen).original.title, frozen.title);

const score = reliability(bars, index, outcome);
assert.ok(score.count >= 10);
assert.ok(score.hits <= score.count);
const longer = Array.from({ length: 300 }, (_, i) => ({
  t: 1_700_000_000_000 + i * 60_000,
  o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i,
  v: i % 5 === 4 ? 250 : 100
}));
const learned = reliability(longer, 294, verify(longer, 294));
assert.equal(learned.qualified, true);
const extra = [...bars, { ...bars.at(-1), t: bars.at(-1).t + 60_000, c: 1 }];
assert.deepEqual(reliability(extra, index, verify(extra, index)), score);

const neutral = Array.from({ length: 50 }, (_, i) => ({
  t: i * 60_000, o: 100, h: 101, l: 99, c: 100, v: 100
}));
assert.equal(verify(neutral, 30).verdict, 'no_call');
console.log('Candle follow-up audit: preserved original, five-bar outcome, causal reliability: OK');
