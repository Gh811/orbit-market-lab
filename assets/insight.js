/* Price-and-volume commentary based only on bars available at the selected time. */
(function (root, create) {
  const insight = create();
  if (typeof module === 'object' && module.exports) module.exports = insight;
  else root.MarketInsight = insight;
})(globalThis, function () {
  'use strict';

  function formatPrice(value) {
    if (!Number.isFinite(value)) return '—';
    const magnitude = Math.abs(value);
    if (magnitude > 0 && magnitude < .0001) return value.toExponential(4);
    return value.toFixed(magnitude < 1 ? 5 : 2);
  }

  function average(rows, field) {
    return rows.reduce((sum, row) => sum + row[field], 0) / rows.length;
  }

  function priorLevels(rows) {
    if (rows.length < 10) return {};
    const highs = [];
    const lows = [];
    const anchor = rows.at(-1).c;
    for (let index = 3; index < rows.length - 3; index++) {
      const neighbors = rows.slice(index - 3, index + 4);
      if (rows[index].h === Math.max(...neighbors.map(row => row.h))) highs.push(rows[index].h);
      if (rows[index].l === Math.min(...neighbors.map(row => row.l))) lows.push(rows[index].l);
    }
    return {
      support: lows.filter(value => value < anchor).sort((a, b) => b - a)[0],
      resistance: highs.filter(value => value > anchor).sort((a, b) => a - b)[0]
    };
  }

  function analyzeCandle(history, index, options = {}) {
    if (!Array.isArray(history) || index < 0 || index >= history.length) return null;
    const bar = history[index];
    const prior = history.slice(Math.max(0, index - 20), index);
    const recent = history.slice(Math.max(0, index - 59), index);
    const previous = index > 0 ? history[index - 1] : null;
    const duration = options.durationMs || 0;
    const stillOpen = !options.historical && index === history.length - 1 &&
      duration > 0 && (options.now || Date.now()) < bar.t + duration;
    const range = Math.max(bar.h - bar.l, bar.c * 0.000001);
    const move = (bar.c / bar.o - 1) * 100;
    const body = Math.abs(bar.c - bar.o) / range;
    const upperWick = (bar.h - Math.max(bar.o, bar.c)) / range;
    const lowerWick = (Math.min(bar.o, bar.c) - bar.l) / range;
    const closePosition = (bar.c - bar.l) / range;
    const direction = move > 0.03 ? 'up' : move < -0.03 ? 'down' : 'flat';
    const evidence = [];
    const measures = [];

    let shape = direction === 'up' ? '收涨' : direction === 'down' ? '收跌' : '接近开盘价';
    if (direction !== 'flat') shape += ' ' + Math.abs(move).toFixed(2) + '%';
    if (body >= .58) shape += '，实体占当根振幅较大';
    else if (body <= .22) shape += '，实体较小，方向还不鲜明';
    if (upperWick >= .38 && upperWick > body) shape += '；上影线较长，盘中上探后回落';
    else if (lowerWick >= .38 && lowerWick > body) shape += '；下影线较长，盘中下探后收回';
    else if (direction === 'up' && closePosition >= .75) shape += '，收盘靠近当根高位';
    else if (direction === 'down' && closePosition <= .25) shape += '，收盘靠近当根低位';
    evidence.push(shape + '。');
    measures.push({ label: '收盘', value: formatPrice(bar.c) });

    let volumeRatio = null;
    const volumeHistory = prior.filter(row => Number.isFinite(row.v) && row.v >= 0);
    if (stillOpen) {
      evidence.push('本根 K 线尚未收盘，成交额仍在累积，暂不与完整 K 线直接比较。');
      measures.push({ label: '成交额', value: '未收盘' });
    } else if (volumeHistory.length >= 5 && average(volumeHistory, 'v') > 0) {
      volumeRatio = bar.v / average(volumeHistory, 'v');
      const comparison = volumeHistory.length === 20 ? '前 20 根' : '此前 ' + volumeHistory.length + ' 根';
      const adjective = volumeRatio >= 1.5 ? '明显放大' : volumeRatio <= .65 ? '明显偏低' : '接近常态';
      evidence.push('成交额约为' + comparison + '平均成交额的 ' + volumeRatio.toFixed(1) + ' 倍，活跃度' + adjective + '。');
      measures.push({ label: '相对成交额', value: volumeRatio.toFixed(1) + '×' });
    } else {
      evidence.push('此前可比较的成交额样本不足，暂不判断放大或缩小。');
      measures.push({ label: '相对量', value: '样本不足' });
    }

    let ma5 = null;
    let ma20 = null;
    if (index >= 4) ma5 = average(history.slice(index - 4, index + 1), 'c');
    if (index >= 19) ma20 = average(history.slice(index - 19, index + 1), 'c');
    if (ma20 !== null) {
      if (bar.c > ma5 && ma5 > ma20) evidence.push('收盘价高于 MA5，且 MA5 高于 MA20；短期价格位置偏强。');
      else if (bar.c < ma5 && ma5 < ma20) evidence.push('收盘价低于 MA5，且 MA5 低于 MA20；短期价格位置偏弱。');
      else evidence.push('收盘价与 MA5、MA20 的位置并不一致，趋势线索仍有分歧。');
      measures.push({ label: 'MA20', value: formatPrice(ma20) });
    } else if (ma5 !== null) {
      evidence.push('已有 MA5 参考，但计算 MA20 的历史根数还不够。');
    }

    const fiveBar = index >= 5 ? (bar.c / history[index - 5].c - 1) * 100 : null;
    if (fiveBar !== null) {
      evidence.push('与 5 根 K 线前的收盘相比，当前价格' +
        (fiveBar >= 0 ? '高' : '低') + ' ' + Math.abs(fiveBar).toFixed(2) + '%。');
      measures.push({ label: '近 5 根', value: (fiveBar >= 0 ? '+' : '') + fiveBar.toFixed(2) + '%' });
    }

    const levels = priorLevels(recent);
    let focus = '下一根重点观察收盘方向与成交额是否延续。';
    if (previous && Number.isFinite(levels.resistance) &&
        previous.c <= levels.resistance * 1.002 && bar.c > levels.resistance * 1.002) {
      focus = '价格刚越过此前局部压力 ' + formatPrice(levels.resistance) +
        '；观察后续收盘能否留在其上方' +
        (volumeRatio !== null && volumeRatio < 1.2 ? '，本次量能尚未明显配合。' : '。');
    } else if (previous && Number.isFinite(levels.support) &&
        previous.c >= levels.support * .998 && bar.c < levels.support * .998) {
      focus = '价格刚跌破此前局部支撑 ' + formatPrice(levels.support) +
        '；观察后续是否重新站回该价位。';
    } else if (Number.isFinite(levels.resistance) &&
        Math.abs(bar.c / levels.resistance - 1) <= .015) {
      focus = '目前接近此前局部压力 ' + formatPrice(levels.resistance) +
        '；留意下一根能否突破及量能是否增加。';
    } else if (Number.isFinite(levels.support) &&
        Math.abs(bar.c / levels.support - 1) <= .015) {
      focus = '目前接近此前局部支撑 ' + formatPrice(levels.support) +
        '；留意下一根是否守住以及是否出现放量下跌。';
    }

    const bullish = direction === 'up' && ma20 !== null && bar.c > ma5 && ma5 > ma20 &&
      fiveBar > 0 && volumeRatio !== null && volumeRatio >= 1.2;
    const bearish = direction === 'down' && ma20 !== null && bar.c < ma5 && ma5 < ma20 &&
      fiveBar < 0 && volumeRatio !== null && volumeRatio >= 1.2;
    const tone = bullish ? 'positive' : bearish ? 'negative' : 'neutral';
    let title;
    let summary;
    if (bullish) {
      title = '量价与均线暂时同向';
      summary = '这根 K 线的收涨、放量与均线位置互相呼应；后续仍要看是否延续。';
    } else if (bearish) {
      title = '下行与量能同时增强';
      summary = '这根 K 线的收跌、放量与均线位置互相呼应；后续仍要看是否企稳。';
    } else if (direction === 'up' && volumeRatio !== null && volumeRatio < .65) {
      title = '价格上行，量能偏弱';
      summary = '价格收涨，但参与量低于近期常态；单根上涨还需要后续 K 线确认。';
    } else if (direction === 'down' && volumeRatio !== null && volumeRatio >= 1.5) {
      title = '回落伴随放量';
      summary = '下跌时成交额明显增加；下一根是否止跌和此前支撑是否有效更值得关注。';
    } else if (upperWick >= .38 && upperWick > body) {
      title = '盘中上探后回落';
      summary = '较长上影线说明当根高位未能维持；结合压力位和后续收盘再判断。';
    } else if (lowerWick >= .38 && lowerWick > body) {
      title = '盘中下探后收回';
      summary = '较长下影线说明当根低位未能维持；结合支撑位和后续收盘再判断。';
    } else {
      title = '线索尚未形成一致方向';
      summary = '这根 K 线提供了局部信息，但价格、量能和趋势尚不足以共同确认一个方向。';
    }

    return {
      title, summary, evidence, measures, focus, tone, time: bar.t,
      basis: (options.historical ? '只使用该题目已揭晓部分及更早的 K 线。' :
        '只使用该时间点及之前的 K 线。') +
        '不包含新闻、盘口和基本面；这些观察不等于未来胜率或交易指令。'
    };
  }

  return { analyzeCandle };
});
