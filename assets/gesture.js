/* Keep the same candle under a finger or pointer while the view changes. */
(function (root, create) {
  const gesture = create();
  if (typeof module === 'object' && module.exports) module.exports = gesture;
  else root.MarketGesture = gesture;
})(globalThis, function () {
  'use strict';
  function viewport(total, count, offset, nextCount, startFraction, endFraction) {
    if (!Number.isFinite(total) || total <= 0) return { count: 0, offset: 0 };
    const current = Math.max(1, Math.min(total, Math.round(count)));
    const next = Math.max(1, Math.min(total, Math.round(nextCount)));
    const start = Math.max(0, Math.min(1, startFraction));
    const end = Math.max(0, Math.min(1, endFraction));
    const anchor = total - offset - current + start * current;
    const nextStart = anchor - end * next;
    return { count: next, offset: Math.max(0, Math.min(total - next,
      Math.round(total - nextStart - next))) };
  }
  return { viewport };
});
