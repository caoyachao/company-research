import { callLLM } from "./ai/gateway.js";
import {
  ANALYSIS_STEPS,
  promptExtractSummary,
  type AnalysisStep,
} from "./prompts/index.js";
import { type DataContext, type FinancialData } from "./data/types.js";
import { type StepResult } from "./report.js";
import { fetchStockData, resolveStockCode, fetchFinancialRiskMetrics, fetchMainBusinessComposition } from "./data/eastmoney.js";
import {
  fetchHistoricalValuation,
  fetchFinancialData,
  fetchPeerComparison,
  fetchInsiderTrading,
} from "./data/akshare.js";
import {
  calculateTechnicalIndicators,
  calculateValuation,
  calculatePEPercentile,
  generateMovingAverageAnalysis,
  generateSupportResistanceAnalysis,
  generatePEPercentileAnalysis,
  generateFinancialAnalysis,
  generatePeerComparisonAnalysis,
  generateInsiderTradingAnalysis,
} from "./data/calculators.js";

export type AnalysisEventType =
  | "phase_start"
  | "phase_end"
  | "step_start"
  | "step_complete"
  | "step_error"
  | "debug_log"
  | "data_fetched"
  | "llm_call_start"
  | "llm_call_end"
  | "summary_extract"
  | "complete"
  | "error";

export interface AnalysisEvent {
  type: AnalysisEventType;
  timestamp: number;
  stepId?: number;
  stepTitle?: string;
  message?: string;
  detail?: string;
  category?: string;
  durationMs?: number;
  error?: string;
  level?: "info" | "warn" | "error" | "debug";
}

export interface AnalyzerOptions {
  stockCode: string;
  useContext?: boolean;
  timeout?: number;
  onProgress?: (step: number, total: number, title: string) => void;
  onEvent?: (event: AnalysisEvent) => void;
}

/**
 * 纯程序化生成第6步：估值与成长性匹配度
 */
function generateValuationMatchAnalysis(ctx: DataContext): string {
  const { pe, pb, marketCap } = ctx.valuation;
  const { financials, peerComparison } = ctx;

  // 提取最新财务数据
  let latestFinancial: FinancialData | null = null;
  if (financials && financials.length > 0) {
    latestFinancial = [...financials].sort((a, b) => a.year - b.year)[financials.length - 1];
  }

  // ===== 方案一：PEG 分析（有增速数据且盈利）=====
  if (pe > 0 && latestFinancial && latestFinancial.profitGrowth != null && latestFinancial.profitGrowth > 0) {
    const peg = pe / latestFinancial.profitGrowth;

    let pegConclusion = "";
    let pegReason = "";
    if (peg < 0.5) {
      pegConclusion = "显著低估";
      pegReason = `当前 PEG = ${peg.toFixed(2)}（PE ${pe.toFixed(2)} ÷ 净利润增速 ${latestFinancial.profitGrowth.toFixed(2)}%），低于 0.5，估值水平显著低于成长性支撑。`;
    } else if (peg < 1.0) {
      pegConclusion = "低估";
      pegReason = `当前 PEG = ${peg.toFixed(2)}（PE ${pe.toFixed(2)} ÷ 净利润增速 ${latestFinancial.profitGrowth.toFixed(2)}%），处于 0.5-1.0 区间，估值略低于成长性支撑，具备一定安全边际。`;
    } else if (peg < 1.5) {
      pegConclusion = "合理匹配";
      pegReason = `当前 PEG = ${peg.toFixed(2)}（PE ${pe.toFixed(2)} ÷ 净利润增速 ${latestFinancial.profitGrowth.toFixed(2)}%），处于 1.0-1.5 区间，估值与成长性基本匹配。`;
    } else if (peg < 2.0) {
      pegConclusion = "偏高";
      pegReason = `当前 PEG = ${peg.toFixed(2)}（PE ${pe.toFixed(2)} ÷ 净利润增速 ${latestFinancial.profitGrowth.toFixed(2)}%），处于 1.5-2.0 区间，估值略高于成长性支撑。`;
    } else {
      pegConclusion = "显著高估";
      pegReason = `当前 PEG = ${peg.toFixed(2)}（PE ${pe.toFixed(2)} ÷ 净利润增速 ${latestFinancial.profitGrowth.toFixed(2)}%），高于 2.0，估值水平远高于成长性支撑，存在高估风险。`;
    }

    return `## 估值与成长性匹配度分析

**当前估值与成长性：**
- 市盈率（PE）：${pe.toFixed(2)}
- 市净率（PB）：${pb.toFixed(2)}
- 最新净利润增速：${latestFinancial.profitGrowth.toFixed(2)}%（${latestFinancial.year}年）
- 最新营收增速：${latestFinancial.revenueGrowth.toFixed(2)}%（${latestFinancial.year}年）

**核心指标：PEG = ${peg.toFixed(2)}**

**匹配度判断：${pegConclusion}**

**分析依据：**
${pegReason}

**参考标准（PEG 法）：**
| PEG 区间 | 估值判断 | 含义 |
|---------|---------|------|
| < 0.5 | 显著低估 | 估值远低于成长性支撑 |
| 0.5-1.0 | 低估 | 估值低于成长性支撑 |
| 1.0-1.5 | 合理匹配 | 估值与成长性基本匹配 |
| 1.5-2.0 | 偏高 | 估值略高于成长性支撑 |
| > 2.0 | 显著高估 | 估值远高于成长性支撑 |

> 注：PEG = PE / 净利润增速。增速数据来源于最新财报。
`;
  }

  // ===== 方案二：PB-ROE 分析（无增速或亏损，但有 ROE 和同行数据）=====
  const currentROE = latestFinancial?.roe ?? 0;
  const roePeers = peerComparison?.peers
    .filter((p) => p.roe != null && !isNaN(p.roe) && p.pb > 0)
    .map((p) => ({ roe: p.roe!, pb: p.pb })) || [];

  if (currentROE > 0 && roePeers.length >= 3) {
    const xs = roePeers.map((p) => p.roe);
    const ys = roePeers.map((p) => p.pb);
    const n = xs.length;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((sum, x, i) => sum + x * ys[i], 0);
    const sumXX = xs.reduce((sum, x) => sum + x * x, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const expectedPB = slope * currentROE + intercept;
    const premium = expectedPB > 0 ? ((pb - expectedPB) / expectedPB) * 100 : 0;

    let pbRoeConclusion = "";
    let pbRoeReason = "";
    if (premium < -30) {
      pbRoeConclusion = "显著低估";
      pbRoeReason = `当前 PB（${pb.toFixed(2)}）较行业 PB-ROE 回归预期（${expectedPB.toFixed(2)}）折价 ${Math.abs(premium).toFixed(1)}%，估值显著低于 ROE 所支撑的水平。`;
    } else if (premium < -15) {
      pbRoeConclusion = "低估";
      pbRoeReason = `当前 PB（${pb.toFixed(2)}）较行业 PB-ROE 回归预期（${expectedPB.toFixed(2)}）折价 ${Math.abs(premium).toFixed(1)}%，估值略低于 ROE 所支撑的水平。`;
    } else if (premium < 15) {
      pbRoeConclusion = "合理匹配";
      pbRoeReason = `当前 PB（${pb.toFixed(2)}）与行业 PB-ROE 回归预期（${expectedPB.toFixed(2)}）接近，估值与 ROE 水平基本匹配。`;
    } else if (premium < 30) {
      pbRoeConclusion = "偏高";
      pbRoeReason = `当前 PB（${pb.toFixed(2)}）较行业 PB-ROE 回归预期（${expectedPB.toFixed(2)}）溢价 ${premium.toFixed(1)}%，估值略高于 ROE 所支撑的水平。`;
    } else {
      pbRoeConclusion = "显著高估";
      pbRoeReason = `当前 PB（${pb.toFixed(2)}）较行业 PB-ROE 回归预期（${expectedPB.toFixed(2)}）溢价 ${premium.toFixed(1)}%，估值显著高于 ROE 所支撑的水平。`;
    }

    return `## 估值与成长性匹配度分析

**当前估值与盈利能力：**
- 市盈率（PE）：${pe > 0 ? pe.toFixed(2) : "亏损（PE 失效）"}
- 市净率（PB）：${pb.toFixed(2)}
- 净资产收益率（ROE）：${currentROE.toFixed(2)}%

**匹配度判断：${pbRoeConclusion}**

**分析依据：**
${pbRoeReason}

**参考标准（PB-ROE 回归法）：**
基于同行业 ${n} 家公司的 PB-ROE 关系，当前 ROE（${currentROE.toFixed(2)}%）对应的预期 PB 约为 ${expectedPB.toFixed(2)}。

> 注：由于公司${pe <= 0 ? "处于亏损状态，PE 指标失效" : "净利润增速数据不足"}，改用 PB-ROE 框架分析。ROE 数据来源于最新财报。
`;
  }

  // ===== 方案三：PS 分析（有营收数据）=====
  if (latestFinancial && latestFinancial.revenue > 0 && marketCap > 0) {
    const ps = marketCap / latestFinancial.revenue;
    let psConclusion = "";
    let psReason = "";
    if (ps < 2) {
      psConclusion = "低估";
      psReason = `当前 PS = ${ps.toFixed(2)}（市值 ${marketCap.toFixed(2)}亿元 ÷ 营收 ${latestFinancial.revenue.toFixed(2)}亿元），处于较低水平。`;
    } else if (ps < 5) {
      psConclusion = "合理";
      psReason = `当前 PS = ${ps.toFixed(2)}，处于中等水平，估值与营收规模基本匹配。`;
    } else if (ps < 10) {
      psConclusion = "偏高";
      psReason = `当前 PS = ${ps.toFixed(2)}，处于较高水平，需关注营收增速能否支撑当前估值。`;
    } else {
      psConclusion = "显著高估";
      psReason = `当前 PS = ${ps.toFixed(2)}，处于高位，估值水平远高于营收规模支撑。`;
    }

    return `## 估值与成长性匹配度分析

**当前估值与营收规模：**
- 市盈率（PE）：${pe > 0 ? pe.toFixed(2) : "亏损（PE 失效）"}
- 市净率（PB）：${pb.toFixed(2)}
- 市销率（PS）：${ps.toFixed(2)}
- 最新营收：${latestFinancial.revenue.toFixed(2)}亿元（${latestFinancial.year}年）
- 最新营收增速：${latestFinancial.revenueGrowth.toFixed(2)}%

**匹配度判断：${psConclusion}**

**分析依据：**
${psReason}

> 注：由于${pe <= 0 ? "公司处于亏损状态" : "净利润增速数据不足"}且缺少足够同行 ROE 数据，改用 PS 框架作为参考。PS 适用于亏损但营收规模较大的公司。
`;
  }

  // ===== 终极 fallback：简单 PB 绝对判断 =====
  let conclusion = "";
  let reason = "";
  if (pb < 1) {
    conclusion = "破净";
    reason = `当前 PB = ${pb.toFixed(2)}，低于 1，处于破净状态。`;
  } else if (pb < 2) {
    conclusion = "偏低";
    reason = `当前 PB = ${pb.toFixed(2)}，处于较低水平。`;
  } else if (pb < 4) {
    conclusion = "中等";
    reason = `当前 PB = ${pb.toFixed(2)}，处于中等水平。`;
  } else {
    conclusion = "偏高";
    reason = `当前 PB = ${pb.toFixed(2)}，处于较高水平。`;
  }

  return `## 估值与成长性匹配度分析

**当前估值：**
- 市盈率（PE）：${pe > 0 ? pe.toFixed(2) : "亏损（PE 失效）"}
- 市净率（PB）：${pb.toFixed(2)}

**匹配度判断：${conclusion}**

**分析依据：**
${reason}由于缺少成长性数据（净利润增速、ROE、营收数据均不足），无法计算 PEG、PB-ROE 或 PS 指标，仅能做粗略的 PB 绝对值判断。

> 注：建议补充最新财报数据以进行更精准的估值-成长性匹配分析。
`;
}

function truncateDetail(detail: string, maxLen = 2000): string {
  if (detail.length <= maxLen) return detail;
  return detail.slice(0, maxLen) + `... [truncated, total ${detail.length} chars]`;
}

export async function analyzeStock(
  options: AnalyzerOptions
): Promise<{ results: StepResult[]; companyName: string }> {
  const { stockCode, useContext = true, timeout, onProgress, onEvent } = options;

  function emitEvent(event: Omit<AnalysisEvent, "timestamp">) {
    const fullEvent = { ...event, timestamp: Date.now() };
    onEvent?.(fullEvent);
  }

  try {
    console.log(`\n开始分析股票: ${stockCode}`);
    console.log(`上下文传递: ${useContext ? "开启" : "关闭"}\n`);

    // ========== 阶段一：程序化数据获取 ==========
    console.log("【阶段一】获取实时数据...");
    emitEvent({ type: "phase_start", message: "阶段一：获取实时数据" });

    // 先标准化股票代码，确保所有 fetch 函数使用同一份纯代码（避免中文名导致 pureCode 为空）
    const resolvedCode = await resolveStockCode(stockCode);
    if (resolvedCode !== stockCode) {
      console.log(`  → 名称解析: ${stockCode} → ${resolvedCode}`);
      emitEvent({
        type: "debug_log",
        message: `名称解析: ${stockCode} → ${resolvedCode}`,
      });
    }

    const dataFetchStart = Date.now();
    const [{ realtime, kline }, historicalPE, financials, peerComparison, insiderTrading, financialRisk, mainBusiness] =
      await Promise.all([
        fetchStockData(resolvedCode),
        fetchHistoricalValuation(resolvedCode),
        fetchFinancialData(resolvedCode),
        fetchPeerComparison(resolvedCode),
        fetchInsiderTrading(resolvedCode),
        fetchFinancialRiskMetrics(resolvedCode).catch(() => null),
        fetchMainBusinessComposition(resolvedCode).catch(() => null),
      ]);

    const technical = calculateTechnicalIndicators(realtime, kline);
    const valuation = calculateValuation(realtime);

    // 计算历史PE百分位
    let peStats = null;
    if (historicalPE.length > 0) {
      const peResult = calculatePEPercentile(valuation.pe, historicalPE);
      if (peResult) {
        const { percentile, zone, ...stats } = peResult;
        valuation.pePercentile = percentile;
        valuation.peStats = stats;
        valuation.historicalPE = historicalPE;
        peStats = { percentile, zone };
        console.log(`  ✓ 历史PE数据获取完成: ${historicalPE.length} 个交易日`);
        console.log(`    - 当前PE百分位: ${percentile.toFixed(1)}% (${zone})`);
        emitEvent({
          type: "data_fetched",
          message: "历史PE数据获取完成",
          detail: `${historicalPE.length} 个交易日，当前PE百分位: ${percentile.toFixed(1)}% (${zone})`,
        });
      }
    } else {
      console.warn(`  ⚠ 历史PE数据获取失败，将使用LLM估算`);
      emitEvent({ type: "debug_log", level: "warn", message: "历史PE数据获取失败，将使用LLM估算" });
    }

    if (financials.length > 0) {
      console.log(`  ✓ 财务数据获取完成: ${financials.length} 期`);
      emitEvent({
        type: "data_fetched",
        message: "财务数据获取完成",
        detail: `${financials.length} 期财报数据`,
      });
    }
    if (peerComparison) {
      console.log(`  ✓ 同行对比数据获取完成: ${peerComparison.peers.length} 家`);
      emitEvent({
        type: "data_fetched",
        message: "同行对比数据获取完成",
        detail: `${peerComparison.peers.length} 家同行公司，所属行业: ${peerComparison.industry}`,
      });
    }
    if (insiderTrading) {
      console.log(`  ✓ 增减持数据获取完成: ${insiderTrading.managementTrades.length} 条高管记录`);
      emitEvent({
        type: "data_fetched",
        message: "增减持数据获取完成",
        detail: `${insiderTrading.managementTrades.length} 条高管记录`,
      });
    }

    emitEvent({
      type: "data_fetched",
      message: "实时行情数据获取完成",
      detail: `${realtime.name} 当前价: ¥${realtime.price.toFixed(2)}, PE: ${realtime.pe.toFixed(2)}, PB: ${realtime.pb.toFixed(2)}`,
    });

    if (financialRisk) {
      console.log(`  ✓ 财务风险指标获取完成 (${financialRisk.reportName})`);
      emitEvent({
        type: "data_fetched",
        message: "财务风险指标获取完成",
        detail: `${financialRisk.reportName}：资产负债率 ${financialRisk.debtAssetRatio}%, 经营现金流/净利润 ${financialRisk.operatingCashToProfitRatio ?? "—"}`,
      });
    }
    if (mainBusiness) {
      console.log(`  ✓ 主营业务构成获取完成 (${mainBusiness.reportName})`);
      emitEvent({
        type: "data_fetched",
        message: "主营业务构成获取完成",
        detail: `${mainBusiness.reportName}：${mainBusiness.byProduct.length} 个产品类目, ${mainBusiness.byRegion.length} 个区域`,
      });
    }

    const dataContext: DataContext = {
      stockCode,
      realtime,
      kline,
      technical,
      valuation,
      financials,
      peerComparison,
      insiderTrading,
      financialRisk,
      mainBusiness,
      summaries: [],
      stepSummaries: {},
    };

    console.log(`  ✓ 技术指标计算完成`);
    console.log(`    - MA5: ${technical.ma5.toFixed(2)}, MA20: ${technical.ma20.toFixed(2)}, MA60: ${technical.ma60.toFixed(2)}`);
    console.log(`    - 趋势: ${technical.trend}`);
    console.log(`    - 支撑位: ${technical.supports.map(s => "¥" + s.toFixed(2)).join(", ") || "暂无明显支撑"}`);
    console.log(`    - 压力位: ${technical.resistances.map(r => "¥" + r.toFixed(2)).join(", ") || "暂无明显压力"}`);

    emitEvent({
      type: "phase_end",
      message: "阶段一完成",
      detail: `数据获取耗时 ${Date.now() - dataFetchStart}ms`,
    });

    // ========== 阶段二：分析执行 ==========
    console.log("\n【阶段二】执行分析...\n");
    emitEvent({ type: "phase_start", message: "阶段二：执行分析" });

    const results: StepResult[] = [];
    const summaries: string[] = [];
    const stepSummaryMap: Record<number, string> = {};

    for (const step of ANALYSIS_STEPS) {
      const stepStart = Date.now();
      onProgress?.(step.id, ANALYSIS_STEPS.length, step.title);
      console.log(`\n[${step.id}/${ANALYSIS_STEPS.length}] ${step.title}...`);

      const stepType: "llm" | "programmatic" =
        (step.skipLLM ||
          (step.id === 3 && financials.length > 0) ||
          (step.id === 4 && peStats) ||
          (step.id === 5 && peerComparison) ||
          (step.id === 9 && insiderTrading))
          ? "programmatic"
          : "llm";

      emitEvent({
        type: "step_start",
        stepId: step.id,
        stepTitle: step.title,
        category: step.category,
        message: `开始步骤 ${step.id}: ${step.title}`,
        detail: `类型: ${stepType === "programmatic" ? "程序化" : "LLM"}`,
      });

      let content = "";
      let summary = "";

      // 纯程序化步骤：跳过 LLM
      const hasDataForStep =
        (step.id === 3 && financials.length > 0) ||
        (step.id === 4 && peStats) ||
        (step.id === 5 && peerComparison) ||
        (step.id === 6) ||
        (step.id === 9 && insiderTrading) ||
        (step.id === 10) ||
        (step.id === 11);

      // 判断 fallback 原因
      let fallbackReason = "";
      if (step.id === 3 && financials.length === 0) {
        fallbackReason = "财务数据获取失败，fallback 到 LLM";
      } else if (step.id === 4 && !peStats) {
        fallbackReason = `历史PE数据${historicalPE.length === 0 ? "获取失败" : "计算失败"}，fallback 到 LLM`;
      } else if (step.id === 5 && !peerComparison) {
        fallbackReason = "同行对比数据获取失败，fallback 到 LLM";
      } else if (step.id === 9 && !insiderTrading) {
        fallbackReason = "增减持数据获取失败，fallback 到 LLM";
      }

      if (step.skipLLM || hasDataForStep) {
        const progReason =
          step.id === 3 ? `财务数据就绪 (${financials.length}期)` :
          step.id === 4 ? `历史PE数据就绪 (${historicalPE.length}个交易日)` :
          step.id === 5 ? "同行对比数据就绪" :
          step.id === 6 ? "纯程序化步骤" :
          step.id === 9 ? "增减持数据就绪" :
          step.id === 10 ? "纯程序化步骤" :
          step.id === 11 ? "纯程序化步骤" : "程序化";
        console.log(`  → ${progReason}，走程序化路径`);
        emitEvent({
          type: "debug_log",
          stepId: step.id,
          stepTitle: step.title,
          message: `${progReason}，走程序化路径`,
        });

        if (step.id === 3 && financials.length > 0) {
          content = generateFinancialAnalysis(financials, peerComparison);
        } else if (step.id === 4 && peStats) {
          content = generatePEPercentileAnalysis(
            valuation.pe,
            valuation.peStats!,
            valuation.pePercentile!,
            peStats.zone,
            valuation.historicalPE!
          );
        } else if (step.id === 5 && peerComparison) {
          content = generatePeerComparisonAnalysis(peerComparison, valuation.pb, valuation.pe);
        } else if (step.id === 6) {
          content = generateValuationMatchAnalysis(dataContext);
        } else if (step.id === 9 && insiderTrading) {
          content = generateInsiderTradingAnalysis(insiderTrading);
        } else if (step.id === 10) {
          content = generateMovingAverageAnalysis(technical);
        } else if (step.id === 11) {
          content = generateSupportResistanceAnalysis(technical, kline);
        }
        console.log(`  ✓ 程序化输出完成`);
        emitEvent({
          type: "debug_log",
          stepId: step.id,
          stepTitle: step.title,
          message: "程序化输出完成",
          detail: truncateDetail(content.slice(0, 500)),
        });

        // 程序化步骤也需要摘要
        if (useContext && step.id < 13) {
          summary = `${step.title}：已基于实时数据程序化计算`;
          summaries.push(`【${step.title}】${summary}`);
          stepSummaryMap[step.id] = summary;
        }

        const duration = Date.now() - stepStart;
        emitEvent({
          type: "step_complete",
          stepId: step.id,
          stepTitle: step.title,
          category: step.category,
          message: `步骤 ${step.id} 完成`,
          durationMs: duration,
        });

        results.push({
          id: step.id,
          title: step.title,
          category: step.category,
          content,
          summary,
        });
        continue;
      }

      // LLM 增强步骤：传入真实数据
      if (fallbackReason) {
        console.log(`  → ${fallbackReason}`);
        emitEvent({
          type: "debug_log",
          stepId: step.id,
          stepTitle: step.title,
          message: fallbackReason,
        });
      }

      const ctx: DataContext = {
        ...dataContext,
        summaries: useContext ? [...summaries] : undefined,
        stepSummaries: useContext ? { ...stepSummaryMap } : undefined,
      };

      const prompt = step.promptFn(ctx);
      emitEvent({
        type: "debug_log",
        stepId: step.id,
        stepTitle: step.title,
        message: "构建提示词完成",
        detail: truncateDetail(prompt),
      });

      try {
        emitEvent({
          type: "llm_call_start",
          stepId: step.id,
          stepTitle: step.title,
          message: "调用 LLM...",
        });
        const llmStart = Date.now();
        const llmResult = await callLLM(prompt, { timeout });
        content = llmResult.content;
        const llmDuration = Date.now() - llmStart;
        console.log(`  ✓ LLM 分析完成 (模型: ${llmResult.model})`);
        emitEvent({
          type: "llm_call_end",
          stepId: step.id,
          stepTitle: step.title,
          message: "LLM 响应完成",
          durationMs: llmDuration,
          detail: `模型: ${llmResult.model}`,
        });
        emitEvent({
          type: "debug_log",
          stepId: step.id,
          stepTitle: step.title,
          message: `LLM 响应内容 (模型: ${llmResult.model})`,
          detail: truncateDetail(content),
        });

        // 提取摘要
        if (useContext && step.id < 13) {
          console.log(`  → 提取摘要...`);
          emitEvent({
            type: "summary_extract",
            stepId: step.id,
            stepTitle: step.title,
            message: "提取摘要...",
          });
          const summaryPrompt = promptExtractSummary(step.title, content);
          try {
            const summaryStart = Date.now();
            const summaryResult = await callLLM(summaryPrompt, { timeout });
            summary = summaryResult.content;
            emitEvent({
              type: "debug_log",
              stepId: step.id,
              stepTitle: step.title,
              message: `摘要提取完成 (模型: ${summaryResult.model})`,
              detail: truncateDetail(summary),
            });
            summaries.push(`【${step.title}】${summary}`);
            stepSummaryMap[step.id] = summary;
            console.log(`  ✓ 摘要已提取`);
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.warn(`  ⚠ 摘要提取失败，使用内容前 100 字代替`);
            emitEvent({
              type: "debug_log",
              stepId: step.id,
              stepTitle: step.title,
              message: "摘要提取失败",
              detail: errMsg,
            });
            summary = content.slice(0, 100) + "...";
            summaries.push(`【${step.title}】${summary}`);
            stepSummaryMap[step.id] = summary;
          }
        }

        const duration = Date.now() - stepStart;
        emitEvent({
          type: "step_complete",
          stepId: step.id,
          stepTitle: step.title,
          category: step.category,
          message: `步骤 ${step.id} 完成`,
          durationMs: duration,
        });

        results.push({
          id: step.id,
          title: step.title,
          category: step.category,
          content,
          summary,
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ 失败: ${errMsg}`);
        emitEvent({
          type: "step_error",
          stepId: step.id,
          stepTitle: step.title,
          category: step.category,
          message: `步骤 ${step.id} 失败`,
          error: errMsg,
          durationMs: Date.now() - stepStart,
        });

        results.push({
          id: step.id,
          title: step.title,
          category: step.category,
          content: `分析失败: ${errMsg}`,
          summary: `分析失败`,
        });
      }
    }

    emitEvent({
      type: "phase_end",
      message: "阶段二完成",
    });
    emitEvent({
      type: "complete",
      message: "分析完成",
      detail: `共 ${results.length} 个步骤`,
    });

    return { results, companyName: realtime.name };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    emitEvent({
      type: "error",
      message: "分析过程中发生致命错误",
      error: errMsg,
    });
    throw error;
  }
}
