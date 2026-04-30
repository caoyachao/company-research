import { spawn } from "child_process";
import type {
  HistoricalValuationPoint,
  FinancialData,
  PeerComparison,
  InsiderTrading,
} from "./types.js";
import { getCachedData, setCachedData, buildCacheKey } from "./cache.js";

/**
 * 通用执行 Python 脚本并解析 JSON 输出的辅助函数
 */
function runPythonScript<T>(
  script: string,
  label: string,
  defaultValue: T,
  timeoutMs = 60000
): Promise<T> {
  return new Promise((resolve) => {
    // 清除代理环境变量，避免 akshare/requests 走代理失败
    const env = { ...process.env };
    delete env.HTTP_PROXY;
    delete env.HTTPS_PROXY;
    delete env.http_proxy;
    delete env.https_proxy;

    const child = spawn("python3", ["-c", script], { timeout: timeoutMs, env });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf-8");
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
    });

    child.on("close", (code) => {
      if (stderr && !stderr.includes("FutureWarning") && !stderr.includes("DeprecationWarning")) {
        console.warn(`[akshare][${label}] stderr:`, stderr.trim());
      }
      if (code !== 0) {
        console.warn(`[akshare][${label}] Python process exited with code ${code}`);
      }

      try {
        const result = JSON.parse(stdout.trim()) as {
          success: boolean;
          data?: T;
          error?: string;
        };
        if (!result.success) {
          console.warn(`[akshare][${label}] 失败: ${result.error}`);
          resolve(defaultValue);
          return;
        }
        resolve(result.data ?? defaultValue);
      } catch (e) {
        console.warn(
          `[akshare][${label}] 解析输出失败: ${e instanceof Error ? e.message : String(e)}`
        );
        resolve(defaultValue);
      }
    });

    child.on("error", (err) => {
      console.warn(`[akshare][${label}] 子进程错误: ${err.message}`);
      resolve(defaultValue);
    });
  });
}

/**
 * 获取历史估值数据（PE/PB）
 */
export async function fetchHistoricalValuation(
  stockCode: string
): Promise<HistoricalValuationPoint[]> {
  const pureCode = stockCode.replace(/[^0-9]/g, "");
  const cacheKey = buildCacheKey(stockCode, "historical_valuation");
  const cached = getCachedData<HistoricalValuationPoint[]>(cacheKey, 24);
  if (cached) {
    console.log(`  [缓存] 历史估值数据: ${cached.length} 条`);
    return cached;
  }

  const script = `
import akshare as ak
import json
import pandas as pd

try:
    df = ak.stock_value_em(symbol='${pureCode}')
    records = []
    for _, row in df.iterrows():
        peg_val = row.get("PEG值")
        try:
            peg = float(peg_val) if pd.notna(peg_val) else None
        except:
            peg = None
        records.append({
            "date": str(row["数据日期"]),
            "close": float(row["当日收盘价"]),
            "peTtm": float(row["PE(TTM)"]),
            "peStatic": float(row["PE(静)"]),
            "pb": float(row["市净率"]),
            "peg": peg
        })
    print(json.dumps({"success": True, "data": records}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
`;

  const data = await runPythonScript<HistoricalValuationPoint[]>(script, "历史估值", []);
  if (data.length > 0) setCachedData(cacheKey, data);
  return data;
}

/**
 * 获取财务数据（业绩报表）
 */
export async function fetchFinancialData(stockCode: string): Promise<FinancialData[]> {
  const pureCode = stockCode.replace(/[^0-9]/g, "");
  const cacheKey = buildCacheKey(stockCode, "financials");
  const cached = getCachedData<FinancialData[]>(cacheKey, 168);
  if (cached) {
    console.log(`  [缓存] 财务数据: ${cached.length} 期`);
    return cached;
  }

  // 获取最近 3 年年报: 2024, 2023, 2022
  const reportDates = ["20241231", "20231231", "20221231"];

  const script = `
import akshare as ak
import json

try:
    results = []
    for date in ${JSON.stringify(reportDates)}:
        try:
            df = ak.stock_yjbb_em(date=date)
            row = df[df["股票代码"] == "${pureCode}"]
            if len(row) == 0:
                continue
            r = row.iloc[0]
            results.append({
                "year": int(date[:4]),
                "reportDate": date,
                "revenue": round(float(r["营业总收入-营业总收入"]) / 1e8, 2),
                "revenueGrowth": round(float(r["营业总收入-同比增长"]), 2),
                "netProfit": round(float(r["净利润-净利润"]) / 1e8, 2),
                "profitGrowth": round(float(r["净利润-同比增长"]), 2),
                "roe": round(float(r["净资产收益率"]), 2),
                "grossMargin": round(float(r["销售毛利率"]), 2)
            })
        except Exception as e:
            print(f"Skip {date}: {e}", file=__import__("sys").stderr)
            continue
    print(json.dumps({"success": True, "data": results}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
`;

  const data = await runPythonScript<FinancialData[]>(script, "财务数据", []);
  if (data.length > 0) setCachedData(cacheKey, data);
  return data;
}

/**
 * 获取同行对比数据
 */
export async function fetchPeerComparison(stockCode: string): Promise<PeerComparison | null> {
  const pureCode = stockCode.replace(/[^0-9]/g, "");
  const cacheKey = buildCacheKey(stockCode, "peers");
  const cached = getCachedData<PeerComparison>(cacheKey, 720);
  if (cached) {
    console.log(`  [缓存] 同行对比: ${cached.peers.length} 家`);
    return cached;
  }

  const script = `
import akshare as ak
import json
import math

try:
    # 1. 获取新浪行业列表，找到目标股票所属行业
    target_symbol = "sh" + "${pureCode}" if "${pureCode}".startswith("6") else "sz" + "${pureCode}"
    sectors = ak.stock_sector_spot()
    found_label = None
    found_name = None
    for _, row in sectors.iterrows():
        try:
            df = ak.stock_sector_detail(sector=row["label"])
            if target_symbol in df["symbol"].values:
                found_label = row["label"]
                found_name = row["板块"]
                break
        except Exception:
            continue

    if not found_label:
        print(json.dumps({"success": False, "error": "无法找到该股票所属行业"}, ensure_ascii=False))
        exit(0)

    # 2. 获取行业成分股及估值
    cons = ak.stock_sector_detail(sector=found_label)

    peers = []
    for _, row in cons.iterrows():
        try:
            pe_val = row.get("per")
            pb_val = row.get("pb")
            mktcap_val = row.get("mktcap")
            peers.append({
                "code": str(row.get("code", "")),
                "name": str(row.get("name", "")),
                "pe": float(pe_val) if pe_val is not None and not math.isnan(pe_val) else 0,
                "pb": float(pb_val) if pb_val is not None and not math.isnan(pb_val) else 0,
                "roe": 0,
                "marketCap": float(mktcap_val) * 10000 if mktcap_val is not None and not math.isnan(mktcap_val) else 0
            })
        except Exception:
            continue

    # 按市值排序，取前6家（含目标股）
    peers.sort(key=lambda x: x["marketCap"], reverse=True)
    peers = peers[:6]

    print(json.dumps({
        "success": True,
        "data": {"industry": found_name, "peers": peers}
    }, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
`;

  const data = await runPythonScript<PeerComparison | null>(script, "同行对比", null, 120000);
  if (data) setCachedData(cacheKey, data);
  return data;
}

/**
 * 获取增减持数据
 */
export async function fetchInsiderTrading(stockCode: string): Promise<InsiderTrading | null> {
  const pureCode = stockCode.replace(/[^0-9]/g, "");
  const cacheKey = buildCacheKey(stockCode, "insider_trading");
  const cached = getCachedData<InsiderTrading>(cacheKey, 24);
  if (cached) {
    console.log(`  [缓存] 增减持数据: ${cached.managementTrades.length} 条高管记录`);
    return cached;
  }

  const script = `
import akshare as ak
import json
import requests
import pandas as pd
from datetime import datetime, timedelta

try:
    # 1. 高管增减持（近1年）- 直接调用东方财富API，按股票代码过滤，避免全量下载
    one_year_ago = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
    mgmt_trades = []
    net_buy = 0
    net_count = 0

    url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    params = {
        "reportName": "RPT_EXECUTIVE_HOLD_DETAILS",
        "columns": "ALL",
        "filter": '(SECURITY_CODE="' + "${pureCode}" + '")',
        "pageSize": "500",
        "pageNumber": "1",
        "sortTypes": "-1,1,1",
        "sortColumns": "CHANGE_DATE,SECURITY_CODE,PERSON_NAME",
        "source": "WEB",
        "client": "WEB",
    }
    r = requests.get(url, params=params, timeout=30)
    data_json = r.json()
    if data_json.get("result") and data_json["result"].get("data"):
        mgmt_df = pd.DataFrame(data_json["result"]["data"])
        mgmt_df = mgmt_df[pd.to_datetime(mgmt_df["CHANGE_DATE"]) >= one_year_ago]
        for _, row in mgmt_df.iterrows():
            try:
                shares = float(row.get("CHANGE_SHARES", 0))
                price = float(row.get("AVERAGE_PRICE", 0))
                amount = abs(shares) * price
                direction = "增持" if shares > 0 else "减持"
                if shares > 0:
                    net_buy += amount
                    net_count += 1
                else:
                    net_buy -= amount
                    net_count -= 1
                mgmt_trades.append({
                    "name": str(row.get("PERSON_NAME", "")),
                    "position": str(row.get("POSITION_NAME", "")),
                    "date": str(row.get("CHANGE_DATE", "")).split(" ")[0],
                    "changeShares": abs(shares),
                    "avgPrice": price,
                    "changeAmount": round(amount, 2),
                    "direction": direction
                })
            except:
                continue

    # 2. 十大股东（最新报告期）
    holders = []
    try:
        holder_df = ak.stock_main_stock_holder(stock="${pureCode}")
        latest_date = holder_df["截至日期"].max()
        latest_holders = holder_df[holder_df["截至日期"] == latest_date].head(10)
        for _, row in latest_holders.iterrows():
            try:
                shares_val = row.get("持股数量")
                holders.append({
                    "name": str(row.get("股东名称", "")),
                    "holderType": str(row.get("股本性质", "")),
                    "shares": float(shares_val) if pd.notna(shares_val) else 0,
                    "change": 0,
                    "changeDirection": "未知"
                })
            except:
                continue
    except Exception as e:
        print(f"Holder fetch skipped: {e}", file=__import__("sys").stderr)

    print(json.dumps({
        "success": True,
        "data": {
            "managementTrades": mgmt_trades,
            "mgmtNetBuyAmount": round(net_buy, 2),
            "mgmtNetBuyCount": net_count,
            "majorHolders": holders
        }
    }, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
`;

  const data = await runPythonScript<InsiderTrading | null>(script, "增减持", null, 60000);
  if (data) setCachedData(cacheKey, data);
  return data;
}
