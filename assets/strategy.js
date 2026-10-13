/* Descriptive, non-overlapping historical analogs; no future bars enter features. */
(function (root, create) {
  const strategy = create();
  if (typeof module === 'object' && module.exports) module.exports = strategy;
  else root.MarketStrategy = strategy;
})(globalThis, function () {
  'use strict';

  const HORIZON = 3;
  const MIN_SAMPLES = 18;

  function mean(rows, key) {
    return rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  }

  function volatility(rows, index) {
    if (index < 14) return null;
    let sum = 0;
    for (let i = index - 13; i <= index; i++) {
      const prior = i ? rows[i - 1].c : rows[i].c;
      sum += Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - prior), Math.abs(rows[i].l - prior));
    }
    return sum / 14;
  }

  function regime(rows, index) {
    if (index < 24) return null;
    const close = rows[index].c;
    const ma5 = mean(rows.slice(index - 4, index + 1), 'c');
    const ma20 = mean(rows.slice(index - 19, index + 1), 'c');
    const priorMa20 = mean(rows.slice(index - 24, index - 4), 'c');
    if (close > ma20 && ma5 > ma20 && ma20 > priorMa20) return 'up';
    if (close < ma20 && ma5 < ma20 && ma20 < priorMa20) return 'down';
    return 'flat';
  }

  function movingAverageOrder(rows) {
    if (rows.length < 20) return null;
    const ma5 = mean(rows.slice(-5), 'c');
    const ma10 = mean(rows.slice(-10), 'c');
    const ma20 = mean(rows.slice(-20), 'c');
    return {
      ma5, ma10, ma20,
      order: ma5 > ma10 && ma10 > ma20 ? 'bullish' :
        ma5 < ma10 && ma10 < ma20 ? 'bearish' : 'mixed'
    };
  }

  function emaSeries(values, period) {
    let average = values[0];
    const alpha = 2 / (period + 1);
    return values.map(value => (average += alpha * (value - average)));
  }

  function confirmationSignals(rows) {
    if (!Array.isArray(rows) || rows.length < 35) return null;
    const closes = rows.map(row => row.c), fast = emaSeries(closes, 12), slow = emaSeries(closes, 26);
    const macd = fast.map((value, i) => value - slow[i]), signal = emaSeries(macd, 9);
    const histogram = macd.map((value, i) => value - signal[i]);
    const rsi = Array(rows.length).fill(null);
    let gain = 0, loss = 0;
    for (let i = 1; i < rows.length; i++) {
      const delta = closes[i] - closes[i - 1];
      if (i <= 14) { gain += Math.max(0, delta) / 14; loss += Math.max(0, -delta) / 14; }
      else { gain = (gain * 13 + Math.max(0, delta)) / 14; loss = (loss * 13 + Math.max(0, -delta)) / 14; }
      if (i >= 14) rsi[i] = gain + loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    const last = rows.at(-1), prior = rows.at(-2), i = rows.length - 1;
    const body = Math.abs(last.c - last.o), lower = Math.min(last.c, last.o) - last.l, upper = last.h - Math.max(last.c, last.o);
    const bullishPattern = last.c > last.o && ((prior.c < prior.o && last.o <= prior.c && last.c >= prior.o) || lower >= body * 2 && upper <= body);
    const bearishPattern = last.c < last.o && ((prior.c > prior.o && last.o >= prior.c && last.c <= prior.o) || upper >= body * 2 && lower <= body);
    const pivots = { lows: [], highs: [] };
    for (let j = Math.max(14, rows.length - 120); j < rows.length - 3; j++) {
      const nearby = [...rows.slice(j - 3, j), ...rows.slice(j + 1, j + 4)];
      if (rows[j].l < Math.min(...nearby.map(row => row.l))) pivots.lows.push(j);
      if (rows[j].h > Math.max(...nearby.map(row => row.h))) pivots.highs.push(j);
    }
    function divergence(indices, field, bullish) {
      const b = indices.at(-1), a = indices.filter(j => j <= b - 5).at(-1);
      if (a === undefined || b === undefined) return { regular: false, hidden: false };
      const price = rows[b][field] - rows[a][field], momentum = rsi[b] - rsi[a];
      return { regular: bullish ? price < 0 && momentum >= 2 : price > 0 && momentum <= -2,
        hidden: bullish ? price > 0 && momentum <= -2 : price < 0 && momentum >= 2,
        firstBar: rows[a].t, secondBar: rows[b].t };
    }
    return { rsi: rsi[i], macd: macd[i], histogram: histogram[i],
      bullishDivergence: divergence(pivots.lows, 'l', true), bearishDivergence: divergence(pivots.highs, 'h', false),
      long: last.c > prior.c && (bullishPattern || rsi[i] >= 40 && rsi[i] <= 70 && histogram[i] > histogram[i - 1]),
      short: last.c < prior.c && (bearishPattern || rsi[i] >= 30 && rsi[i] <= 60 && histogram[i] < histogram[i - 1]),
      bullishPattern, bearishPattern };
  }

  function nearbyLevels(rows, entry) {
    if (!Array.isArray(rows) || rows.length < 35 || !Number.isFinite(entry) || entry <= 0) return null;
    const recent = rows.slice(-120);
    const atr = volatility(recent, recent.length - 1);
    if (!Number.isFinite(atr) || atr <= 0) return null;
    // Use the nearest historical local low/high on either side of the price.
    // The three bars on each side keep the latest unfinished swing out.
    const tolerance = Math.max(atr * .12, entry * .0005);
    const buffer = Math.max(atr * .15, entry * .001);
    const swings = {support: [], resistance: []};
    for (let i = 3; i < recent.length - 3; i++) {
      const neighbors = [...recent.slice(i - 3, i), ...recent.slice(i + 1, i + 4)];
      if (recent[i].l < Math.min(...neighbors.map(bar => bar.l)))
        swings.support.push({price: recent[i].l, index: i});
      if (recent[i].h > Math.max(...neighbors.map(bar => bar.h)))
        swings.resistance.push({price: recent[i].h, index: i});
    }
    // Repeated confirmed pivots form a zone; old highs/lows can change role.
    const candidates = [...swings.support.map(p => ({...p, kind: 'low'})), ...swings.resistance.map(p => ({...p, kind: 'high'}))];
    const confirmed = recent.slice(-2);
    function selectZone(side) {
      const eligible = candidates.filter(p => side === 'support'
        ? p.price + tolerance + buffer < entry && (p.kind === 'low' || confirmed.every(bar => bar.c > p.price + tolerance))
        : p.price - tolerance - buffer > entry && (p.kind === 'high' || confirmed.every(bar => bar.c < p.price - tolerance)));
      eligible.sort((a, b) => a.price - b.price);
      const clusters = [];
      for (const pivot of eligible) {
        let cluster = clusters.at(-1);
        if (!cluster || pivot.price - cluster[0].price > tolerance * 2) clusters.push(cluster = []);
        cluster.push(pivot);
      }
      const zones = clusters.map(cluster => {
        const prices = cluster.map(p => p.price), lastIndex = Math.max(...cluster.map(p => p.index));
        return { low: Math.min(...prices) - tolerance, high: Math.max(...prices) + tolerance,
          center: prices.reduce((sum, price) => sum + price, 0) / prices.length,
          touches: cluster.length, lastTouchBars: recent.length - 1 - lastIndex,
          roleReversed: cluster.some(p => side === 'support' ? p.kind === 'high' : p.kind === 'low'), evidence: ['历史拐点'] };
      });
      zones.sort((a, b) => side === 'support' ? b.high - a.high : a.low - b.low);
      const zone = zones[0];
      if (!zone) return;
      if (zone.touches > 1) zone.evidence.push('多次触及');
      if (zone.roleReversed) zone.evidence.push('支撑压力转换');
      for (const period of [20, 50, 200]) if (rows.length >= period) {
        const average = emaSeries(rows.map(bar => bar.c), period).at(-1);
        if (average >= zone.low - tolerance && average <= zone.high + tolerance) zone.evidence.push('EMA' + period);
      }
      const low = swings.support.slice().sort((a,b)=>a.price-b.price)[0], high = swings.resistance.slice().sort((a,b)=>b.price-a.price)[0];
      if (low && high && high.price > low.price) for (const ratio of [.382, .5, .618, .786]) {
        const price = high.index > low.index ? high.price - (high.price - low.price) * ratio : low.price + (high.price - low.price) * ratio;
        if (price >= zone.low - tolerance && price <= zone.high + tolerance) zone.evidence.push('Fib ' + ratio);
      }
      return zone;
    }
    const supportZone = selectZone('support'), resistanceZone = selectZone('resistance');
    const result = {support: supportZone?.center, resistance: resistanceZone?.center,
      supportZone, resistanceZone, atr, buffer, long: null, short: null, plans: null};
    if (!supportZone || !resistanceZone) return result;
    const longTarget = resistanceZone.low - buffer;
    const longStop = supportZone.low - buffer;
    const shortTarget = supportZone.high + buffer;
    const shortStop = resistanceZone.high + buffer;
    if (!(longStop < entry && entry < longTarget && shortTarget < entry && entry < shortStop)) return result;
    const long = {entryZone: {low: supportZone.high + buffer, high: supportZone.high + buffer + atr * .5}, target: longTarget, stop: longStop, reward: longTarget - entry,
      risk: entry - longStop};
    const short = {entryZone: {low: resistanceZone.low - buffer - atr * .5, high: resistanceZone.low - buffer}, target: shortTarget, stop: shortStop, reward: entry - shortTarget,
      risk: shortStop - entry};
    const minRisk = Math.max(entry * .003, atr * .5);
    const maxRisk = atr * 4;
    long.validRisk = long.risk >= minRisk && long.risk <= maxRisk;
    short.validRisk = short.risk >= minRisk && short.risk <= maxRisk;
    result.long = long.validRisk ? long.reward / long.risk : null;
    result.short = short.validRisk ? short.reward / short.risk : null;
    result.plans = {long, short};
    return result;
  }

  function wilsonLower(hits, total) {
    const z = 1.96, p = hits / total, z2 = z * z;
    return (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) /
      (1 + z2 / total);
  }

  function analyzeStrategy(rows, entry) {
    if (!Array.isArray(rows) || rows.length < 35 || rows.some(bar => !Number.isFinite(bar.c) || bar.c <= 0)) {
      return { ready: false, reason: '已完成的 K 线不足，暂不能分析。' };
    }
    const latest = rows.at(-1);
    const price = Number.isFinite(entry) && entry > 0 ? entry : latest.c;
    const state = regime(rows, rows.length - 1);
    const levels = nearbyLevels(rows, price);
    const counts = { up: 0, flat: 0, down: 0 };
    let samples = 0;
    // A three-bar stride prevents overlapping outcome windows from being counted as separate cases.
    for (let index = 27; index + HORIZON < rows.length - 1; index += HORIZON) {
      if (regime(rows, index) !== state) continue;
      const atr = volatility(rows, index);
      if (!Number.isFinite(atr) || atr <= 0) continue;
      const move = rows[index + HORIZON].c - rows[index].c;
      const threshold = Math.max(rows[index].c * .003, atr * .5);
      counts[move > threshold ? 'up' : move < -threshold ? 'down' : 'flat']++;
      samples++;
    }
    const probabilities = samples >= MIN_SAMPLES ? {
      up: counts.up / samples, flat: counts.flat / samples, down: counts.down / samples
    } : null;
    const directionalSamples = counts.up + counts.down;
    const candidate = counts.up === counts.down ? null : counts.up > counts.down ? 'up' : 'down';
    const directionalRate = candidate && directionalSamples ? counts[candidate] / directionalSamples : null;
    const priorTurnover = rows.slice(-21, -1).map(bar => bar.v).filter(value => Number.isFinite(value) && value >= 0);
    const averageTurnover = priorTurnover.length === 20 ? priorTurnover.reduce((sum, value) => sum + value, 0) / 20 : null;
    const volumeRatio = Number.isFinite(latest.v) && averageTurnover > 0 ? latest.v / averageTurnover : null;
    // The three-way frequencies remain visible. The directional rate is explicitly
    // conditional on a move large enough to leave the flat bucket.
    const leading = candidate && directionalSamples >= 18 &&
      directionalRate >= .65 && probabilities[candidate] >= .30 &&
      wilsonLower(counts[candidate], directionalSamples) >= .40 ? candidate : null;
    return { ready: true, state, counts, samples, probabilities, levels, price,
      atr: volatility(rows, rows.length - 1),
      movingAverages: movingAverageOrder(rows), signals: confirmationSignals(rows),
      barTime: latest.t, horizon: HORIZON, leading, volumeRatio,
      directionalSamples, directionalRate };
  }

  function tradeCall(result) {
    if (!result?.ready || !result.probabilities) return { direction: null, reason: '同类样本不足，暂不判断方向。' };
    if (result.leading !== 'up' && result.leading !== 'down')
      return { direction: null, reason: '有方向的历史样本尚未达到入场优势门槛。' };
    const direction = result.leading;
    if (result.state !== direction || result.movingAverages?.order !==
        (direction === 'up' ? 'bullish' : 'bearish'))
      return { direction: null, reason: '当前趋势与历史方向优势尚未同向。' };
    const ratio = direction === 'up' ? result.levels?.long : result.levels?.short;
    const plan = direction === 'up' ? result.levels?.plans?.long : result.levels?.plans?.short;
    if (!plan)
      return { direction: null, reason: '参考价两侧尚未找到可用的历史局部支撑和压力。' };
    const zone = direction === 'up' ? result.levels.supportZone : result.levels.resistanceZone;
    if (zone && Math.abs(result.price - (direction === 'up' ? zone.high : zone.low)) > result.atr * 1.5)
      return { direction: null, reason: '参考价距离入场支撑或压力超过 1.5 倍 ATR，等待回测而不追价。' };
    if (result.signals && !result.signals[direction === 'up' ? 'long' : 'short'])
      return { direction: null, reason: '当前已完成 K 线尚未出现同向动量或反转形态确认；背离本身不作为入场触发。' };
    const risk = plan.risk;
    const minRisk = Math.max(result.price * .003, (result.atr || 0) * .5);
    if (risk < minRisk)
      return { direction: null, reason: '止损距离过窄，容易受正常波动影响。' };
    if (Number.isFinite(result.atr) && risk > result.atr * 4)
      return { direction: null, reason: '止损距离超过 4 倍 ATR，当前参考区间偏远。' };
    if (!Number.isFinite(ratio) || ratio < 1.5)
      return { direction: null, reason: '按区间外止损、区间前止盈计算，理论毛盈亏比不足 1.5:1。' };
    return { direction, rate: result.directionalRate,
      overallRate: result.probabilities[direction], hits: result.counts[direction],
      samples: result.directionalSamples, allSamples: result.samples, ratio };
  }

  return { analyzeStrategy, movingAverageOrder, nearbyLevels, confirmationSignals, tradeCall };
});
