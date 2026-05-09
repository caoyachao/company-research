import { analyzeStock } from "./analyzer.js";
import {
  generateReport,
  saveReport,
  generateHTMLReport,
  saveHTMLReport,
  openReport,
} from "./report.js";
import { checkGatewayHealth } from "./ai/gateway.js";

function showHelp(): void {
  console.log(`
用法: npx tsx src/main.ts <股票代码> [选项]

示例:
  npx tsx src/main.ts 600519.SH
  npx tsx src/main.ts 600519
  npx tsx src/main.ts 600519.SH --no-context

选项:
  --no-context    不携带前文上下文，每步独立分析
  -h, --help      显示帮助信息

环境变量:
  LLM_GATEWAY_URL     LLM Gateway 地址，默认 http://localhost:8000/v1
  LLM_GATEWAY_TIMEOUT LLM 调用超时（秒），默认 120
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
  const timeout = process.env.LLM_GATEWAY_TIMEOUT
    ? parseInt(process.env.LLM_GATEWAY_TIMEOUT, 10)
    : undefined;

  // Check LLM Gateway health
  console.log("检查 LLM Gateway 连接...");
  const health = await checkGatewayHealth();
  if (!health.ok) {
    console.error(
      `\n❌ LLM Gateway 不可用: ${health.status}`
    );
    console.error("请确保 llm-gateway-sdk 服务已启动：");
    console.error("  python -m llm_gateway_sdk.server --port 8000");
    console.error(
      "\n或在另一个终端中启动服务后再运行分析。\n"
    );
    process.exit(1);
  }
  console.log(`✓ LLM Gateway 连接正常 (${health.status})\n`);

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

    // Generate Markdown report
    const report = generateReport(stockCode, results);
    const mdPath = saveReport(stockCode, report);
    console.log(`✅ Markdown 报告: ${mdPath}`);

    // Generate HTML report and open in browser
    const html = generateHTMLReport(stockCode, results);
    const htmlPath = saveHTMLReport(stockCode, html);
    console.log(`✅ HTML 报告: ${htmlPath}`);

    openReport(htmlPath);
    console.log("🌐 已在浏览器中打开 HTML 报告");
  } catch (error) {
    console.error("\n❌ 分析过程中发生错误:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
