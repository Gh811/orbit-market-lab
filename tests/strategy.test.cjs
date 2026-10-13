const assert = require('node:assert/strict');
const { analyzeStrategy, nearbyLevels, tradeCall } = require('../assets/strategy.js');

function bars(count, movement = 0) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * movement;
    return { t: 1_700_000_000_000 + index * 60_000,
      o: close - .1, h: close + 1, l: close - 1, c: close, v: 100 };
  });
}

assert.equal(analyzeStrategy([], 100).ready, false);
const flat = analyzeStrategy(bars(240), 100);
assert.equal(flat.ready, true);
assert.equal(flat.state, 'flat');
assert.ok(flat.samples >= 18);
assert.equal(flat.counts.up + flat.counts.flat + flat.counts.down, flat.samples);
assert.equal(flat.probabilities.flat, 1);
assert.equal(flat.levels.supportZone, undefined);
assert.equal(flat.levels.resistanceZone, undefined);
assert.equal(flat.levels.long, null);
assert.equal(flat.movingAverages.order, 'mixed');
const oscillating = Array.from({ length: 120 }, (_, index) => {
  const close = 100 + 3 * Math.sin(index * Math.PI / 6);
  return { t: 1_700_000_000_000 + index * 60_000,
    o: close, h: close + .4, l: close - .4, c: close, v: 100 };
});
const levels = nearbyLevels(oscillating, 100);
assert.ok(levels.supportZone.touches > 1);
assert.ok(levels.resistanceZone.touches > 1);
assert.ok(levels.supportZone.lastTouchBars < 20);
assert.ok(levels.resistanceZone.lastTouchBars < 20);
assert.ok(levels.plans.long.stop < levels.supportZone.low);
assert.ok(levels.plans.long.target < levels.resistanceZone.low);
assert.ok(levels.plans.short.target > levels.supportZone.high);
assert.ok(levels.plans.short.stop > levels.resistanceZone.high);
assert.equal(levels.long, levels.plans.long.reward / levels.plans.long.risk);
assert.equal(levels.short, levels.plans.short.reward / levels.plans.short.risk);
assert.equal(nearbyLevels(bars(120, .4), 147.6).plans, null);
const singleSwing = bars(65);
singleSwing[30].l = 96;
singleSwing[45].h = 104;
assert.equal(nearbyLevels(singleSwing, 100).supportZone.center, 96);
assert.equal(nearbyLevels(singleSwing, 100).resistanceZone.center, 104);
const unconfirmedTail = bars(42);
unconfirmedTail.at(-1).h = 120;
unconfirmedTail.at(-1).l = 80;
assert.equal(nearbyLevels(unconfirmedTail, 100).plans, null);
const freshSpike = oscillating.map(bar => ({ ...bar }));
freshSpike.at(-1).h = 130;
assert.ok(nearbyLevels(freshSpike, 100).resistanceZone.high < 110);

const rising = analyzeStrategy(bars(240, .5), 219.5);
assert.equal(rising.ready, true);
assert.equal(rising.state, 'up');
assert.equal(rising.movingAverages.order, 'bullish');
assert.ok(rising.probabilities.up > rising.probabilities.down);
assert.ok(Math.abs(Object.values(rising.probabilities).reduce((a, b) => a + b, 0) - 1) < 1e-12);

// A short sequence can describe the visible structure without inventing frequencies.
const short = analyzeStrategy(bars(45, .2), 108.8);
assert.equal(short.ready, true);
assert.equal(short.probabilities, null);
assert.equal(short.leading, null);
const falling = analyzeStrategy(bars(240, -.2), 52.2);
assert.equal(falling.movingAverages.order, 'bearish');
const eligible = { ready: true, leading: 'up', price: 100, atr: 2,
  probabilities: { up: .76, flat: .14, down: .10 },
  counts: { up: 38, flat: 7, down: 5 }, samples: 50,
  directionalRate: 38 / 43, directionalSamples: 43,
  state: 'up', movingAverages: { order: 'bullish' },
  levels: { support: 98, resistance: 104, long: 2, short: .5,
    plans: { long: { target: 103.8, stop: 97.9, reward: 3.8, risk: 2.1 },
      short: { target: 98.1, stop: 104.1, reward: 1.9, risk: 4.1 } } } };
assert.equal(tradeCall(eligible).direction, 'up');
assert.equal(tradeCall({ ...eligible, state: 'flat' }).direction, null);
assert.equal(tradeCall({ ...eligible, leading: null, levels: { ...eligible.levels, long: 20 } }).direction, null);
assert.equal(tradeCall({ ...eligible, levels: { ...eligible.levels,
  plans: { ...eligible.levels.plans, long: { target: 104, stop: 99.95, reward: 4, risk: .05 } } } }).direction, null);
assert.equal(tradeCall({ ...eligible, levels: { ...eligible.levels,
  plans: { ...eligible.levels.plans, long: { target: 120, stop: 90, reward: 20, risk: 10 } } } }).direction, null);
console.log('Strategy analysis: sample counts, three outcomes, no invented rate: OK');
