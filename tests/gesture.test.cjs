const assert = require('node:assert/strict');
const { viewport } = require('../assets/gesture.js');

assert.deepEqual(viewport(1000, 50, 0, 50, .5, .5), { count: 50, offset: 0 });
const zoomed = viewport(1000, 50, 200, 25, .5, .5);
assert.equal(zoomed.count, 25);
assert.ok(zoomed.offset > 200);
const panned = viewport(1000, 50, 200, 50, .5, .75);
assert.equal(panned.count, 50);
assert.ok(panned.offset > 200);
assert.deepEqual(viewport(20, 50, 100, 100, .5, .5), { count: 20, offset: 0 });
console.log('Chart gestures: anchor-preserving zoom, horizontal pan and bounds: OK');
