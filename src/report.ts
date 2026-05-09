import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

export interface StepResult {
  id: number;
  title: string;
  category: string;
  content: string;
  summary: string;
}

export function generateReport(
  stockCode: string,
  results: StepResult[]
): string {
  const now = new Date();
  const timestamp = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月${String(now.getDate()).padStart(2, "0")}日 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  // 按 category 分组
  const groups = new Map<string, StepResult[]>();
  for (const r of results) {
    if (!groups.has(r.category)) groups.set(r.category, []);
    groups.get(r.category)!.push(r);
  }

  let md = `# 股票全面分析报告：${stockCode}\n\n`;
  md += `生成时间：${timestamp}\n\n`;
  md += `---\n\n`;

  for (const [category, steps] of groups) {
    md += `## ${category}\n\n`;
    for (const s of steps) {
      md += `### ${s.id}. ${s.title}\n\n`;
      md += `${s.content}\n\n`;
    }
  }

  md += `---\n\n`;
  md += `> **免责声明**：本报告由 AI 根据公开信息和训练数据生成，仅供参考，不构成任何投资建议。投资有风险，决策需谨慎。\n`;

  return md;
}

export function saveReport(stockCode: string, report: string): string {
  const reportsDir = join(process.cwd(), "reports");
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }

  const now = new Date();
  const filename = `${stockCode}_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}.md`;
  const filepath = join(reportsDir, filename);

  writeFileSync(filepath, report, "utf-8");
  return filepath;
}

function getReportTimestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月${String(now.getDate()).padStart(2, "0")}日 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function getSafeFilename(stockCode: string): string {
  const now = new Date();
  return `${stockCode}_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
}

function categoryColor(category: string): string {
  const colors: Record<string, string> = {
    "一、公司基本面": "#3b82f6",
    "二、估值分析": "#8b5cf6",
    "三、风险排查": "#ef4444",
    "四、技术面分析": "#10b981",
    "五、最坏情况推演": "#f59e0b",
    "六、综合操作建议": "#ec4899",
  };
  return colors[category] || "#6b7280";
}

export function generateHTMLReport(
  stockCode: string,
  results: StepResult[]
): string {
  const timestamp = getReportTimestamp();

  // Group by category
  const groups = new Map<string, StepResult[]>();
  for (const r of results) {
    if (!groups.has(r.category)) groups.set(r.category, []);
    groups.get(r.category)!.push(r);
  }

  let sectionsHtml = "";
  for (const [category, steps] of groups) {
    const color = categoryColor(category);
    let stepsHtml = "";
    for (const s of steps) {
      const isFailed = s.content.startsWith("分析失败");
      const stepClass = isFailed ? "step failed" : "step";
      stepsHtml += `
        <div class="${stepClass}">
          <div class="step-header">
            <span class="step-number">${s.id}</span>
            <span class="step-title">${s.title}</span>
          </div>
          <div class="step-content">${markdownToHtml(s.content)}</div>
        </div>
      `;
    }
    sectionsHtml += `
      <section class="category">
        <h2 class="category-title" style="border-left-color: ${color}; color: ${color};">
          ${category}
        </h2>
        ${stepsHtml}
      </section>
    `;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>股票分析报告 - ${stockCode}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #f5f7fa;
      color: #1f2937;
      line-height: 1.7;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 32px 24px;
    }
    .header {
      background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
      color: white;
      padding: 40px 32px;
      border-radius: 16px;
      margin-bottom: 32px;
      box-shadow: 0 4px 20px rgba(37, 99, 235, 0.2);
    }
    .header h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .header .meta {
      opacity: 0.85;
      font-size: 14px;
    }
    .category {
      background: white;
      border-radius: 12px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .category-title {
      font-size: 18px;
      font-weight: 600;
      padding-left: 12px;
      border-left: 4px solid;
      margin-bottom: 20px;
    }
    .step {
      padding: 20px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .step:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }
    .step-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    .step-number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #eff6ff;
      color: #2563eb;
      font-size: 13px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .step-title {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
    }
    .step.failed .step-number {
      background: #fef2f2;
      color: #ef4444;
    }
    .step.failed .step-title {
      color: #ef4444;
    }
    .step-content {
      color: #374151;
      font-size: 14.5px;
    }
    .step-content p { margin-bottom: 10px; }
    .step-content p:last-child { margin-bottom: 0; }
    .step-content table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 13.5px;
    }
    .step-content th, .step-content td {
      border: 1px solid #e5e7eb;
      padding: 8px 12px;
      text-align: left;
    }
    .step-content th {
      background: #f9fafb;
      font-weight: 600;
      color: #374151;
    }
    .step-content tr:nth-child(even) {
      background: #fafafa;
    }
    .step-content blockquote {
      border-left: 3px solid #d1d5db;
      padding-left: 14px;
      margin: 12px 0;
      color: #6b7280;
      font-size: 13px;
    }
    .step-content strong { color: #111827; }
    .step-content ul, .step-content ol {
      margin: 10px 0 10px 20px;
    }
    .step-content li { margin-bottom: 4px; }
    .disclaimer {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 16px 20px;
      border-radius: 8px;
      margin-top: 24px;
      font-size: 13px;
      color: #92400e;
    }
    @media (max-width: 640px) {
      .container { padding: 16px; }
      .header { padding: 28px 20px; }
      .header h1 { font-size: 22px; }
      .category { padding: 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>股票全面分析报告：${stockCode}</h1>
      <div class="meta">生成时间：${timestamp}</div>
    </div>
    ${sectionsHtml}
    <div class="disclaimer">
      <strong>免责声明</strong>：本报告由 AI 根据公开信息和训练数据生成，仅供参考，不构成任何投资建议。投资有风险，决策需谨慎。
    </div>
  </div>
</body>
</html>`;
}

function markdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^#{2,}\s*(.+)$/gm, "<h3>$1</h3>")
    .replace(/^#{1}\s*(.+)$/gm, "<h2>$1</h2>")
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^\s*>\s*(.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^\s*[-*]\s*(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.+<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/^(\d+)\.\s*(.+)$/gm, "<li>$2</li>")
    .replace(/(<li>.+<\/li>\n?)+/g, (match) => {
      if (match.includes("<ul>")) return match;
      return `<ol>${match}</ol>`;
    });

  // Convert markdown tables
  const tableRegex = /\|(.+)\|\n\|[\s\-:|]+\|\n((?:\|.+\|\n?)+)/g;
  html = html.replace(tableRegex, (match, headerRow, bodyRows) => {
    const headers = headerRow
      .split("|")
      .map((h: string) => h.trim())
      .filter(Boolean);
    const headerHtml = headers.map((h: string) => `<th>${h}</th>`).join("");
    const rows = bodyRows
      .trim()
      .split("\n")
      .map((row: string) => {
        const cells = row
          .split("|")
          .map((c: string) => c.trim())
          .filter(Boolean);
        return `<tr>${cells.map((c: string) => `<td>${c}</td>`).join("")}</tr>`;
      })
      .join("");
    return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Wrap plain lines in paragraphs
  const lines = html.split("\n");
  let inBlock = false;
  const wrapped = lines.map((line) => {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith("<") ||
      trimmed.startsWith("|")
    ) {
      return line;
    }
    return `<p>${trimmed}</p>`;
  });

  return wrapped.join("\n");
}

export function saveHTMLReport(
  stockCode: string,
  html: string
): string {
  const reportsDir = join(process.cwd(), "reports");
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }

  const filename = `${getSafeFilename(stockCode)}.html`;
  const filepath = join(reportsDir, filename);

  writeFileSync(filepath, html, "utf-8");
  return filepath;
}

/**
 * Open the HTML report in the default browser.
 */
export function openReport(filepath: string): void {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync(`open "${filepath}"`, { stdio: "ignore" });
    } else if (platform === "win32") {
      execSync(`start "" "${filepath}"`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open "${filepath}"`, { stdio: "ignore" });
    }
  } catch {
    // Silently ignore if browser cannot be opened
  }
}
