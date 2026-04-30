import type { KLineData, TechnicalIndicators, ValuationMetrics, RealtimeQuote, HistoricalValuationPoint, FinancialData, PeerComparison, InsiderTrading } from "./types.js";

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

  // 趋势判断：多头排列 vs 空头排列
  let trend: "上升通道" | "下降通道" | "震荡整理" = "震荡整理";
  if (ma5 > ma20 && ma20 > ma60) {
    trend = "上升通道";
  } else if (ma5 < ma20 && ma20 < ma60) {
    trend = "下降通道";
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
    trend,
    ma5Position: currentPrice > ma5 ? "上方" : "下方",
    ma20Position: currentPrice > ma20 ? "上方" : "下方",
    ma60Position: currentPrice > ma60 ? "上方" : "下方",
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

  const peValues = historicalPEs.map((p) => p.peTtm).filter((v) => v > 0 && Number.isFinite(v));
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

  const calcPeriodPercentile = (since: Date): { percentile: number; count: number } | null => {
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

  // 寻找历史上的相似估值日期
  const similarDates = historicalPEs
    .filter((p) => Math.abs(p.peTtm - currentPE) / currentPE < 0.05)
    .slice(-3)
    .map((p) => p.date);

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
}
${similarDates.length > 0 ? `\n历史上接近当前估值的日期：${similarDates.join("、")}` : ""}

> 注：PE-TTM 为滚动市盈率，基于最近四个季度净利润计算。历史数据来源于东方财富。
`;
}

/**
 * 计算均线分析文本（纯程序化输出）
 */
export function generateMovingAverageAnalysis(tech: TechnicalIndicators): string {
  const { currentPrice, ma5, ma20, ma60, trend } = tech;

  return `| 均线 | 数值 | 股价位置 | 偏离幅度 |
|------|------|---------|---------|
| **五日线 (MA5)** | **${ma5.toFixed(2)}** | ${currentPrice > ma5 ? "📈 上方" : "📉 下方"} | ${((currentPrice - ma5) / ma5 * 100).toFixed(2)}% |
| **二十日线 (MA20)** | **${ma20.toFixed(2)}** | ${currentPrice > ma20 ? "📈 上方" : "📉 下方"} | ${((currentPrice - ma20) / ma20 * 100).toFixed(2)}% |
| **六十日线 (MA60)** | **${ma60.toFixed(2)}** | ${currentPrice > ma60 ? "📈 上方" : "📉 下方"} | ${((currentPrice - ma60) / ma60 * 100).toFixed(2)}% |

**均线排列：** MA5(${ma5.toFixed(0)}) ${ma5 > ma20 ? ">" : "<"} MA20(${ma20.toFixed(0)}) ${ma20 > ma60 ? ">" : "<"} MA60(${ma60.toFixed(0)})

**趋势判断：${trend}**

${trend === "上升通道"
      ? "当前呈多头排列，短期均线在长期均线上方，股价处于上升趋势中。"
      : trend === "下降通道"
        ? "当前呈空头排列，短期均线在长期均线下方，股价处于下降趋势中。"
        : "当前均线交织，无明显趋势方向，处于震荡整理阶段。"
    }
`;
}

/**
 * 计算支撑压力位分析文本（纯程序化输出）
 */
export function generateSupportResistanceAnalysis(tech: TechnicalIndicators): string {
  const { supports, resistances, currentPrice } = tech;

  const supportText = supports
    .map((s, i) => `- **支撑位 ${i + 1}**: ¥${s.toFixed(2)}（距当前 ${((currentPrice - s) / currentPrice * 100).toFixed(2)}%）`)
    .join("\n");

  const resistanceText = resistances
    .map((r, i) => `- **压力位 ${i + 1}**: ¥${r.toFixed(2)}（距当前 ${((r - currentPrice) / currentPrice * 100).toFixed(2)}%）`)
    .join("\n");

  return `基于近三个月 K 线走势的成交量加权高低点分析：

**支撑位（下跌可能反弹的位置）：**
${supportText || "- 近期未形成明显支撑位"}

**压力位（上涨可能受阻的位置）：**
${resistanceText || "- 近期未形成明显压力位"}

> 计算方法：识别近期局部高低点，按成交量加权筛选，成交量越大的价位支撑/压力作用越强。
`;
}

/**
 * 生成财务趋势分析文本（数据驱动）
 */
export function generateFinancialAnalysis(financials: FinancialData[]): string {
  if (!financials || financials.length === 0) {
    return "暂无财务数据。";
  }

  const rows = financials.map((f) => {
    const revGrowthStr = f.revenueGrowth > 0 ? `+${f.revenueGrowth.toFixed(2)}%` : `${f.revenueGrowth.toFixed(2)}%`;
    const profitGrowthStr = f.profitGrowth > 0 ? `+${f.profitGrowth.toFixed(2)}%` : `${f.profitGrowth.toFixed(2)}%`;
    return `| ${f.year} | ${f.revenue.toFixed(2)} | ${revGrowthStr} | ${f.netProfit.toFixed(2)} | ${profitGrowthStr} | ${f.roe.toFixed(2)}% | ${f.grossMargin.toFixed(2)}% |`;
  }).join("\n");

  const latest = financials[financials.length - 1];
  const trend =
    latest.revenueGrowth > 20
      ? "高速增长"
      : latest.revenueGrowth > 10
        ? "稳健增长"
        : latest.revenueGrowth > 0
          ? "低速增长"
          : "收入下滑";

  return `## 近三年财务趋势分析

**真实财务数据（单位：亿元）**

| 年份 | 营业总收入 | 营收增速 | 净利润 | 净利润增速 | ROE | 毛利率 |
|------|-----------|---------|--------|-----------|-----|--------|
${rows}

**趋势判断：${trend}**

${
  latest.revenueGrowth > 20
    ? `公司营收保持高速增长（${latest.revenueGrowth.toFixed(2)}%），成长性突出。`
    : latest.revenueGrowth > 10
      ? `公司营收保持稳健增长（${latest.revenueGrowth.toFixed(2)}%），经营态势良好。`
      : latest.revenueGrowth > 0
        ? `公司营收增速放缓（${latest.revenueGrowth.toFixed(2)}%），需关注增长动能。`
        : `公司营收出现下滑（${latest.revenueGrowth.toFixed(2)}%），需警惕经营风险。`
}

${latest.roe > 15 ? `ROE 达到 ${latest.roe.toFixed(2)}%，盈利能力优秀。` : latest.roe > 10 ? `ROE 为 ${latest.roe.toFixed(2)}%，盈利能力尚可。` : `ROE 仅 ${latest.roe.toFixed(2)}%，盈利能力偏弱。`}
${latest.grossMargin > 50 ? `毛利率高达 ${latest.grossMargin.toFixed(2)}%，议价能力强。` : latest.grossMargin > 30 ? `毛利率为 ${latest.grossMargin.toFixed(2)}%，处于行业中等水平。` : `毛利率仅 ${latest.grossMargin.toFixed(2)}%，竞争激烈。`}

> 数据来源：东方财富业绩报表（akshare）
`;
}

/**
 * 生成同行 PB/ROE 对比分析文本（数据驱动）
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
        `| ${p.name} | ${p.pe > 0 ? p.pe.toFixed(2) : "—"} | ${p.pb > 0 ? p.pb.toFixed(2) : "—"} | ${p.roe > 0 ? p.roe.toFixed(2) + "%" : "—"} | ${(p.marketCap / 1e8).toFixed(2)} |`
    )
    .join("\n");

  const avgPE = peers.filter((p) => p.pe > 0).reduce((sum, p) => sum + p.pe, 0) / peers.filter((p) => p.pe > 0).length || 0;
  const avgPB = peers.filter((p) => p.pb > 0).reduce((sum, p) => sum + p.pb, 0) / peers.filter((p) => p.pb > 0).length || 0;
  const avgROE = peers.filter((p) => p.roe > 0).reduce((sum, p) => sum + p.roe, 0) / peers.filter((p) => p.roe > 0).length || 0;

  const pbVsAvg = currentPB > avgPB * 1.2 ? "高于" : currentPB < avgPB * 0.8 ? "低于" : "接近";
  const roeVsAvg = currentROE > avgROE * 1.2 ? "高于" : currentROE < avgROE * 0.8 ? "低于" : "接近";

  return `## 市净率与净资产收益率同行对比

**所属行业：${industry}**

| 公司 | PE（动态） | PB | ROE | 总市值（亿元） |
|------|-----------|-----|-----|--------------|
${rows}
| **行业平均** | ${avgPE > 0 ? avgPE.toFixed(2) : "—"} | ${avgPB > 0 ? avgPB.toFixed(2) : "—"} | ${avgROE > 0 ? avgROE.toFixed(2) + "%" : "—"} | — |

**当前公司对比结论：**
- PB ${pbVsAvg}行业平均（当前 ${currentPB.toFixed(2)} vs 行业 ${avgPB.toFixed(2)}）
- ROE ${roeVsAvg}行业平均（当前 ${currentROE.toFixed(2)}% vs 行业 ${avgROE.toFixed(2)}%）

${
  pbVsAvg === "低于" && roeVsAvg === "高于"
    ? "当前公司PB低于同行但ROE高于同行，存在估值修复空间，相对低估。"
    : pbVsAvg === "高于" && roeVsAvg === "低于"
      ? "当前公司PB高于同行但ROE低于同行，估值偏高，需警惕。"
      : pbVsAvg === "接近" && roeVsAvg === "接近"
        ? "当前公司估值水平与同行接近，处于合理区间。"
        : "当前公司估值与盈利能力匹配度一般，需结合其他因素综合判断。"
}

> 数据来源：同花顺行业分类 + 东方财富实时估值（akshare）
`;
}

/**
 * 生成增减持分析文本（数据驱动）
 */
export function generateInsiderTradingAnalysis(insider: InsiderTrading): string {
  const { managementTrades, mgmtNetBuyAmount, mgmtNetBuyCount, majorHolders } = insider;

  const mgmtText = managementTrades.length > 0
    ? managementTrades
        .slice(0, 10)
        .map(
          (t) =>
            `| ${t.name} | ${t.position} | ${t.date} | ${t.direction} | ${t.changeShares.toFixed(0)}股 | ¥${t.changeAmount.toFixed(2)} |`
        )
        .join("\n")
    : "近一年无高管增减持记录。";

  const holderText = majorHolders.length > 0
    ? majorHolders
        .slice(0, 5)
        .map(
          (h) =>
            `| ${h.name} | ${h.holderType} | ${(h.shares / 1e4).toFixed(2)}万股 | ${h.changeDirection} |`
        )
        .join("\n")
    : "暂无大股东持股变动数据。";

  const netBuyStr = mgmtNetBuyAmount > 0
    ? `净买入 ¥${mgmtNetBuyAmount.toFixed(2)}（${mgmtNetBuyCount}人次）`
    : mgmtNetBuyAmount < 0
      ? `净卖出 ¥${Math.abs(mgmtNetBuyAmount).toFixed(2)}（${Math.abs(mgmtNetBuyCount)}人次）`
      : "无净买卖";

  return `## 大股东与高管增减持分析

### 高管增减持（近一年）

**汇总：${netBuyStr}**

${managementTrades.length > 0 ? `| 变动人 | 职务 | 日期 | 方向 | 股数 | 金额 |
|--------|------|------|------|------|------|
${mgmtText}` : mgmtText}

### 大股东持股变动（最新报告期）

${majorHolders.length > 0 ? `| 股东名称 | 类型 | 持股 | 变动 |
|---------|------|------|------|
${holderText}` : holderText}

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
