import { callLLM } from "./ai/gateway.js";
import {
  ANALYSIS_STEPS,
  promptExtractSummary,
  type AnalysisStep,
} from "./prompts/index.js";
import { type DataContext } from "./data/types.js";
import { type StepResult } from "./report.js";
import { fetchStockData, resolveStockCode } from "./data/eastmoney.js";
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

function truncateDetail(detail: string, maxLen = 2000): string {
  if (detail.length <= maxLen) return detail;
  return detail.slice(0, maxLen) + `... [truncated, total ${detail.length} chars]`;
}

export async function analyzeStock(
  options: AnalyzerOptions
): Promise<StepResult[]> {
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
    const [{ realtime, kline }, historicalPE, financials, peerComparison, insiderTrading] =
      await Promise.all([
        fetchStockData(resolvedCode),
        fetchHistoricalValuation(resolvedCode),
        fetchFinancialData(resolvedCode),
        fetchPeerComparison(resolvedCode),
        fetchInsiderTrading(resolvedCode),
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

    return results;
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
