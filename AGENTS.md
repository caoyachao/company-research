# AGENTS.md

本文件面向 AI 编程助手。如果你正在阅读此文件，说明你对本项目一无所知——以下内容将帮助你快速理解项目结构、技术栈和开发规范。

---

## 项目概述

本项目是一个面向 A 股（中国境内上市股票）的**深度分析工具**。它通过 13 步系统化流程，结合**程序化财务数据**与 **LLM 增强分析**，生成 Markdown/HTML 调研报告。

- **7 步纯程序化输出**：财务趋势、PE 历史百分位、同行对比、增减持、均线系统、支撑压力位、估值匹配度
- **6 步 LLM 增强**：商业模式、竞争对手、财务风险、客户供应商依赖、最坏情况推演、综合操作建议

项目支持两种使用方式：
1. **CLI**：`npx tsx src/main.ts 600519.SH`
2. **Web UI**：`pnpm web`，然后访问 http://localhost:3000

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 运行时 | Node.js >= 18 + `tsx` | 无编译步骤，直接运行 TypeScript |
| 语言 | TypeScript 5.x | `tsconfig.json` 配置为 `NodeNext` 模块解析 |
| 依赖管理 | pnpm | 使用 `pnpm-lock.yaml` |
| 数据获取 | Python 3 + akshare + pandas | 通过 `python3 -c` 子进程调用 |
| LLM 网关 | `llm-gateway-sdk` | 本地 HTTP 服务（OpenAI-compatible API） |
| 缓存 | 文件系统 JSON | `./cache/` 目录，按数据类型设置 TTL |
| 报告输出 | Markdown + 内联 CSS HTML | 保存至 `./reports/`，HTML 自动在浏览器打开 |
| Web UI | 纯 Node.js `http` 模块 + SSE | 无框架，单文件内联 HTML/CSS/JS |
| 部署 | Docker Compose / systemd / PM2 | 详见 `deploy/README.md` |

**关键外部依赖：**
- `akshare`（Python）：中国金融数据接口库
- `pandas`（Python）：数据处理
- `iconv-lite`（Node）：腾讯财经 API 返回 GBK 编码解码
- `yahoo-finance2`（Node）：已安装但当前未使用（历史遗留）

---

## 项目结构

```
company-research/
├── src/
│   ├── main.ts              # CLI 入口：解析参数、检查 Gateway、调用分析、生成报告
│   ├── analyzer.ts          # 核心分析 orchestrator：两阶段执行模型 + 事件发射
│   ├── report.ts            # Markdown/HTML 报告生成、保存、自动打开浏览器
│   ├── ai/
│   │   └── gateway.ts       # LLM Gateway HTTP 客户端（fetch /chat/completions）
│   ├── data/
│   │   ├── eastmoney.ts     # 东方财富 datacenter-web HTTP API + 腾讯财经实时行情/K线
│   │   ├── akshare.ts       # Python/akshare 备用数据方案 + 缓存读写
│   │   ├── cache.ts         # 文件缓存层（JSON，按小时 TTL）
│   │   ├── calculators.ts   # 技术指标计算 + 程序化分析文本生成
│   │   └── types.ts         # 全部 TypeScript 类型定义
│   ├── prompts/
│   │   └── index.ts         # 13 步分析提示词 + 步骤定义 + 摘要提取提示词
│   └── web/
│       ├── server.ts        # HTTP 服务器（SSE 实时推送 + 静态文件服务）
│       └── index.html       # Web UI（内联 CSS/JS，单页应用）
├── deploy/
│   ├── Dockerfile.research  # 本项目的 Docker 镜像
│   ├── Dockerfile.gateway   # LLM Gateway 的 Docker 镜像（需配合 llm-gateway-sdk 项目）
│   ├── .env.example         # API Key 模板
│   └── README.md            # 三种部署方案详解（Docker/systemd/PM2）
├── scripts/
│   ├── start.sh             # 本地一键启动 Gateway + Web UI（默认端口 8777/8778）
│   └── stop.sh              # 一键停止服务
├── docker-compose.yml       # Docker Compose 编排（gateway + research）
├── cache/                   # 运行时缓存（.gitignore）
├── reports/                 # 生成报告（.gitignore）
├── logs/                    # 本地启动日志（.gitignore）
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── README.md                # 面向用户的中文文档
```

---

## 构建与运行命令

```bash
# 安装依赖
pnpm install

# CLI 分析单只股票
npx tsx src/main.ts 600519.SH

# CLI 不携带上下文（每步独立分析）
npx tsx src/main.ts 600519.SH --no-context

# 启动 Web UI（需先启动 LLM Gateway）
pnpm web

# 启动 LLM Gateway（在另一个项目 llm-gateway-sdk 中）
python -m llm_gateway_sdk.server --port 8000

# 一键启动本地开发环境（Gateway + Web UI，端口 8777/8778）
./scripts/start.sh

# 停止本地服务
./scripts/stop.sh

# Docker Compose 部署（需 llm-gateway-sdk 与项目在同级目录）
docker compose up --build -d
```

**注意：项目没有 build step、没有 linter、没有测试框架。** 代码通过 `tsx` 直接运行 TypeScript。

---

## 架构详解

### 两阶段执行模型

`analyzer.ts` 中的 `analyzeStock()` 是核心函数，执行分为两个阶段：

**阶段一：数据获取（并行）**
所有外部数据通过 `Promise.all` 并发拉取：
- 实时行情 + K 线：`fetchStockData()` → 腾讯财经 API（`eastmoney.ts`）
- 历史 PE/PB：`fetchHistoricalValuation()` → 主方案 datacenter-web，备用 akshare
- 财务报告：`fetchFinancialData()` → 主方案 datacenter-web，备用 akshare
- 同行对比：`fetchPeerComparison()` → 主方案 datacenter-web，备用 akshare
- 增减持：`fetchInsiderTrading()` → 直接调用东方财富 API（Python requests）
- 财务风险指标：`fetchFinancialRiskMetrics()` → datacenter-web（`eastmoney.ts`）
- 主营业务构成：`fetchMainBusinessComposition()` → datacenter-web（`eastmoney.ts`）

**阶段二：分析执行（串行）**
13 个步骤按顺序执行（`src/prompts/index.ts` 中 `ANALYSIS_STEPS` 定义）。每个步骤分为两类：

| 步骤 | 标题 | 类型 |
|:---:|:---|:---|
| 1 | 核心商业模式 | LLM |
| 2 | 竞争对手分析 | LLM |
| 3 | 近三年财务趋势 | 程序化（fallback 到 LLM） |
| 4 | 市盈率历史百分位 | 程序化（fallback 到 LLM） |
| 5 | 市净率与 ROE 对比 | 程序化（fallback 到 LLM） |
| 6 | 估值与成长性匹配度 | 纯程序化 |
| 7 | 财务报表风险科目 | LLM |
| 8 | 客户与供应商依赖 | LLM |
| 9 | 大股东与高管增减持 | 程序化（fallback 到 LLM） |
| 10 | 均线系统分析 | 纯程序化 |
| 11 | 支撑位与压力位 | 纯程序化 |
| 12 | 最坏情况推演 | LLM |
| 13 | 综合操作建议 | LLM |

程序化步骤在数据就绪时跳过 LLM，直接由 `calculators.ts` 生成 Markdown 文本。当数据获取失败时，自动 fallback 到 LLM（基于提示词中的少量实时数据）。

### 事件系统

`analyzer.ts` 定义了一套完整的事件类型，通过 `onEvent` 回调发射：

- `phase_start` / `phase_end`：阶段开始/结束
- `step_start` / `step_complete` / `step_error`：单步生命周期
- `data_fetched`：数据获取完成（含详情）
- `llm_call_start` / `llm_call_end`：LLM 调用生命周期
- `debug_log`：调试日志（每步的提示词、响应内容等）
- `summary_extract`：摘要提取
- `complete` / `error`：整体完成/致命错误

Web UI 的 SSE 端点 `/api/analyze` 将这些事件实时推送到前端。

### 上下文传递

默认开启（`useContext = true`）。每个 LLM 步骤完成后，会额外发起一次 LLM 调用提取 3-5 点摘要。后续步骤的提示词通过 `buildContextBlock()` 注入前文摘要，形成滚动上下文窗口。程序化步骤也会生成简要摘要加入上下文。

---

## 数据源策略

项目采用**主备双轨**数据策略：

| 数据 | 主方案 | 备用方案 | 缓存 TTL |
|------|--------|---------|---------|
| 实时行情 | 腾讯财经 API (GBK) | — | 无 |
| K 线 | 腾讯财经 API (前复权) | — | 无 |
| 历史估值 | 东方财富 datacenter-web | akshare stock_value_em | 24h |
| 财务数据 | 东方财富 datacenter-web | akshare stock_yjbb_em / stock_financial_abstract_ths | 7d |
| 同行对比 | 东方财富 datacenter-web | akshare stock_individual_info_em / stock_sector_spot | 30d |
| 增减持 | 东方财富 API (Python requests) | — | 24h |
| 财务风险 | 东方财富 datacenter-web DMSK 三张表 | — | 无 |
| 主营业务 | 东方财富 datacenter-web RPT_F10_FN_MAINOP | — | 无 |

**重要约定：**
- `akshare.ts` 在 spawn Python 子进程前**主动清除** `HTTP_PROXY`/`HTTPS_PROXY` 环境变量，避免代理导致中国金融 API 请求失败。
- 所有 akshare 相关数据（包括备用方案）都走 `runPythonScript()` → `runPythonScriptWithRetry()`，默认重试 2 次，超时 60 秒。
- `eastmoney.ts` 中的 `requestBuffer()` 使用原生 `https` 模块，腾讯返回的数据需通过 `iconv-lite` 从 GBK 解码。

---

## LLM 集成

`src/ai/gateway.ts` 通过 HTTP 与本地 `llm-gateway-sdk` 服务通信：

- **Endpoint**：`${LLM_GATEWAY_URL}/chat/completions`（默认 `http://localhost:8000/v1/chat/completions`）
- **API 格式**：OpenAI-compatible Chat Completion
- **默认策略**：`strategy: "largest"`，`model: "auto"`，`temperature: 0.7`
- **超时**：默认 120 秒，可通过 `LLM_GATEWAY_TIMEOUT` 覆盖
- **健康检查**：`/health` 端点，5 秒超时

`callLLM()` 支持外部 `AbortSignal`，用于 Web UI 中用户取消分析的场景。

---

## 报告生成

`src/report.ts` 提供三种输出：

1. **Markdown**：按 `category` 分组，生成带时间戳的 `.md` 文件
2. **HTML**：内联 CSS，响应式布局，按 category 着色，自动转换 Markdown 表格/列表
3. **浏览器打开**：通过 `execSync` 调用系统 `open`/`start`/`xdg-open`

文件名格式：`{stockCode}_{YYYYMMDD}_{HHMMSS}.md/html`

---

## Web UI

`src/web/server.ts` 是一个零依赖的 Node.js HTTP 服务器：

- `/` 或 `/index.html`：返回内联的单页应用
- `/api/analyze?stock=CODE`：SSE 端点，实时推送分析进度
- `/reports/{filename}`：静态文件服务，供查看历史报告

`src/web/index.html` 是一个完全内联的 SPA（无外部 CSS/JS 文件），特性包括：
- SSE 连接管理 + 15 秒心跳保活
- 13 步进度可视化（pending/running/complete/error 状态）
- 每步调试日志折叠/展开
- 会话状态持久化（`sessionStorage`，刷新页面可恢复）
- 报告生成后显示查看按钮

---

## 部署

项目提供三种部署方案，详见 `deploy/README.md`：

1. **Docker Compose（推荐）**：`llm-gateway-sdk` 与 `company_research` 分别容器化，通过 Docker 网络互通。要求两个项目在同一父目录下。
2. **Systemd**：适合 Linux 生产服务器，两个服务分别配置 systemd unit。
3. **PM2**：适合开发/测试环境快速启动。

`docker-compose.yml` 中的 `gateway` 服务通过 `llm-gateway-sdk` 项目的 `pyproject.toml` 构建，`research` 服务基于 `node:22-slim` 镜像并内置 Python3 + akshare。

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_GATEWAY_URL` | LLM Gateway 服务地址 | `http://localhost:8000/v1` |
| `LLM_GATEWAY_TIMEOUT` | LLM 调用超时（秒） | 120 |
| `PORT` | Web UI 端口 | 3000 |

---

## 代码规范与开发约定

### 模块导入
- 所有 `.ts` 文件之间的导入必须使用 `.js` 扩展名（`NodeNext` 模块解析要求）
- 示例：`import { analyzeStock } from "./analyzer.js";`

### 类型定义
- 所有数据类型集中在 `src/data/types.ts`
- 分析步骤类型定义在 `src/prompts/index.ts`
- 事件类型定义在 `src/analyzer.ts`

### 错误处理
- 数据获取失败时返回空数组/null，不抛异常（由 analyzer 决定是否 fallback 到 LLM）
- Python 子进程错误通过 `console.warn` 输出，返回默认值
- LLM 调用失败记录为 `step_error` 事件，分析继续执行后续步骤

### 日志与调试
- 控制台输出使用中文，带 emoji 状态标识（✓ ✗ ⚠ →）
- `analyzer.ts` 的 `emitEvent` 是主要的调试信息通道
- Web UI 的 `debug_log` 事件包含提示词和 LLM 响应全文（长度超过 2000 字符会被截断）

### 货币与数值
- 金额单位统一为**亿元**（除以 1e8）
- 百分比保留 2 位小数
- 股价保留 2 位小数

---

## 测试

**当前没有测试框架、没有单元测试、没有集成测试。**

`package.json` 中的 `test` 脚本为 `echo "No tests yet"`。

如果你需要添加测试，建议：
- 使用 Node.js 内置 `node:test` 或 vitest
- 测试重点应放在 `calculators.ts` 的指标计算和 `eastmoney.ts` 的数据解析上（这些是纯函数/纯逻辑）
- LLM 相关流程建议用 mock gateway 做集成测试

---

## 安全注意事项

1. **API Keys**：LLM 提供商的 API Key 存储在 `llm-gateway-sdk` 项目的 `.env` 中，**不要**将其提交到本仓库。
2. **子进程**：`akshare.ts` 通过 `spawn("python3", ["-c", script])` 执行动态生成的 Python 代码。虽然脚本内容完全由代码控制，但修改相关逻辑时需警惕 SQL 注入式的字符串拼接（当前已通过模板字符串固定脚本结构）。
3. **文件系统**：`cache/` 和 `reports/` 目录通过 `mkdirSync(..., { recursive: true })` 自动创建，无需手动准备。
4. **代理清除**：`akshare.ts` 清除代理环境变量是为了避免国内 API 走代理失败，但在需要代理的环境中这可能成为问题。
5. **CORS**：Web UI 服务器设置了 `Access-Control-Allow-Origin: *`，在生产环境部署时建议限制来源。
6. **静态文件服务**：`/reports/` 路由通过 `basename()` 和 `join()` 拼接路径，当前实现没有目录遍历防护（依赖 `basename` 过滤）。

---

## 修改 checklist

当你修改以下模块时，请同时检查/更新对应内容：

| 修改内容 | 需要同步检查 |
|---------|------------|
| `src/prompts/index.ts` 新增/修改步骤 | `src/analyzer.ts` 中的 `hasDataForStep` 和分支逻辑 |
| `src/data/types.ts` 新增类型 | 所有使用该类型的 fetch 函数和 calculator 函数 |
| `src/data/eastmoney.ts` 新增 API | `src/data/akshare.ts` 中是否需要对应备用方案 |
| `src/analyzer.ts` 修改事件类型 | `src/web/server.ts` SSE 处理和 `src/web/index.html` 前端事件监听 |
| 环境变量变更 | `deploy/.env.example`、`README.md`、本文件 |
| Docker 相关 | `deploy/README.md` 中三种部署方案的一致性 |
