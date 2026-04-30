import { analyzeStock } from "./analyzer.js";
import { generateReport, saveReport } from "./report.js";

function showHelp(): void {
  console.log(`
用法: npx tsx src/main.ts <股票代码> [选项]

示例:
  npx tsx src/main.ts 600519.SH
  OPENCLAW_TIMEOUT=180 npx tsx src/main.ts AAPL
  npx tsx src/main.ts 600519.SH --no-context

选项:
  --no-context    不携带前文上下文，每步独立分析
  -h, --help      显示帮助信息

环境变量:
  OPENCLAW_TIMEOUT    每次 AI 调用的超时时间（秒），默认 120
  OPENCLAW_NODE       Node.js 可执行文件路径
  OPENCLAW_MJS        openclaw.mjs 文件路径
  OPENCLAW_STATE_DIR  OpenClaw 状态目录，默认 ~/.kimi_openclaw
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    showHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const stockCode = args[0];
  const useContext = !args.includes("--no-context");
  const timeout = process.env.OPENCLAW_TIMEOUT
    ? parseInt(process.env.OPENCLAW_TIMEOUT, 10)
    : undefined;

  try {
    const results = await analyzeStock({
      stockCode,
      useContext,
      timeout,
      onProgress: (step, total, title) => {
        // progress shown in analyzer
      },
    });

    console.log(`\n所有步骤分析完成，正在生成报告...`);
    const report = generateReport(stockCode, results);
    const filepath = saveReport(stockCode, report);

    console.log(`\n✅ 报告已保存: ${filepath}`);
  } catch (error) {
    console.error("\n❌ 分析过程中发生错误:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
