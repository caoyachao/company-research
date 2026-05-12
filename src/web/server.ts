import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFileSync, existsSync, createReadStream } from "fs";
import { join, extname, basename } from "path";
import { analyzeStock } from "../analyzer.js";
import {
  generateReport,
  saveReport,
  generateHTMLReport,
  saveHTMLReport,
} from "../report.js";
import { checkGatewayHealth } from "../ai/gateway.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

// MIME types for static files
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function getMimeType(filepath: string): string {
  return MIME_TYPES[extname(filepath)] || "application/octet-stream";
}

// Serve the index.html
function serveIndex(res: ServerResponse): void {
  const htmlPath = join(process.cwd(), "src", "web", "index.html");
  if (!existsSync(htmlPath)) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("index.html not found");
    return;
  }
  const html = readFileSync(htmlPath, "utf-8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

// Serve a static file from a directory
function serveStaticFile(
  filepath: string,
  res: ServerResponse
): void {
  if (!existsSync(filepath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("File not found");
    return;
  }
  res.writeHead(200, { "Content-Type": getMimeType(filepath) });
  createReadStream(filepath).pipe(res);
}

// SSE endpoint: /api/analyze?stock=CODE
function handleAnalyze(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url!, `http://localhost`);
  const stockCode = url.searchParams.get("stock");

  if (!stockCode) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Missing stock parameter");
    return;
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let isFinished = false;

  const sendEvent = (eventType: string, data: unknown): boolean => {
    if (res.destroyed || isFinished) return false;
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  };

  // Heartbeat: send a comment line every 15s to keep the connection alive
  const heartbeat = setInterval(() => {
    if (res.destroyed || isFinished) {
      clearInterval(heartbeat);
      return;
    }
    res.write(":heartbeat\n\n");
  }, 15000);

  // Clean up on client disconnect
  req.on("close", () => {
    isFinished = true;
    clearInterval(heartbeat);
  });

  // Run analysis
  runAnalysis(stockCode, sendEvent)
    .then(() => {
      if (!res.destroyed && !isFinished) {
        clearInterval(heartbeat);
        sendEvent("done", {});
        isFinished = true;
        // 短暂延迟确保 done 事件被客户端接收后再关闭连接，防止 EventSource 自动重连
        setTimeout(() => res.end(), 300);
      }
    })
    .catch((error) => {
      if (!res.destroyed && !isFinished) {
        clearInterval(heartbeat);
        const errMsg = error instanceof Error ? error.message : String(error);
        sendEvent("error", { error: errMsg });
        isFinished = true;
        // 短暂延迟确保 error 事件被客户端接收后再关闭连接
        setTimeout(() => res.end(), 300);
      }
    });
}

async function runAnalysis(
  stockCode: string,
  sendEvent: (type: string, data: unknown) => boolean
): Promise<void> {
  // Check gateway health first
  const health = await checkGatewayHealth();
  if (!health.ok) {
    throw new Error(`LLM Gateway 不可用: ${health.status}`);
  }

  sendEvent("connected", {
    message: "LLM Gateway 连接正常",
    stockCode,
  });

  const results = await analyzeStock({
    stockCode,
    useContext: true,
    onEvent: (event) => {
      sendEvent(event.type, event);
    },
  });

  // Generate reports
  const mdReport = generateReport(stockCode, results);
  const mdPath = saveReport(stockCode, mdReport);
  const htmlReport = generateHTMLReport(stockCode, results);
  const htmlPath = saveHTMLReport(stockCode, htmlReport);

  // Send completion with report paths
  sendEvent("report_ready", {
    markdownPath: mdPath,
    htmlPath: "/reports/" + basename(htmlPath),
  });
}

// Main request handler
const server = createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://localhost`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    serveIndex(res);
  } else if (url.pathname === "/api/analyze") {
    handleAnalyze(req, res);
  } else if (url.pathname.startsWith("/reports/")) {
    const filename = decodeURIComponent(basename(url.pathname));
    const filepath = join(process.cwd(), "reports", filename);
    serveStaticFile(filepath, res);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`股票分析 Web UI 已启动: http://localhost:${PORT}`);
});
