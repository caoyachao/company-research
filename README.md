# 股票深度分析工具

基于真实财务数据与 LLM 增强的 A 股股票分析程序，支持 13 步系统化分析流程。

## 功能特点

- **7 步纯程序化输出**：财务趋势、PE 历史百分位、同行对比、增减持、均线系统、支撑压力位、估值匹配度
- **6 步 LLM 增强**：商业模式、竞争对手、财务风险、客户供应商依赖、最坏情况推演、综合操作建议
- **多数据源整合**：腾讯财经（实时行情）、akshare（历史/财务/增减持）、新浪（行业分类）
- **智能缓存**：财务数据 7 天、估值数据 1 天、同行数据 30 天，二次分析秒级响应
- **上下文传递**：前序分析摘要自动注入后续步骤，保持分析连贯性
- **HTML 报告**：自动生成美观的 HTML 报告并在浏览器中打开
- **多 LLM 路由**：通过 llm-gateway-sdk 自动选择最优可用模型，支持 Kimi、SiliconFlow、Zhipu 等多家提供商

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

# 安装 Node.js 依赖
pnpm install

# 确保系统已安装 Python3 和 akshare、pip3 install akshare pandas
```

## 依赖

- **Node.js** >= 18
- **TypeScript** + tsx
- **Python3** + akshare + pandas
- **llm-gateway-sdk**（用于 LLM 调用，支持多提供商自动路由）

## 使用方法

### 1. 启动 LLM Gateway 服务

```bash
# 方式一：使用项目内置脚本
pnpm gateway

# 方式二：直接启动
python -m llm_gateway_sdk.server --port 8000
```

Gateway 服务需要配置 `.env` 文件，包含各 LLM 提供商的 API Key。详见 [llm-gateway-sdk 配置](https://github.com/caoyachao/llm-gateway-sdk)。

### 2. Web UI（推荐）

启动 Web 服务，在浏览器中输入股票代码，实时查看 13 步分析进展：

```bash
pnpm web
```

打开 http://localhost:3000，输入股票代码（如 `600519.SH`），点击"开始分析"。

支持实时 SSE 进度推送、每步调试日志查看、自动生成 HTML/Markdown 报告。

### 3. CLI 运行分析

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
LLM_GATEWAY_TIMEOUT=180 npx tsx src/main.ts 600519.SH
```

## Docker 部署

与 `llm-gateway-sdk` 联合部署：

```bash
# 确保两个项目在同一父目录下
# company_research/ 和 llm-gateway-sdk/

# 在 company_research 目录下
cd company_research

# 启动两个服务
docker compose up --build -d

# 查看日志
docker compose logs -f
```

详见 `deploy/README.md`。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_GATEWAY_URL` | LLM Gateway 服务地址 | `http://localhost:8000/v1` |
| `LLM_GATEWAY_TIMEOUT` | LLM 调用超时（秒） | 120 |

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
│   ├── analyzer.ts          # 核心分析 orchestrator（含事件发射）
│   ├── report.ts            # Markdown / HTML 报告生成与保存
│   ├── ai/
│   │   └── gateway.ts       # LLM Gateway HTTP 客户端
│   ├── data/
│   │   ├── eastmoney.ts     # 腾讯财经 API（实时行情 + K线）
│   │   ├── akshare.ts       # akshare 数据获取
│   │   ├── cache.ts         # 文件缓存层
│   │   ├── calculators.ts   # 技术指标 / 程序化输出生成
│   │   └── types.ts         # TypeScript 类型定义
│   ├── prompts/
│   │   └── index.ts         # 13 步分析提示词 + 步骤定义
│   └── web/
│       ├── server.ts        # HTTP 服务器（SSE 实时推送）
│       └── index.html       # Web UI（内联 CSS/JS）
├── deploy/
│   ├── Dockerfile.research  # 股票分析工具 Docker 镜像
│   ├── Dockerfile.gateway   # LLM 网关 Docker 镜像（需复制到 gateway 项目）
│   ├── .env.example         # 环境变量模板
│   └── README.md            # 部署文档
├── docker-compose.yml       # Docker Compose 编排
├── cache/                   # 运行时缓存（.gitignore）
├── reports/                 # 生成报告（.gitignore）
├── package.json
├── tsconfig.json
├── .gitignore
└── CLAUDE.md                # 项目说明（Claude Code 用）
```

## 报告输出

分析完成后同时生成 Markdown 和 HTML 两种格式的报告，保存至 `./reports/` 目录，并自动在浏览器中打开 HTML 报告：

```
reports/
├── 600519.SH_20260430_122157.md
└── 600519.SH_20260430_122157.html   # 自动在浏览器中打开
```

## 注意事项

1. **LLM Gateway**：运行分析前必须先启动 `llm-gateway-sdk` 服务，程序会检查 Gateway 健康状态
2. **Python 环境**：必须安装 `akshare` 和 `pandas`，程序通过 `python3 -c` 子进程调用
3. **网络环境**：新浪/腾讯 API 在国内网络下通常可用，部分东方财富域名可能在特定网络环境下受限
4. **LLM 配额**：LLM 增强步骤（1、2、7、8、12、13）会消耗 Token，程序化步骤不消耗
5. **多提供商路由**：llm-gateway-sdk 会自动在多个 LLM 提供商之间选择可用模型，支持自动降级到免费模型
