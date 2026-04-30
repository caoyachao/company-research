import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

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
