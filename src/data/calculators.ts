import type {
  KLineData,
  TechnicalIndicators,
  ValuationMetrics,
  RealtimeQuote,
  HistoricalValuationPoint,
  FinancialData,
  PeerComparison,
  InsiderTrading,
} from "./types.js";

/**
 * 计算简单移动平均线 (SMA)
 */
export function calculateMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  const slice = closes.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * 计算所有技术指标
 */
export function calculateTechnicalIndicators(
  realtime: RealtimeQuote,
  kline: KLineData[]
): TechnicalIndicators {
  const closes = kline.map((d) => d.close);
  const currentPrice = realtime.price;

  const ma5 = calculateMA(closes, 5);
  const ma20 = calculateMA(closes, 20);
  const ma60 = calculateMA(closes, 60);

  // 计算MA5/MA20序列用于金叉死叉检测
  const ma5Series: number[] = [];
  const ma20Series: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i >= 4) {
      ma5Series.push(
        closes.slice(i - 4, i + 1).reduce((sum, v) => sum + v, 0) / 5
      );
    }
    if (i >= 19) {
      ma20Series.push(
        closes.slice(i - 19, i + 1).reduce((sum, v) => sum + v, 0) / 20
      );
    }
  }

  // 近期金叉死叉检测（近5个交易日）
  let recentCross: "金叉" | "死叉" | null = null;
  for (let i = ma5Series.length - 5; i < ma5Series.length; i++) {
    if (i <= 0) continue;
    const prev5 = ma5Series[i - 1];
    const curr5 = ma5Series[i];
    const prev20 = ma20Series[i - 1];
    const curr20 = ma20Series[i];
    if (prev5 <= prev20 && curr5 > curr20) {
      recentCross = "金叉";
      break;
    }
    if (prev5 >= prev20 && curr5 < curr20) {
      recentCross = "死叉";
      break;
    }
  }

  // MA60方向判断（与20天前比较）
  let ma60Direction: "上升" | "下降" | "走平" = "走平";
  if (closes.length >= 80) {
    const ma60_20days_ago = calculateMA(closes.slice(0, -20), 60);
    if (ma60 > ma60_20days_ago * 1.005) {
      ma60Direction = "上升";
    } else if (ma60 < ma60_20days_ago * 0.995) {
      ma60Direction = "下降";
    }
  }

  // 股价偏离MA20
  const deviationFromMA20 = (currentPrice - ma20) / ma20;

  // 趋势判断：细化分类
  let trend: TechnicalIndicators["trend"];
  if (ma5 > ma20 && ma20 > ma60) {
    trend = ma60Direction === "上升" ? "强势上升" : "上升通道";
  } else if (ma5 < ma20 && ma20 < ma60) {
    trend = ma60Direction === "下降" ? "弱势下跌" : "下降通道";
  } else if (ma5 > ma20 && ma20 < ma60) {
    trend = "短期反弹";
  } else if (ma5 < ma20 && ma20 > ma60) {
    trend = "回调";
  } else {
    trend = "震荡整理";
  }

  // 支撑位：近期低点 + 成交量密集区的低点
  const recent = kline.slice(-90); // 近3个月
  const supports = findSupportLevels(recent);

  // 压力位：近期高点 + 成交量密集区的高点
  const resistances = findResistanceLevels(recent);

  return {
    currentPrice,
    ma5,
    ma20,
    ma60,
    ma60Direction,
    trend,
    ma5Position: currentPrice > ma5 ? "上方" : "下方",
    ma20Position: currentPrice > ma20 ? "上方" : "下方",
    ma60Position: currentPrice > ma60 ? "上方" : "下方",
    deviationFromMA20,
    recentCross,
    supports,
    resistances,
  };
}

/**
 * 寻找支撑位
 * 算法：
 * 1. 找出近期 N 日低点中的局部最小值
 * 2. 结合成交量（成交量大的低点更可靠）
 */
function findSupportLevels(recent: KLineData[]): number[] {
  // 找出近 60 日的显著低点（局部最小值）
  const lows: { price: number; volume: number; date: string }[] = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const curr = recent[i].low;
    const prev1 = recent[i - 1].low;
    const prev2 = recent[i - 2].low;
    const next1 = recent[i + 1].low;
    const next2 = recent[i + 2].low;

    // 局部最小值：比前后各两天都低
    if (curr < prev1 && curr < prev2 && curr < next1 && curr < next2) {
      lows.push({
        price: curr,
        volume: recent[i].volume,
        date: recent[i].date,
      });
    }
  }

  // 按成交量排序，取成交量最大的两个
  lows.sort((a, b) => b.volume - a.volume);
  return lows.slice(0, 2).map((l) => l.price);
}

/**
 * 寻找压力位
 * 算法：
 * 1. 找出近期 N 日高点中的局部最大值
 * 2. 结合成交量（成交量大的高点更可靠）
 */
function findResistanceLevels(recent: KLineData[]): number[] {
  const highs: { price: number; volume: number; date: string }[] = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const curr = recent[i].high;
    const prev1 = recent[i - 1].high;
    const prev2 = recent[i - 2].high;
    const next1 = recent[i + 1].high;
    const next2 = recent[i + 2].high;

    if (curr > prev1 && curr > prev2 && curr > next1 && curr > next2) {
      highs.push({
        price: curr,
        volume: recent[i].volume,
        date: recent[i].date,
      });
    }
  }

  highs.sort((a, b) => b.volume - a.volume);
  return highs.slice(0, 2).map((h) => h.price);
}

/**
 * 计算估值指标
 */
export function calculateValuation(realtime: RealtimeQuote): ValuationMetrics {
  return {
    pe: realtime.pe,
    pb: realtime.pb,
    marketCap: realtime.marketCap,
  };
}

/**
 * 计算 PE 历史百分位和相关统计
 */
export function calculatePEPercentile(
  currentPE: number,
  historicalPEs: HistoricalValuationPoint[]
): ValuationMetrics["peStats"] & { percentile: number; zone: "低估" | "合理" | "高估" } | null {
  if (!historicalPEs || historicalPEs.length === 0) return null;

  const peValues = historicalPEs
    .map((p) => p.peTtm)
    .filter((v) => v > 0 && Number.isFinite(v));
  if (peValues.length === 0) return null;

  const sorted = [...peValues].sort((a, b) => a - b);
  const n = sorted.length;

  // 计算百分位：小于当前PE的数据占比
  const belowCount = sorted.filter((v) => v < currentPE).length;
  const percentile = (belowCount / n) * 100;

  // 分位数计算
  const quantile = (arr: number[], q: number): number => {
    const pos = (arr.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (arr[base + 1] !== undefined) {
      return arr[base] + rest * (arr[base + 1] - arr[base]);
    }
    return arr[base];
  };

  const mean = peValues.reduce((sum, v) => sum + v, 0) / peValues.length;
  const median = quantile(sorted, 0.5);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);

  // 估值区间判断
  let zone: "低估" | "合理" | "高估" = "合理";
  if (percentile <= 25) zone = "低估";
  else if (percentile >= 75) zone = "高估";

  return {
    percentile,
    zone,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median,
    p25,
    p75,
    historicalMin: sorted[0],
    historicalMax: sorted[n - 1],
  };
}

/**
 * 生成 PE 历史百分位分析文本（纯程序化输出）
 */
export function generatePEPercentileAnalysis(
  currentPE: number,
  peStats: NonNullable<ValuationMetrics["peStats"]>,
  percentile: number,
  zone: string,
  historicalPEs: HistoricalValuationPoint[]
): string {
  const days = historicalPEs.length;
  const startDate = historicalPEs[0].date;
  const endDate = historicalPEs[historicalPEs.length - 1].date;

  // 计算近1年、近3年、近5年的百分位
  const now = new Date();
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const threeYearsAgo = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
  const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());

  const calcPeriodPercentile = (
    since: Date
  ): { percentile: number; count: number } | null => {
    const sinceStr = since.toISOString().slice(0, 10);
    const periodPEs = historicalPEs
      .filter((p) => p.date >= sinceStr && p.peTtm > 0)
      .map((p) => p.peTtm);
    if (periodPEs.length === 0) return null;
    const below = periodPEs.filter((v) => v < currentPE).length;
    return { percentile: (below / periodPEs.length) * 100, count: periodPEs.length };
  };

  const p1y = calcPeriodPercentile(oneYearAgo);
  const p3y = calcPeriodPercentile(threeYearsAgo);
  const p5y = calcPeriodPercentile(fiveYearsAgo);

  // 寻找历史上的相似估值日期（分时段，排除近期噪音）
  const nowTs = new Date(endDate).getTime();

  // 计算后续N日涨跌幅
  function calcSubsequentReturn(date: string, nDays: number): string {
    const idx = historicalPEs.findIndex((p) => p.date === date);
    if (idx < 0 || idx + nDays >= historicalPEs.length) return "—";
    const start = historicalPEs[idx].close;
    const end = historicalPEs[idx + nDays].close;
    const ret = ((end - start) / start) * 100;
    return `${ret > 0 ? "+" : ""}${ret.toFixed(1)}%`;
  }

  // 分时段找最匹配的日期
  const windows = [
    { label: "近1年", minDays: 60, maxDays: 365 },
    { label: "1-3年", minDays: 365, maxDays: 365 * 3 },
    { label: "3-5年", minDays: 365 * 3, maxDays: 365 * 5 },
    { label: "5年以上", minDays: 365 * 5, maxDays: Infinity },
  ];

  const similarMatches = windows
    .map((w) => {
      const candidates = historicalPEs.filter((p) => {
        const d = new Date(p.date).getTime();
        const days = (nowTs - d) / (1000 * 60 * 60 * 24);
        return (
          days >= w.minDays &&
          days < w.maxDays &&
          Math.abs(p.peTtm - currentPE) / currentPE < 0.1
        );
      });
      if (candidates.length === 0) return null;
      const best = candidates.reduce((best, curr) =>
        Math.abs(curr.peTtm - currentPE) < Math.abs(best.peTtm - currentPE)
          ? curr
          : best
      );
      const years = (
        (nowTs - new Date(best.date).getTime()) /
        (1000 * 60 * 60 * 24 * 365)
      ).toFixed(1);
      return {
        date: best.date,
        yearsAgo: years,
        pe: best.peTtm,
        ret20: calcSubsequentReturn(best.date, 20),
        ret60: calcSubsequentReturn(best.date, 60),
        label: w.label,
      };
    })
    .filter(Boolean);

  const similarSection =
    similarMatches.length > 0
      ? `\n**历史上接近当前估值的日期（排除近期噪音）：**\n\n| 日期 | 距今 | 当时PE | 后续20日涨跌 | 后续60日涨跌 |\n|------|------|--------|-------------|-------------|\n${similarMatches.map((m) => `| ${m!.date} | ${m!.yearsAgo}年（${m!.label}） | ${m!.pe.toFixed(2)} | ${m!.ret20} | ${m!.ret60} |`).join("\n")}`
      : "\n历史上排除近期噪音后，未找到与当前估值显著相似的交易日。";

  return `## 市盈率（PE）历史百分位分析

**当前估值：**
- 当前市盈率（PE-TTM）：**${currentPE.toFixed(2)}**
- 历史数据范围：${startDate} 至 ${endDate}（共 ${days} 个交易日）

**历史百分位：**
| 时间区间 | 百分位 | 数据量 |
|---------|--------|--------|
| 全部历史 | **${percentile.toFixed(1)}%** | ${days} 个交易日 |
${p5y ? `| 近五年 | **${p5y.percentile.toFixed(1)}%** | ${p5y.count} 个交易日 |` : "| 近五年 | — | 数据不足 |"}
${p3y ? `| 近三年 | **${p3y.percentile.toFixed(1)}%** | ${p3y.count} 个交易日 |` : "| 近三年 | — | 数据不足 |"}
${p1y ? `| 近一年 | **${p1y.percentile.toFixed(1)}%** | ${p1y.count} 个交易日 |` : "| 近一年 | — | 数据不足 |"}

**历史 PE 统计：**
| 指标 | 数值 |
|------|------|
| 历史最低 PE | ${peStats.min.toFixed(2)} |
| 历史最高 PE | ${peStats.max.toFixed(2)} |
| 历史平均 PE | ${peStats.mean.toFixed(2)} |
| 历史中位数 PE | ${peStats.median.toFixed(2)} |
| 25% 分位数 | ${peStats.p25.toFixed(2)} |
| 75% 分位数 | ${peStats.p75.toFixed(2)} |

**估值判断：${zone}**

${
  zone === "低估"
    ? `当前 PE（${currentPE.toFixed(2)}）低于历史 25% 分位数（${peStats.p25.toFixed(2)}），处于历史估值低位区间。从历史数据看，估值低于此水平的交易日占比仅 ${percentile.toFixed(1)}%，属于相对低估区域。`
    : zone === "高估"
      ? `当前 PE（${currentPE.toFixed(2)}）高于历史 75% 分位数（${peStats.p75.toFixed(2)}），处于历史估值高位区间。从历史数据看，估值高于此水平的交易日占比仅 ${(100 - percentile).toFixed(1)}%，属于相对高估区域。`
      : `当前 PE（${currentPE.toFixed(2)}）处于历史估值中间区间（25%-75% 分位数之间），从历史数据看属于合理估值范围。`
}${similarSection}

> 注：PE-TTM 为滚动市盈率，基于最近四个季度净利润计算。历史数据来源于东方财富。
`;
}

/**
 * 计算均线分析文本（纯程序化输出）
 */
export function generateMovingAverageAnalysis(
  tech: TechnicalIndicators
): string {
  const { currentPrice, ma5, ma20, ma60, trend, ma60Direction, deviationFromMA20, recentCross } =
    tech;

  // 偏离度定性
  const deviationAbs = Math.abs(deviationFromMA20) * 100;
  let deviationAlert = "";
  if (deviationAbs > 15) {
    deviationAlert =
      deviationFromMA20 > 0
        ? `\n\n⚠️ **超买预警：** 股价偏离 MA20 达 ${deviationAbs.toFixed(2)}%，短期回调风险较大。`
        : `\n\n⚠️ **超卖预警：** 股价偏离 MA20 达 -${deviationAbs.toFixed(2)}%，短期反弹概率增加。`;
  } else if (deviationAbs > 10) {
    deviationAlert =
      deviationFromMA20 > 0
        ? `\n\n⚠️ **偏离提示：** 股价偏离 MA20 达 ${deviationAbs.toFixed(2)}%，注意短期波动风险。`
        : `\n\n⚠️ **偏离提示：** 股价偏离 MA20 达 -${deviationAbs.toFixed(2)}%，存在技术性修复需求。`;
  }

  // 交叉信号
  let crossText = "";
  if (recentCross === "金叉") {
    crossText = `\n\n📈 **近期信号：** 近 5 个交易日内出现 MA5 上穿 MA20 的**金叉**信号，短期趋势转强。`;
  } else if (recentCross === "死叉") {
    crossText = `\n\n📉 **近期信号：** 近 5 个交易日内出现 MA5 下穿 MA20 的**死叉**信号，短期趋势转弱。`;
  }

  // 趋势描述
  let trendDesc = "";
  switch (trend) {
    case "强势上升":
      trendDesc =
        "当前呈多头排列且中期均线向上，股价处于强势上升趋势中，动能充沛。";
      break;
    case "上升通道":
      trendDesc =
        "当前呈多头排列，短期均线在长期均线上方，股价处于上升趋势中。";
      break;
    case "短期反弹":
      trendDesc =
        "股价站上短期均线但中期均线仍在其上方，属于短期反弹格局，需关注能否突破中期压制。";
      break;
    case "回调":
      trendDesc =
        "股价跌破短期均线但中期均线仍在下方，属于上升趋势中的回调阶段，中期支撑尚有效。";
      break;
    case "下降通道":
      trendDesc =
        "当前呈空头排列，短期均线在长期均线下方，股价处于下降趋势中。";
      break;
    case "弱势下跌":
      trendDesc =
        "当前呈空头排列且中期均线向下，股价处于弱势下跌趋势中，动能偏弱。";
      break;
    default:
      trendDesc =
        "当前均线交织，无明显趋势方向，处于震荡整理阶段。";
  }

  return `| 均线 | 数值 | 股价位置 | 偏离幅度 |
|------|------|---------|---------|
| **五日线 (MA5)** | **${ma5.toFixed(2)}** | ${currentPrice > ma5 ? "📈 上方" : "📉 下方"} | ${((currentPrice - ma5) / ma5 * 100).toFixed(2)}% |
| **二十日线 (MA20)** | **${ma20.toFixed(2)}** | ${currentPrice > ma20 ? "📈 上方" : "📉 下方"} | ${((currentPrice - ma20) / ma20 * 100).toFixed(2)}% |
| **六十日线 (MA60)** | **${ma60.toFixed(2)}** | ${currentPrice > ma60 ? "📈 上方" : "📉 下方"} | ${((currentPrice - ma60) / ma60 * 100).toFixed(2)}% |

**均线排列：** MA5(${ma5.toFixed(0)}) ${ma5 > ma20 ? ">" : "<"} MA20(${ma20.toFixed(0)}) ${ma20 > ma60 ? ">" : "<"} MA60(${ma60.toFixed(0)})
**MA60 方向：** ${ma60Direction}
**趋势判断：${trend}**

${trendDesc}${deviationAlert}${crossText}
`;
}

/**
 * 价格聚类：将相近价位合并为支撑/压力区
 */
function clusterPrices(
  prices: number[],
  bandwidth: number
): { center: number; range: [number, number]; touches: number }[] {
  if (prices.length === 0) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters: { values: number[]; min: number; max: number }[] = [];
  let current = { values: [sorted[0]], min: sorted[0], max: sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const price = sorted[i];
    if ((price - current.min) / current.min <= bandwidth) {
      current.values.push(price);
      current.max = price;
    } else {
      clusters.push(current);
      current = { values: [price], min: price, max: price };
    }
  }
  clusters.push(current);

  return clusters.map((c) => ({
    center: c.values.reduce((a, b) => a + b, 0) / c.values.length,
    range: [c.min, c.max],
    touches: c.values.length,
  }));
}

/**
 * 寻找心理关口（整数位/半整数位）
 */
function findPsychologicalLevels(price: number): number[] {
  const levels: number[] = [];
  const step = price >= 100 ? 10 : price >= 50 ? 5 : price >= 10 ? 1 : 0.5;
  for (let i = -2; i <= 2; i++) {
    const level = Math.round(price / step + i) * step;
    if (level > 0 && Math.abs(level - price) / price < 0.15) {
      levels.push(level);
    }
  }
  return [...new Set(levels)].sort((a, b) => a - b);
}

/**
 * 统计K线在某价格区间内的触及次数
 */
function countTouches(kline: KLineData[], range: [number, number]): number {
  let count = 0;
  for (const d of kline) {
    const low = Math.min(d.open, d.close, d.low);
    const high = Math.max(d.open, d.close, d.high);
    if (high >= range[0] && low <= range[1]) {
      count++;
    }
  }
  return count;
}

/**
 * 计算支撑压力位分析文本（纯程序化输出）
 */
export function generateSupportResistanceAnalysis(
  tech: TechnicalIndicators,
  kline?: KLineData[]
): string {
  const { currentPrice, supports, resistances } = tech;

  // 对支撑位/压力位做聚类合并
  const supportClusters = clusterPrices(supports, 0.02);
  const resistanceClusters = clusterPrices(resistances, 0.02);

  const supportClusterText = supportClusters
    .map((c, i) => {
      const touches = kline ? countTouches(kline, c.range) : 0;
      const dist = Math.abs(((currentPrice - c.center) / currentPrice) * 100);
      const status = currentPrice > c.center ? `距当前 -${dist.toFixed(2)}%` : `已跌破（+${dist.toFixed(2)}%）`;
      return `- **支撑区 ${i + 1}**: ¥${c.center.toFixed(2)}（区间 ¥${c.range[0].toFixed(2)}-¥${c.range[1].toFixed(2)}，${status}，${touches > 0 ? `历史测试 ${touches} 次` : "近期低点"}）`;
    })
    .join("\n");

  const resistanceClusterText = resistanceClusters
    .map((c, i) => {
      const touches = kline ? countTouches(kline, c.range) : 0;
      const dist = Math.abs(((c.center - currentPrice) / currentPrice) * 100);
      const status = currentPrice < c.center ? `距当前 +${dist.toFixed(2)}%` : `已突破（-${dist.toFixed(2)}%）`;
      return `- **压力区 ${i + 1}**: ¥${c.center.toFixed(2)}（区间 ¥${c.range[0].toFixed(2)}-¥${c.range[1].toFixed(2)}，${status}，${touches > 0 ? `历史测试 ${touches} 次` : "近期高点"}）`;
    })
    .join("\n");

  // 多时间窗口对比
  let multiWindowText = "";
  if (kline && kline.length >= 30) {
    const shortWindow = kline.slice(-30);
    const mediumWindow = kline.slice(-90);
    const shortSupports = findSupportLevels(shortWindow);
    const shortResistances = findResistanceLevels(shortWindow);

    multiWindowText = `\n\n**多时间窗口对比：**
| 时间框架 | 支撑位 | 压力位 |
|----------|--------|--------|
| 短线（30日） | ${shortSupports.map((s) => `¥${s.toFixed(2)}`).join("、") || "暂无明显支撑"} | ${shortResistances.map((r) => `¥${r.toFixed(2)}`).join("、") || "暂无明显压力"} |
| 中线（90日） | ${supports.map((s) => `¥${s.toFixed(2)}`).join("、") || "暂无明显支撑"} | ${resistances.map((r) => `¥${r.toFixed(2)}`).join("、") || "暂无明显压力"} |`;

    if (kline.length >= 250) {
      const longWindow = kline.slice(-250);
      const longSupports = findSupportLevels(longWindow);
      const longResistances = findResistanceLevels(longWindow);
      multiWindowText += `\n| 长线（250日） | ${longSupports.map((s) => `¥${s.toFixed(2)}`).join("、") || "暂无明显支撑"} | ${longResistances.map((r) => `¥${r.toFixed(2)}`).join("、") || "暂无明显压力"} |`;
    }
  }

  // 心理关口
  const psychLevels = findPsychologicalLevels(currentPrice);
  const psychText =
    psychLevels.length > 0
      ? `\n\n**心理关口：** ${psychLevels.map((l) => `¥${l.toFixed(2)}`).join("、")}（整数位或半整数位，在 A 股中常形成心理支撑/压力）`
      : "";

  return `基于近三个月 K 线走势的成交量加权高低点分析：

**支撑位（下跌可能反弹的位置）：**
${supportClusterText || "- 近期未形成明显支撑位"}

**压力位（上涨可能受阻的位置）：**
${resistanceClusterText || "- 近期未形成明显压力位"}${multiWindowText}${psychText}

> 计算方法：识别近期局部高低点，按成交量加权筛选并聚类合并（±2% 带宽内），成交量越大、测试次数越多的价位支撑/压力作用越强。
`;
}

/**
 * 分析数值序列的变化趋势方向
 */
function analyzeValueTrend(values: number[]): string {
  if (values.length < 2) return "数据不足";
  let upCount = 0,
    downCount = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) upCount++;
    else if (values[i] < values[i - 1]) downCount++;
  }
  const total = values.length - 1;
  if (downCount === total) return "逐年放缓";
  if (upCount === total) return "逐年加速";
  if (upCount > downCount * 2) return "波动上行";
  if (downCount > upCount * 2) return "波动下行";
  return "波动";
}

/**
 * 计算百分位（辅助函数）
 */
function calculatePercentile(value: number, peers: number[]): number {
  const valid = peers.filter((v) => v != null && !isNaN(v));
  if (valid.length === 0) return 0;
  const sorted = [...valid].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < value).length;
  return (below / sorted.length) * 100;
}

/**
 * 生成财务趋势分析文本（数据驱动）
 */
export function generateFinancialAnalysis(
  financials: FinancialData[],
  peerComparison?: PeerComparison | null
): string {
  if (!financials || financials.length === 0) {
    return "暂无财务数据。";
  }

  // 按年份升序排列展示
  const sorted = [...financials].sort((a, b) => a.year - b.year);
  const latest = sorted[sorted.length - 1];

  const rows = sorted
    .map((f) => {
      const revGrowthStr =
        f.revenueGrowth > 0
          ? `+${f.revenueGrowth.toFixed(2)}%`
          : `${f.revenueGrowth.toFixed(2)}%`;
      const profitGrowthStr =
        f.profitGrowth > 0
          ? `+${f.profitGrowth.toFixed(2)}%`
          : `${f.profitGrowth.toFixed(2)}%`;
      const roeStr = f.roe != null ? `${f.roe.toFixed(2)}%` : "—";
      const marginStr =
        f.grossMargin != null ? `${f.grossMargin.toFixed(2)}%` : "—";
      return `| ${f.year} | ${f.revenue.toFixed(2)} | ${revGrowthStr} | ${f.netProfit.toFixed(2)} | ${profitGrowthStr} | ${roeStr} | ${marginStr} |`;
    })
    .join("\n");

  // 趋势轨迹分析
  let trajectoryText = "";
  if (sorted.length >= 2) {
    const revGrowths = sorted.map((f) => f.revenueGrowth);
    const profitGrowths = sorted.map((f) => f.profitGrowth);
    const revTrend = analyzeValueTrend(revGrowths);
    const profitTrend = analyzeValueTrend(profitGrowths);
    trajectoryText = `\n\n**增速轨迹：** 营收增速呈${revTrend}趋势（${revGrowths.map((v) => `${v.toFixed(1)}%`).join(" → ")}），净利润增速呈${profitTrend}趋势（${profitGrowths.map((v) => `${v.toFixed(1)}%`).join(" → ")}）。`;
  }

  // 营收-净利背离分析
  let divergenceText = "";
  if (latest.revenueGrowth != null && latest.profitGrowth != null) {
    const gap = latest.profitGrowth - latest.revenueGrowth;
    if (Math.abs(gap) > 10) {
      divergenceText =
        gap > 0
          ? `\n\n**增速背离：** 净利润增速（${latest.profitGrowth.toFixed(2)}%）显著高于营收增速（${latest.revenueGrowth.toFixed(2)}%），利润率改善或存在非经常性损益影响。`
          : `\n\n**增速背离：** 净利润增速（${latest.profitGrowth.toFixed(2)}%）显著低于营收增速（${latest.revenueGrowth.toFixed(2)}%），利润率承压，需关注成本端变化。`;
    } else if (Math.abs(gap) > 5) {
      divergenceText =
        gap > 0
          ? `\n\n**增速背离：** 净利润增速略高于营收增速，盈利能力有所改善。`
          : `\n\n**增速背离：** 净利润增速略低于营收增速，盈利能力有所弱化。`;
    }
  }

  // 最新一期趋势定性
  const trendLabel =
    latest.revenueGrowth > 20
      ? "高速增长"
      : latest.revenueGrowth > 10
        ? "稳健增长"
        : latest.revenueGrowth > 0
          ? "低速增长"
          : "收入下滑";

  // ROE行业分位
  let roePeerText = "";
  if (peerComparison && latest.roe != null) {
    const peerROEs = peerComparison.peers
      .map((p) => p.roe)
      .filter((v): v is number => v != null && !isNaN(v));
    if (peerROEs.length > 0) {
      const pct = calculatePercentile(latest.roe, peerROEs);
      const roeLabel =
        pct > 75 ? "行业领先" : pct > 50 ? "行业中上" : pct > 25 ? "行业中下" : "行业落后";
      roePeerText = `ROE 为 ${latest.roe.toFixed(2)}%，处于同行业${roeLabel}水平（行业分位：${pct.toFixed(1)}%）。`;
    }
  }

  // ROE定性（如果无行业数据则用绝对标准）
  let roeText = "";
  if (latest.roe != null) {
    if (roePeerText) {
      roeText = roePeerText;
    } else {
      roeText =
        latest.roe > 15
          ? `ROE 达到 ${latest.roe.toFixed(2)}%，盈利能力优秀。`
          : latest.roe > 10
            ? `ROE 为 ${latest.roe.toFixed(2)}%，盈利能力尚可。`
            : `ROE 仅 ${latest.roe.toFixed(2)}%，盈利能力偏弱。`;
    }
  }

  // 毛利率定性
  let marginText = "";
  if (latest.grossMargin != null) {
    marginText =
      latest.grossMargin > 50
        ? `毛利率高达 ${latest.grossMargin.toFixed(2)}%，议价能力强。`
        : latest.grossMargin > 30
          ? `毛利率为 ${latest.grossMargin.toFixed(2)}%，处于行业中等水平。`
          : `毛利率仅 ${latest.grossMargin.toFixed(2)}%，竞争激烈。`;
  }

  return `## 近三年财务趋势分析

**真实财务数据（单位：亿元）**

| 年份 | 营业总收入 | 营收增速 | 净利润 | 净利润增速 | ROE | 毛利率 |
|------|-----------|---------|--------|-----------|-----|--------|
${rows}

**趋势判断：${trendLabel}**

${
  latest.revenueGrowth > 20
    ? `公司营收保持高速增长（${latest.revenueGrowth.toFixed(2)}%），成长性突出。`
    : latest.revenueGrowth > 10
      ? `公司营收保持稳健增长（${latest.revenueGrowth.toFixed(2)}%），经营态势良好。`
      : latest.revenueGrowth > 0
        ? `公司营收增速放缓（${latest.revenueGrowth.toFixed(2)}%），需关注增长动能。`
        : `公司营收出现下滑（${latest.revenueGrowth.toFixed(2)}%），需警惕经营风险。`
}${trajectoryText}${divergenceText}

${roeText}
${marginText}

> 数据来源：东方财富业绩报表（akshare）
`;
}

/**
 * 线性回归（最小二乘法）
 */
function linearRegression(
  xs: number[],
  ys: number[]
): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((sum, x, i) => sum + x * ys[i], 0);
  const sumXX = xs.reduce((sum, x) => sum + x * x, 0);
  const sumYY = ys.reduce((sum, y) => sum + y * y, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R²
  const ssTot = sumYY - sumY * sumY / n;
  const ssRes =
    sumYY -
    intercept * sumY -
    slope * sumXY;
  const r2 = ssTot !== 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

/**
 * 计算同行 PB/ROE 对比分析文本（数据驱动）
 */
export function generatePeerComparisonAnalysis(
  peerComparison: PeerComparison,
  currentPB: number,
  currentROE: number
): string {
  const { industry, peers } = peerComparison;
  if (!peers || peers.length === 0) {
    return "暂无同行对比数据。";
  }

  const rows = peers
    .map(
      (p) =>
        `| ${p.name} | ${p.pe > 0 ? p.pe.toFixed(2) : "—"} | ${p.pb > 0 ? p.pb.toFixed(2) : "—"} | ${p.roe != null && !isNaN(p.roe) ? p.roe.toFixed(2) + "%" : "—"} | ${(p.marketCap / 1e8).toFixed(2)} |`
    )
    .join("\n");

  // 简单算术平均
  const peList = peers.filter((p) => p.pe > 0).map((p) => p.pe);
  const pbList = peers.filter((p) => p.pb > 0).map((p) => p.pb);
  const roeList = peers
    .filter((p) => p.roe != null && !isNaN(p.roe))
    .map((p) => p.roe!);

  const avgPE = peList.length > 0 ? peList.reduce((sum, v) => sum + v, 0) / peList.length : 0;
  const avgPB = pbList.length > 0 ? pbList.reduce((sum, v) => sum + v, 0) / pbList.length : 0;
  const avgROE = roeList.length > 0 ? roeList.reduce((sum, v) => sum + v, 0) / roeList.length : 0;

  // 市值加权平均
  function weightedAvg(values: number[], weights: number[]): number {
    let sum = 0,
      weightSum = 0;
    for (let i = 0; i < values.length; i++) {
      if (!isNaN(values[i]) && values[i] != null && weights[i] > 0) {
        sum += values[i] * weights[i];
        weightSum += weights[i];
      }
    }
    return weightSum > 0 ? sum / weightSum : 0;
  }

  const pbPeersWithCap = peers.filter((p) => p.pb > 0);
  const weightedPB =
    pbPeersWithCap.length > 0
      ? weightedAvg(
          pbPeersWithCap.map((p) => p.pb),
          pbPeersWithCap.map((p) => p.marketCap)
        )
      : 0;

  const pePeersWithCap = peers.filter((p) => p.pe > 0);
  const weightedPE =
    pePeersWithCap.length > 0
      ? weightedAvg(
          pePeersWithCap.map((p) => p.pe),
          pePeersWithCap.map((p) => p.marketCap)
        )
      : 0;

  const roePeersWithCap = peers.filter((p) => p.roe != null && !isNaN(p.roe));
  const weightedROE =
    roePeersWithCap.length > 0
      ? weightedAvg(
          roePeersWithCap.map((p) => p.roe!),
          roePeersWithCap.map((p) => p.marketCap)
        )
      : 0;

  // PB-ROE 回归分析
  let regressionText = "";
  if (roeList.length >= 5) {
    const xs = roeList;
    const ys = peers
      .filter((p) => p.roe != null && !isNaN(p.roe) && p.pb > 0)
      .map((p) => p.pb);
    if (xs.length === ys.length && xs.length >= 5) {
      const { slope, intercept, r2 } = linearRegression(xs, ys);
      const expectedPB = slope * currentROE + intercept;
      const premium =
        expectedPB > 0 ? ((currentPB - expectedPB) / expectedPB) * 100 : 0;

      regressionText = `\n\n**PB-ROE 回归分析：**\n基于同行业 ${xs.length} 家公司的 PB-ROE 关系（R²=${r2.toFixed(2)}），当前 ROE（${currentROE.toFixed(2)}%）对应的预期 PB 约为 ${expectedPB.toFixed(2)}。`;

      if (Math.abs(premium) > 20) {
        regressionText +=
          premium > 0
            ? ` 当前 PB（${currentPB.toFixed(2)}）较预期溢价 ${premium.toFixed(1)}%，估值偏高。`
            : ` 当前 PB（${currentPB.toFixed(2)}）较预期折价 ${Math.abs(premium).toFixed(1)}%，估值偏低。`;
      } else {
        regressionText += ` 当前 PB（${currentPB.toFixed(2)}）与预期接近，估值合理。`;
      }
    }
  }

  // 分位数
  const pbPercentile = calculatePercentile(currentPB, pbList);
  const roePercentile = calculatePercentile(currentROE, roeList);

  // 综合结论
  let conclusion = "";
  if (pbPercentile < 30 && roePercentile > 70) {
    conclusion =
      "当前公司 PB 处于行业低位但 ROE 处于行业高位，存在显著的估值修复空间，相对低估。";
  } else if (pbPercentile > 70 && roePercentile < 30) {
    conclusion =
      "当前公司 PB 处于行业高位但 ROE 处于行业低位，估值偏高，需警惕基本面与估值的背离。";
  } else if (pbPercentile < 50 && roePercentile > 50) {
    conclusion =
      "当前公司 PB 低于行业中位数但 ROE 高于中位数，具备一定安全边际。";
  } else if (pbPercentile > 50 && roePercentile < 50) {
    conclusion =
      "当前公司 PB 高于行业中位数但 ROE 低于中位数，估值相对盈利能力有所透支。";
  } else if (
    Math.abs(pbPercentile - 50) < 15 &&
    Math.abs(roePercentile - 50) < 15
  ) {
    conclusion =
      "当前公司 PB 与 ROE 均处于行业中游水平，估值与盈利能力匹配度良好。";
  } else {
    conclusion =
      "当前公司 PB 与 ROE 的行业相对位置较为接近，估值与盈利能力匹配度一般，需结合其他因素综合判断。";
  }

  return `## 市净率与净资产收益率同行对比

**所属行业：${industry}**

| 公司 | PE（动态） | PB | ROE | 总市值（亿元） |
|------|-----------|-----|-----|--------------|
${rows}
| **行业简单平均** | ${avgPE > 0 ? avgPE.toFixed(2) : "—"} | ${avgPB > 0 ? avgPB.toFixed(2) : "—"} | ${avgROE > 0 ? avgROE.toFixed(2) + "%" : "—"} | — |
| **行业市值加权** | ${weightedPE > 0 ? weightedPE.toFixed(2) : "—"} | ${weightedPB > 0 ? weightedPB.toFixed(2) : "—"} | ${weightedROE > 0 ? weightedROE.toFixed(2) + "%" : "—"} | — |

**当前公司行业分位：**
- PB 分位：**${pbPercentile.toFixed(1)}%**（当前 ${currentPB.toFixed(2)} vs 行业中位数 ${avgPB.toFixed(2)}）
- ROE 分位：**${roePercentile.toFixed(1)}%**（当前 ${currentROE.toFixed(2)}% vs 行业中位数 ${avgROE.toFixed(2)}%）

**综合结论：**
${conclusion}${regressionText}

> 数据来源：同花顺行业分类 + 东方财富实时估值（akshare）
`;
}

/**
 * 计算增减持分析文本（数据驱动）
 */
export function generateInsiderTradingAnalysis(
  insider: InsiderTrading
): string {
  const { managementTrades, mgmtNetBuyAmount, mgmtNetBuyCount, majorHolders } =
    insider;

  // 高管交易按金额排序，取前10笔大额交易
  const sortedTrades = [...managementTrades].sort(
    (a, b) => Math.abs(b.changeAmount) - Math.abs(a.changeAmount)
  );
  const significantTrades = sortedTrades.slice(0, 10);

  // 核心高管识别
  const isCore = (pos: string) =>
    /董事长|总经理|总裁|财务总监|CFO|首席执行官|CEO/i.test(pos);

  // 时间窗口分段统计
  const now = new Date();
  const threeMonthsAgo = new Date(
    now.getFullYear(),
    now.getMonth() - 3,
    now.getDate()
  );
  const sixMonthsAgo = new Date(
    now.getFullYear(),
    now.getMonth() - 6,
    now.getDate()
  );

  function calcWindowStats(trades: typeof managementTrades) {
    const filtered = trades.filter((t) => new Date(t.date) >= threeMonthsAgo);
    const buyAmount = filtered
      .filter((t) => t.direction === "增持")
      .reduce((s, t) => s + t.changeAmount, 0);
    const sellAmount = filtered
      .filter((t) => t.direction === "减持")
      .reduce((s, t) => s + t.changeAmount, 0);
    const buyCount = filtered.filter((t) => t.direction === "增持").length;
    const sellCount = filtered.filter((t) => t.direction === "减持").length;
    return {
      netAmount: buyAmount - sellAmount,
      buyCount,
      sellCount,
    };
  }

  function calcWindowStats6m(trades: typeof managementTrades) {
    const filtered = trades.filter((t) => new Date(t.date) >= sixMonthsAgo);
    const buyAmount = filtered
      .filter((t) => t.direction === "增持")
      .reduce((s, t) => s + t.changeAmount, 0);
    const sellAmount = filtered
      .filter((t) => t.direction === "减持")
      .reduce((s, t) => s + t.changeAmount, 0);
    const buyCount = filtered.filter((t) => t.direction === "增持").length;
    const sellCount = filtered.filter((t) => t.direction === "减持").length;
    return {
      netAmount: buyAmount - sellAmount,
      buyCount,
      sellCount,
    };
  }

  const w3 = calcWindowStats(managementTrades);
  const w6 = calcWindowStats6m(managementTrades);

  // 核心高管交易
  const coreTrades = significantTrades.filter((t) => isCore(t.position));
  const coreBuyAmount = coreTrades
    .filter((t) => t.direction === "增持")
    .reduce((s, t) => s + t.changeAmount, 0);
  const coreSellAmount = coreTrades
    .filter((t) => t.direction === "减持")
    .reduce((s, t) => s + t.changeAmount, 0);

  const mgmtText =
    significantTrades.length > 0
      ? significantTrades
          .map(
            (t) =>
              `| ${t.name} | ${t.position}${isCore(t.position) ? " ⭐" : ""} | ${t.date} | ${t.direction} | ${t.changeShares.toFixed(0)}股 | ¥${t.changeAmount.toFixed(2)} |`
          )
          .join("\n")
      : "近一年无高管增减持记录。";

  // 大股东：按变动比例加权分析
  let holderWeightedText = "";
  if (majorHolders.length > 0) {
    const validHolders = majorHolders.filter(
      (h) => h.changeRatio != null && !isNaN(h.changeRatio)
    );
    const weightedNetChange = validHolders.reduce(
      (sum, h) => sum + h.changeRatio!,
      0
    );

    const increaseCount = majorHolders.filter(
      (h) => h.changeDirection === "增持" || h.changeDirection === "新进"
    ).length;
    const decreaseCount = majorHolders.filter(
      (h) => h.changeDirection === "减持"
    ).length;

    holderWeightedText = `\n\n**大股东持股变动加权分析：** 前五大股东中 ${increaseCount} 家增持/新进，${decreaseCount} 家减持。`;
    if (validHolders.length > 0) {
      const netDirection = weightedNetChange > 0 ? "净流入" : "净流出";
      holderWeightedText += ` 按持股比例变动加权计算，机构资金整体呈${netDirection}态势（加权净变动：${weightedNetChange > 0 ? "+" : ""}${weightedNetChange.toFixed(2)}%）。`;
    }
  }

  const holderText =
    majorHolders.length > 0
      ? majorHolders
          .slice(0, 5)
          .map((h) => {
            let changeStr = h.changeDirection;
            if (
              h.changeRatio !== undefined &&
              h.changeRatio !== null &&
              !isNaN(h.changeRatio)
            ) {
              const arrow =
                h.changeRatio > 0 ? "📈" : h.changeRatio < 0 ? "📉" : "➡️";
              changeStr += ` ${arrow} ${Math.abs(h.changeRatio).toFixed(2)}%`;
            }
            return `| ${h.name} | ${h.holderType} | ${(h.shares / 1e4).toFixed(2)}万股 | ${changeStr} |`;
          })
          .join("\n")
      : "暂无大股东持股变动数据。";

  const netBuyStr =
    mgmtNetBuyAmount > 0
      ? `净买入 ¥${mgmtNetBuyAmount.toFixed(2)}（${mgmtNetBuyCount}人次）`
      : mgmtNetBuyAmount < 0
        ? `净卖出 ¥${Math.abs(mgmtNetBuyAmount).toFixed(2)}（${Math.abs(mgmtNetBuyCount)}人次）`
        : "无净买卖";

  // 时间窗口趋势
  let windowTrendText = "";
  if (managementTrades.length > 0) {
    const w3Str =
      w3.netAmount > 0
        ? `净买入 ¥${w3.netAmount.toFixed(2)}`
        : w3.netAmount < 0
          ? `净卖出 ¥${Math.abs(w3.netAmount).toFixed(2)}`
          : "无净买卖";
    const w6Str =
      w6.netAmount > 0
        ? `净买入 ¥${w6.netAmount.toFixed(2)}`
        : w6.netAmount < 0
          ? `净卖出 ¥${Math.abs(w6.netAmount).toFixed(2)}`
          : "无净买卖";
    windowTrendText = `\n\n**时间维度分析：**\n- 近 3 个月：${w3Str}（增持 ${w3.buyCount} 人次，减持 ${w3.sellCount} 人次）\n- 近 6 个月：${w6Str}（增持 ${w6.buyCount} 人次，减持 ${w6.sellCount} 人次）`;

    if (w3.netAmount > 0 && w6.netAmount < 0) {
      windowTrendText += `\n- 趋势判断：近期（3个月内）由净卖出转为净买入，信号转积极。`;
    } else if (w3.netAmount < 0 && w6.netAmount > 0) {
      windowTrendText += `\n- 趋势判断：近期（3个月内）由净买入转为净卖出，信号转谨慎。`;
    }
  }

  // 核心高管信号
  let coreSignalText = "";
  if (coreTrades.length > 0) {
    const coreNet = coreBuyAmount - coreSellAmount;
    coreSignalText = `\n\n**核心高管动向（董事长/总经理/财务总监等）：** ${coreNet > 0 ? "整体净买入" : "整体净卖出"} ¥${Math.abs(coreNet).toFixed(2)}。核心高管${coreNet > 0 ? "增持" : "减持"}行为通常具有更强的信号意义。`;
  }

  return `## 大股东与高管增减持分析

### 高管增减持（近一年）

**汇总：${netBuyStr}**${windowTrendText}${coreSignalText}

${significantTrades.length > 0 ? `| 变动人 | 职务 | 日期 | 方向 | 股数 | 金额 |
|--------|------|------|------|------|------|
${mgmtText}` : mgmtText}

### 大股东持股变动（最新报告期）

${majorHolders.length > 0 ? `| 股东名称 | 类型 | 持股 | 变动 |
|---------|------|------|------|
${holderText}` : holderText}
${holderWeightedText}

${
  mgmtNetBuyAmount > 0
    ? "高管整体呈净买入态势，释放积极信号。"
    : mgmtNetBuyAmount < 0
      ? "高管整体呈净卖出态势，需关注是否有特殊原因（如个人资金需求）。"
      : "高管增减持行为较为平衡。"
}

> 数据来源：东方财富高管持股变动 + 流通股东明细（akshare）
`;
}
