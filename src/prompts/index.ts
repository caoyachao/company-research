import type { DataContext } from "../data/types.js";

function buildContextBlock(ctx: DataContext): string {
  if (!ctx.summaries || ctx.summaries.length === 0) return "";
  return (
    "\n\n【前文分析摘要】\n" +
    ctx.summaries.map((s, i) => `${i + 1}. ${s}`).join("\n") +
    "\n"
  );
}

// ========== 第一步：了解公司 ==========

export function prompt1_BusinessModel(ctx: DataContext): string {
  return `请分析股票 ${ctx.stockCode}（${ctx.realtime.name}）。${buildContextBlock(ctx)}

当前股价：¥${ctx.realtime.price.toFixed(2)}，市盈率：${ctx.valuation.pe.toFixed(2)}，市净率：${ctx.valuation.pb.toFixed(2)}，总市值：${(ctx.valuation.marketCap / 1e8).toFixed(2)}亿元。

请用一句话概括这家公司的核心商业模式，并列出它最主要的收入来源是什么。`;
}

export function prompt2_Competitors(ctx: DataContext): string {
  return `请分析股票 ${ctx.stockCode}（${ctx.realtime.name}）。${buildContextBlock(ctx)}

当前股价：¥${ctx.realtime.price.toFixed(2)}，市盈率：${ctx.valuation.pe.toFixed(2)}，总市值：${(ctx.valuation.marketCap / 1e8).toFixed(2)}亿元。

请列出这家公司在行业中的前三大竞争对手，并说明每家公司的核心优势分别是什么。`;
}

export function prompt3_FinancialTrend(ctx: DataContext): string {
  let dataBlock = "";
  if (ctx.financials && ctx.financials.length > 0) {
    const rows = ctx.financials
      .map(
        (f) =>
          `| ${f.year} | ${f.revenue.toFixed(2)} | ${f.revenueGrowth > 0 ? "+" : ""}${f.revenueGrowth.toFixed(2)}% | ${f.netProfit.toFixed(2)} | ${f.profitGrowth > 0 ? "+" : ""}${f.profitGrowth.toFixed(2)}% | ${f.roe.toFixed(2)}% | ${f.grossMargin.toFixed(2)}% |`
      )
      .join("\n");
    dataBlock = `

【真实财务数据（来源：东方财富业绩报表）】
| 年份 | 营业总收入（亿元） | 营收增速 | 净利润（亿元） | 净利润增速 | ROE | 毛利率 |
|------|------------------|---------|--------------|-----------|-----|--------|
${rows}
`;
  }

  return `请分析股票 ${ctx.stockCode}（${ctx.realtime.name}）的财务趋势。${buildContextBlock(ctx)}

【当前估值数据】
- 当前股价：¥${ctx.realtime.price.toFixed(2)}
- 市盈率：${ctx.valuation.pe.toFixed(2)}
- 市净率：${ctx.valuation.pb.toFixed(2)}
- 总市值：${(ctx.valuation.marketCap / 1e8).toFixed(2)}亿元
${dataBlock}

请分析这家公司近三年的营收和净利润变化趋势。如果上面提供了真实财务数据，请基于真实数据分析；如果没有数据，请基于你掌握的信息分析。`;
}

// ========== 第二步：估值分析 ==========

export function prompt4_PERatio(ctx: DataContext): string {
  return `请分析股票 ${ctx.stockCode}（${ctx.realtime.name}）的估值水平。${buildContextBlock(ctx)}

【当前估值数据】
- 当前股价：¥${ctx.realtime.price.toFixed(2)}
- 市盈率（PE）：${ctx.valuation.pe.toFixed(2)}
- 市净率（PB）：${ctx.valuation.pb.toFixed(2)}
- 总市值：${(ctx.valuation.marketCap / 1e8).toFixed(2)}亿元

请用历史百分位法计算这只股票当前市盈率在过去五年中的位置，并告诉我它处于高估区、低估区还是合理。

注意：当前PE=${ctx.valuation.pe.toFixed(2)} 是实时数据，请基于此进行分析。`;
}

export function prompt5_PBR_ROE(ctx: DataContext): string {
  let dataBlock = "";
  if (ctx.peerComparison) {
    const { industry, peers } = ctx.peerComparison;
    const rows = peers
      .map(
        (p) =>
          `| ${p.name} | ${p.pe > 0 ? p.pe.toFixed(2) : "—"} | ${p.pb > 0 ? p.pb.toFixed(2) : "—"} | ${p.roe > 0 ? p.roe.toFixed(2) + "%" : "—"} |`
      )
      .join("\n");
    dataBlock = `

【真实同行对比数据（来源：同花顺行业分类 + 东方财富实时估值）】
所属行业：${industry}

| 公司 | PE（动态） | PB | ROE |
|------|-----------|-----|-----|
${rows}
`;
  }

  return `请分析股票 ${ctx.stockCode}（${ctx.realtime.name}）的估值对比。${buildContextBlock(ctx)}

【当前估值数据】
- 当前股价：¥${ctx.realtime.price.toFixed(2)}
- 市净率（PB）：${ctx.valuation.pb.toFixed(2)}
- 市盈率（PE）：${ctx.valuation.pe.toFixed(2)}
${dataBlock}

请将这只股票的市净率和净资产收益率与同行业公司进行对比，并给出简单的结论。如果上面提供了真实同行数据，请基于真实数据对比；如果没有数据，请基于你掌握的信息分析。`;
}

// ========== 第三步：风险排查 ==========

export function prompt7_FinancialRisks(ctx: DataContext): string {
  return `请分析股票 ${ctx.stockCode}（${ctx.realtime.name}）的财务风险。${buildContextBlock(ctx)}

【当前估值数据】
- 当前股价：¥${ctx.realtime.price.toFixed(2)}
- 市盈率：${ctx.valuation.pe.toFixed(2)}
- 市净率：${ctx.valuation.pb.toFixed(2)}
- 总市值：${(ctx.valuation.marketCap / 1e8).toFixed(2)}亿元

请列出这只股票在财务报表中最容易被粉饰的三个科目，并解释为什么这些科目容易出问题。`;
}

export function prompt8_CustomerSupplierRisk(ctx: DataContext): string {
  return `请分析股票 ${ctx.stockCode}（${ctx.realtime.name}）。${buildContextBlock(ctx)}

【当前估值数据】
- 当前股价：¥${ctx.realtime.price.toFixed(2)}
- 总市值：${(ctx.valuation.marketCap / 1e8).toFixed(2)}亿元

请分析这家公司是否存在单一客户依赖或单一供应商依赖，如果有的话分别占比是多少。`;
}

export function prompt9_InsiderTrading(ctx: DataContext): string {
  let dataBlock = "";
  if (ctx.insiderTrading) {
    const { mgmtNetBuyAmount, mgmtNetBuyCount, managementTrades } = ctx.insiderTrading;
    const netBuyStr =
      mgmtNetBuyAmount > 0
        ? `净买入 ¥${mgmtNetBuyAmount.toFixed(2)}（${mgmtNetBuyCount}人次）`
        : mgmtNetBuyAmount < 0
          ? `净卖出 ¥${Math.abs(mgmtNetBuyAmount).toFixed(2)}（${Math.abs(mgmtNetBuyCount)}人次）`
          : "无净买卖";
    const trades = managementTrades
      .slice(0, 5)
      .map(
        (t) =>
          `- ${t.name}（${t.position}）${t.date} ${t.direction} ${t.changeShares.toFixed(0)}股`
      )
      .join("\n");
    dataBlock = `

【真实增减持数据（来源：东方财富高管持股变动）】
高管增减持汇总（近一年）：${netBuyStr}
${trades ? "\n主要交易记录：\n" + trades : ""}
`;
  }

  return `请分析股票 ${ctx.stockCode}（${ctx.realtime.name}）。${buildContextBlock(ctx)}

【当前估值数据】
- 当前股价：¥${ctx.realtime.price.toFixed(2)}
- 总市值：${(ctx.valuation.marketCap / 1e8).toFixed(2)}亿元
${dataBlock}

请分析这只股票过去一年内大股东和高管的增减持情况，并告诉我整体是净买入还是净卖出。如果上面提供了真实数据，请基于真实数据分析；如果没有数据，请基于你掌握的信息分析。`;
}

// ========== 第四步：技术面（已程序化，但保留 LLM 总结版本） ==========

export function prompt10_MovingAverage(ctx: DataContext): string {
  const { technical: t } = ctx;
  return `请基于以下真实技术指标，简要总结这只股票的技术面趋势：

【真实技术指标】
- 当前股价：¥${t.currentPrice.toFixed(2)}
- 五日线 MA5：${t.ma5.toFixed(2)}（股价位于${t.ma5Position}）
- 二十日线 MA20：${t.ma20.toFixed(2)}（股价位于${t.ma20Position}）
- 六十日线 MA60：${t.ma60.toFixed(2)}（股价位于${t.ma60Position}）
- 趋势判断：${t.trend}

请给出简洁的技术面总结。`;
}

export function prompt11_SupportResistance(ctx: DataContext): string {
  const { technical: t } = ctx;
  const sText = t.supports.map((s, i) => `支撑位 ${i + 1}：¥${s.toFixed(2)}`).join("，");
  const rText = t.resistances.map((r, i) => `压力位 ${i + 1}：¥${r.toFixed(2)}`).join("，");

  return `请基于以下真实支撑压力位数据，简要分析：

【真实支撑压力位】
- 当前股价：¥${t.currentPrice.toFixed(2)}
- ${sText || "暂无明显支撑位"}
- ${rText || "暂无明显压力位"}

请给出简洁的分析总结。`;
}

// ========== 第五步：最坏情况推演 ==========

export function prompt12_ScenarioPlanning(ctx: DataContext): string {
  const { technical: t } = ctx;
  return `请分析股票 ${ctx.stockCode}（${ctx.realtime.name}）。${buildContextBlock(ctx)}

【当前关键数据】
- 当前股价：¥${ctx.realtime.price.toFixed(2)}
- 市盈率：${ctx.valuation.pe.toFixed(2)}
- 市净率：${ctx.valuation.pb.toFixed(2)}
- 总市值：${(ctx.valuation.marketCap / 1e8).toFixed(2)}亿元
- 技术面趋势：${t.trend}
- 支撑位：${t.supports.map(s => "¥" + s.toFixed(2)).join("、") || "暂无明显支撑"}
- 压力位：${t.resistances.map(r => "¥" + r.toFixed(2)).join("、") || "暂无明显压力"}

假设我现在买入这只股票，请帮我推演未来三个月可能出现的三种不利情况，每种情况都要具体描述，并为每种情况给出一个简单的应对方案。`;
}

// ========== 第六步：综合建议 ==========

export function prompt13_FinalRecommendation(ctx: DataContext): string {
  const { technical: t } = ctx;
  return `请基于以上所有信息，给出 ${ctx.stockCode}（${ctx.realtime.name}）的操作建议。${buildContextBlock(ctx)}

【当前关键数据汇总】
- 当前股价：¥${ctx.realtime.price.toFixed(2)}
- 市盈率：${ctx.valuation.pe.toFixed(2)}
- 市净率：${ctx.valuation.pb.toFixed(2)}
- 总市值：${(ctx.valuation.marketCap / 1e8).toFixed(2)}亿元
- 技术面趋势：${t.trend}

请用不超过一百字给出这只股票当前的操作建议，包括买入、持有还是卖出，以及对应的仓位建议。`;
}

// ========== 摘要提取提示词 ==========

export function promptExtractSummary(
  stepTitle: string,
  content: string
): string {
  return `请对以下分析内容进行总结，提取 3-5 个最核心的要点（每点不超过 30 字），方便后续分析参考：

【分析主题】${stepTitle}

【分析内容】
${content}`;
}

// 所有步骤的定义
export interface AnalysisStep {
  id: number;
  title: string;
  category: string;
  promptFn: (ctx: DataContext) => string;
  skipLLM?: boolean; // 是否完全跳过LLM，使用程序化输出
  programmaticFn?: (ctx: DataContext) => string; // 程序化输出函数
}

export const ANALYSIS_STEPS: AnalysisStep[] = [
  { id: 1, title: "核心商业模式", category: "一、公司基本面", promptFn: prompt1_BusinessModel },
  { id: 2, title: "竞争对手分析", category: "一、公司基本面", promptFn: prompt2_Competitors },
  { id: 3, title: "近三年财务趋势", category: "一、公司基本面", promptFn: prompt3_FinancialTrend },
  { id: 4, title: "市盈率历史百分位", category: "二、估值分析", promptFn: prompt4_PERatio },
  { id: 5, title: "市净率与净资产收益率对比", category: "二、估值分析", promptFn: prompt5_PBR_ROE },
  { id: 6, title: "估值与成长性匹配度", category: "二、估值分析", promptFn: () => "", skipLLM: true }, // 纯程序化
  { id: 7, title: "财务报表风险科目", category: "三、风险排查", promptFn: prompt7_FinancialRisks },
  { id: 8, title: "客户与供应商依赖", category: "三、风险排查", promptFn: prompt8_CustomerSupplierRisk },
  { id: 9, title: "大股东与高管增减持", category: "三、风险排查", promptFn: prompt9_InsiderTrading },
  { id: 10, title: "均线系统分析", category: "四、技术面分析", promptFn: prompt10_MovingAverage, skipLLM: true }, // 纯程序化
  { id: 11, title: "支撑位与压力位", category: "四、技术面分析", promptFn: prompt11_SupportResistance, skipLLM: true }, // 纯程序化
  { id: 12, title: "最坏情况推演", category: "五、最坏情况推演", promptFn: prompt12_ScenarioPlanning },
  { id: 13, title: "综合操作建议", category: "六、综合操作建议", promptFn: prompt13_FinalRecommendation },
];
