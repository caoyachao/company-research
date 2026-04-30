# 股票深度分析工具

基于真实财务数据与 LLM 增强的 A 股股票分析程序，支持 13 步系统化分析流程。

## 功能特点

- **7 步纯程序化输出**：财务趋势、PE 历史百分位、同行对比、增减持、均线系统、支撑压力位、估值匹配度
- **6 步 LLM 增强**：商业模式、竞争对手、财务风险、客户供应商依赖、最坏情况推演、综合操作建议
- **多数据源整合**：腾讯财经（实时行情）、akshare（历史/财务/增减持）、新浪（行业分类）
- **智能缓存**：财务数据 7 天、估值数据 1 天、同行数据 30 天，二次分析秒级响应
- **上下文传递**：前序分析摘要自动注入后续步骤，保持分析连贯性
- **每次分析自动重置 Session**：确保每次运行都是干净的对话上下文，避免历史分析干扰

## 13 步分析流程

| 步骤 | 标题 | 数据来源 | 输出方式 |
|:---:|:---|:---|:---|
| 1 | 核心商业模式 | LLM 知识 | LLM |
| 2 | 竞争对手分析 | LLM 知识 + 行业名称 | LLM |
| 3 | 近三年财务趋势 | akshare 业绩报表 | **程序化** |
| 4 | 市盈率历史百分位 | akshare 历史 PE | **程序化** |
| 5 | 市净率与 ROE 对比 | 新浪行业分类 + 实时估值 | **程序化** |
| 6 | 估值与成长性匹配度 | 当前 PE/PB | **程序化** |
| 7 | 财务报表风险科目 | LLM 知识 | LLM |
| 8 | 客户与供应商依赖 | LLM 知识 | LLM |
| 9 | 大股东与高管增减持 | akshare 增减持 + 十大股东 | **程序化** |
| 10 | 均线系统分析 | 腾讯 K 线自计算 | **程序化** |
| 11 | 支撑位与压力位 | 成交量加权高低点 | **程序化** |
| 12 | 最坏情况推演 | 前文摘要 + 技术指标 | LLM |
| 13 | 综合操作建议 | 前文摘要 + 全部数据 | LLM |

## 安装

```bash
# 克隆仓库
git clone https://github.com/caoyachao/company-research.git
cd company-research

# 安装依赖
pnpm install

# 确保系统已安装 Python3 和 akshare
pip3 install akshare pandas
```

## 依赖

- **Node.js** >= 18
- **TypeScript** + tsx
- **Python3** + akshare + pandas
- **OpenClaw**（用于 LLM 调用，需本地安装 Kimi 或配置 OpenClaw Gateway）

## 使用方法

### 基本分析

```bash
# 分析茅台
npx tsx src/main.ts 600519.SH

# 或简化写法
npx tsx src/main.ts 600519
```

### 不携带上下文（每步独立分析）

```bash
npx tsx src/main.ts 600519.SH --no-context
```

### 超时设置

```bash
# 设置 LLM 调用超时时间为 180 秒
OPENCLAW_TIMEOUT=180 npx tsx src/main.ts 600519.SH
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENCLAW_TIMEOUT` | LLM 调用超时（秒） | 120 |
| `OPENCLAW_NODE` | Node.js 可执行文件路径 | `/Applications/Kimi.app/.../node` |
| `OPENCLAW_MJS` | openclaw.mjs 文件路径 | `/Applications/Kimi.app/.../openclaw.mjs` |
| `OPENCLAW_STATE_DIR` | OpenClaw 状态目录 | `~/.kimi_openclaw` |
| `STOCK_ANALYZER_AGENT` | 分析使用的 Agent ID | `worker2` |

## 数据源

| 数据类型 | 来源 | 速度 |
|---------|------|------|
| 实时行情 | 腾讯财经 API | ~350ms |
| K 线数据 | 腾讯财经 API | ~500ms |
| 历史 PE/PB | akshare / 东方财富 | ~2s |
| 财务报告 | akshare / 东方财富 | ~3s |
| 同行对比 | 新浪行业分类 | ~10s |
| 高管增减持 | 东方财富 API | ~2s |
| 十大股东 | 新浪财经 | ~2s |

## 缓存机制

所有 akshare 数据自动缓存至 `./cache/` 目录：

| 数据类型 | 缓存时间 | 文件示例 |
|---------|---------|---------|
| 历史估值 | 24 小时 | `600519_historical_valuation_2026-04-30.json` |
| 财务数据 | 7 天 | `600519_financials_2026-04-30.json` |
| 同行对比 | 30 天 | `600519_peers_2026-04-30.json` |
| 增减持 | 24 小时 | `600519_insider_trading_2026-04-30.json` |

缓存文件已加入 `.gitignore`，不会被提交。

## 文件结构

```
company-research/
├── src/
│   ├── main.ts              # CLI 入口
│   ├── analyzer.ts          # 核心分析 orchestrator
│   ├── report.ts            # 报告生成与保存
│   ├── ai/
│   │   └── openclaw.ts      # LLM 调用封装
│   ├── data/
│   │   ├── eastmoney.ts     # 腾讯财经 API（实时行情 + K线）
│   │   ├── akshare.ts       # akshare 数据获取（历史/财务/同行/增减持）
│   │   ├── cache.ts         # 文件缓存层
│   │   ├── calculators.ts   # 技术指标 / 估值 / 程序化输出生成
│   │   └── types.ts         # TypeScript 类型定义
│   └── prompts/
│       └── index.ts         # 13 步分析提示词 + 步骤定义
├── cache/                   # 运行时缓存（.gitignore）
├── reports/                 # 生成报告（.gitignore）
├── package.json
├── tsconfig.json
└── .gitignore
```

## 报告输出

分析完成后自动生成 Markdown 报告，保存至 `./reports/` 目录：

```
reports/
└── 600519.SH_20260430_122157.md
```

## 注意事项

1. **Python 环境**：必须安装 `akshare` 和 `pandas`，程序通过 `python3 -c` 子进程调用
2. **网络环境**：新浪/腾讯 API 在国内网络下通常可用，部分东方财富域名可能在特定网络环境下受限
3. **LLM 配额**：LLM 增强步骤（1、2、7、8、12、13）会消耗 Token，程序化步骤不消耗
4. **Session 管理**：每次调用 `analyzeStock()` 会自动重置 OpenClaw session，确保分析上下文干净
5. **Agent 配置**：通过 `STOCK_ANALYZER_AGENT` 环境变量可指定不同的 LLM Agent
