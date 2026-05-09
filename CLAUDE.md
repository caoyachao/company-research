# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A stock analysis tool for A-shares (A股) that combines programmatic financial data with LLM-enhanced insights through a 13-step analysis pipeline. The tool fetches real-time quotes, historical data, financial reports, peer comparisons, and insider trading data from multiple Chinese financial data sources, then generates a Markdown report.

## Development Commands

```bash
# Install dependencies
pnpm install

# Run analysis for a stock
npx tsx src/main.ts 600519.SH

# Run without context passing (each step independent)
npx tsx src/main.ts 600519.SH --no-context

# Adjust LLM timeout
OPENCLAW_TIMEOUT=180 npx tsx src/main.ts 600519.SH
```

There are no tests, no linter, and no build step — the project runs directly via `tsx`.

## Architecture

### Two-Phase Execution Model

`main.ts` parses CLI args and calls `analyzeStock()` in `analyzer.ts`, which operates in two distinct phases:

1. **Data Fetching (parallel):** All external data is fetched concurrently via `Promise.all`:
   - Real-time quote + K-line data from Tencent Finance API (`src/data/eastmoney.ts`)
   - Historical PE/PB from akshare/东方财富 (`src/data/akshare.ts`)
   - Financial reports (annual) from akshare/东方财富
   - Peer comparison via 新浪行业分类 + akshare
   - Insider trading data from 东方财富 API

2. **Analysis Execution (sequential):** The 13 analysis steps defined in `src/prompts/index.ts` run one by one. Each step is categorized and some are purely programmatic (skip LLM entirely) while others send prompts to the LLM.

### Data Sources

| Source | Data | Method |
|--------|------|--------|
| Tencent Finance API | Real-time quote, K-line (前复权) | HTTPS request, GBK decoding via `iconv-lite` |
| akshare (Python) | Historical valuation, financials, peers, insider trading | `python3 -c` subprocess spawning |
| 新浪行业分类 | Industry classification for peer comparison | Via akshare Python wrapper |

The `akshare.ts` module spawns Python scripts via `child_process.spawn("python3", ["-c", script])` and parses JSON from stdout. It intentionally clears `HTTP_PROXY`/`HTTPS_PROXY` env vars before spawning to avoid proxy-related failures with Chinese financial APIs.

### Caching

File-based caching in `./cache/` (`src/data/cache.ts`). Cache keys include the stock code, data type, and current date. TTLs vary by data type:
- Historical valuation: 24 hours
- Financial data: 7 days
- Peer comparison: 30 days
- Insider trading: 24 hours

Cache files are `.gitignore`d.

### LLM Integration (OpenClaw)

`src/ai/openclaw.ts` interfaces with a local OpenClaw gateway (part of the Kimi app). It:
- Discovers the gateway port from `~/.kimi_openclaw/openclaw.json` (default 18679)
- Calls `openclaw.mjs agent --message` to send prompts
- Calls `openclaw.mjs gateway call sessions.reset` to reset the agent session before each analysis

**Session Reset:** `analyzeStock()` explicitly resets the OpenClaw session at the start of every run. This ensures a clean conversation context and prevents prior analysis results from leaking into the current one.

### Context Passing

When `useContext` is enabled (default), each LLM step receives summaries of all previous steps. After each LLM step completes, a separate LLM call extracts a 3-5 point summary that gets appended to the context. Programmatic steps also add a brief summary to the context. This creates a rolling context window for the LLM-enhanced steps.

### Step Types

Steps 3, 4, 5, 6, 9, 10, 11 are **programmatic** — they skip the LLM entirely when data is available and generate Markdown output directly in `analyzer.ts` or `calculators.ts`. Steps 1, 2, 7, 8, 12, 13 are **LLM-enhanced** — they always send prompts to the LLM.

The programmatic steps rely on `calculators.ts` for technical indicators (MA, support/resistance), PE percentile calculations, and text generation. The LLM steps rely on `prompts/index.ts` for prompt construction.

### Report Generation

`src/report.ts` groups steps by category and writes a Markdown file to `./reports/` with a timestamped filename.

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENCLAW_TIMEOUT` | LLM call timeout in seconds | 120 |
| `OPENCLAW_NODE` | Node.js path for OpenClaw CLI | `/Applications/Kimi.app/.../node` |
| `OPENCLAW_MJS` | Path to `openclaw.mjs` | `/Applications/Kimi.app/.../openclaw.mjs` |
| `OPENCLAW_STATE_DIR` | OpenClaw state directory | `~/.kimi_openclaw` |
| `STOCK_ANALYZER_AGENT` | Agent ID for LLM calls | `worker2` |

## External Dependencies

- **Node.js** >= 18, TypeScript, `tsx`
- **Python3** with `akshare` and `pandas` installed (`pip3 install akshare pandas`)
- **Kimi app** (or OpenClaw Gateway) running locally for LLM access
