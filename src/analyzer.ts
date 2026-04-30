import { callOpenClaw, resetOpenClawSession } from "./ai/openclaw.js";
import {
  ANALYSIS_STEPS,
  promptExtractSummary,
  type AnalysisStep,
} from "./prompts/index.js";
import { type DataContext } from "./data/types.js";
import { type StepResult } from "./report.js";
import { fetchStockData } from "./data/eastmoney.js";
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

export interface AnalyzerOptions {
  stockCode: string;
  useContext?: boolean;
  timeout?: number;
  onProgress?: (step: number, total: number, title: string) => void;
}

/**
 * 纯程序化生成第6步：估值与成长性匹配度
 */
function generateValuationMatchAnalysis(ctx: DataContext): string {
  const { pe, pb } = ctx.valuation;

  // 简化的匹配逻辑（因为没有历史增速API，基于PE和PB做粗略判断）
  let conclusion = "";
  let reason = "";

  if (pe < 0) {
    conclusion = "无法判断（公司亏损，PE为负）";
    reason = "当前公司处于亏损状态，市盈率指标失效，无法通过PE与成长性匹配度进行判断。";
  } else if (pe < 15) {
    conclusion = "匹配";
    reason = `当前PE=${pe.toFixed(2)}，处于较低水平。一般而言，PE<15属于价值型估值区间，如果公司成长性稳定，则估值与成长性基本匹配。`;
  } else if (pe < 30) {
    conclusion = "基本匹配";
    reason = `当前PE=${pe.toFixed(2)}，处于中等水平（15-30倍）。对于成长性良好的公司，此估值区间较为合理。`;
  } else if (pe < 50) {
    conclusion = "需结合增速判断";
    reason = `当前PE=${pe.toFixed(2)}，处于较高水平（30-50倍）。若公司营收增速能持续保持在20%以上，则估值基本匹配；若增速低于15%，则可能存在高估。`;
  } else {
    conclusion = "不匹配（偏高）";
    reason = `当前PE=${pe.toFixed(2)}，处于高位（>50倍）。除非公司能保持极高的成长性（如增速>30%），否则估值水平与成长性不匹配，存在高估风险。`;
  }

  return `## 估值与成长性匹配度分析

**当前估值：**
- 市盈率（PE）：${pe.toFixed(2)}
- 市净率（PB）：${pb.toFixed(2)}

**匹配度判断：${conclusion}**

**分析依据：**
${reason}

**参考标准：**
| PE区间 | 估值特征 | 匹配的成长性要求 |
|--------|---------|----------------|
| < 15 | 价值型 | 增速 5-10% |
| 15-30 | 合理型 | 增速 10-20% |
| 30-50 | 成长型 | 增速 20-30% |
| > 50 | 高成长型 | 增速 > 30% |

> 注：由于缺乏实时财务增速API，以上分析基于当前PE水平和一般性估值标准。建议结合最新财报中的营收增速做进一步验证。
`;
}

export async function analyzeStock(
  options: AnalyzerOptions
): Promise<StepResult[]> {
  const { stockCode, useContext = true, timeout, onProgress } = options;
  const agentId = process.env.STOCK_ANALYZER_AGENT || "worker2";

  console.log(`\n开始分析股票: ${stockCode}`);
  console.log(`Agent ID: ${agentId}`);
  console.log(`上下文传递: ${useContext ? "开启" : "关闭"}\n`);

  // ========== 阶段一：程序化数据获取 ==========
  console.log("【阶段一】获取实时数据...");
  const [{ realtime, kline }, historicalPE, financials, peerComparison, insiderTrading] =
    await Promise.all([
      fetchStockData(stockCode),
      fetchHistoricalValuation(stockCode),
      fetchFinancialData(stockCode),
      fetchPeerComparison(stockCode),
      fetchInsiderTrading(stockCode),
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
    }
  } else {
    console.warn(`  ⚠ 历史PE数据获取失败，将使用LLM估算`);
  }

  if (financials.length > 0) {
    console.log(`  ✓ 财务数据获取完成: ${financials.length} 期`);
  }
  if (peerComparison) {
    console.log(`  ✓ 同行对比数据获取完成: ${peerComparison.peers.length} 家`);
  }
  if (insiderTrading) {
    console.log(`  ✓ 增减持数据获取完成: ${insiderTrading.managementTrades.length} 条高管记录`);
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
    summaries: [],
  };

  console.log(`  ✓ 技术指标计算完成`);
  console.log(`    - MA5: ${technical.ma5.toFixed(2)}, MA20: ${technical.ma20.toFixed(2)}, MA60: ${technical.ma60.toFixed(2)}`);
  console.log(`    - 趋势: ${technical.trend}`);
  console.log(`    - 支撑位: ${technical.supports.map(s => "¥" + s.toFixed(2)).join(", ") || "暂无明显支撑"}`);
  console.log(`    - 压力位: ${technical.resistances.map(r => "¥" + r.toFixed(2)).join(", ") || "暂无明显压力"}`);

  // 重置 session 确保上下文干净
  await resetOpenClawSession(agentId);

  // ========== 阶段二：分析执行 ==========
  console.log("\n【阶段二】执行分析...\n");

  const results: StepResult[] = [];
  const summaries: string[] = [];

  for (const step of ANALYSIS_STEPS) {
    onProgress?.(step.id, ANALYSIS_STEPS.length, step.title);
    console.log(`\n[${step.id}/${ANALYSIS_STEPS.length}] ${step.title}...`);

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

    if (step.skipLLM || hasDataForStep) {
      console.log(`  → 纯程序化计算...`);
      if (step.id === 3 && financials.length > 0) {
        content = generateFinancialAnalysis(financials);
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
        content = generateSupportResistanceAnalysis(technical);
      }
      console.log(`  ✓ 程序化输出完成`);

      // 程序化步骤也需要摘要
      if (useContext && step.id < 13) {
        summary = `${step.title}：已基于实时数据程序化计算`;
        summaries.push(`【${step.title}】${summary}`);
      }

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
    const ctx: DataContext = {
      ...dataContext,
      summaries: useContext ? [...summaries] : undefined,
    };

    const prompt = step.promptFn(ctx);

    try {
      content = await callOpenClaw(prompt, { agent: agentId, timeout });
      console.log(`  ✓ LLM 分析完成`);

      // 提取摘要
      if (useContext && step.id < 13) {
        console.log(`  → 提取摘要...`);
        const summaryPrompt = promptExtractSummary(step.title, content);
        try {
          summary = await callOpenClaw(summaryPrompt, {
            agent: agentId,
            timeout,
          });
          summaries.push(`【${step.title}】${summary}`);
          console.log(`  ✓ 摘要已提取`);
        } catch (e) {
          console.warn(`  ⚠ 摘要提取失败，使用内容前 100 字代替`);
          summary = content.slice(0, 100) + "...";
          summaries.push(`【${step.title}】${summary}`);
        }
      }

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

      results.push({
        id: step.id,
        title: step.title,
        category: step.category,
        content: `分析失败: ${errMsg}`,
        summary: `分析失败`,
      });
    }
  }

  return results;
}
