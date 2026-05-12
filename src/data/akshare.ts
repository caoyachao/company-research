import { spawn } from "child_process";
import type {
  HistoricalValuationPoint,
  FinancialData,
  PeerComparison,
  InsiderTrading,
} from "./types.js";
import { getCachedData, setCachedData, buildCacheKey } from "./cache.js";
import {
  fetchFinancialFromDatacenter,
  fetchValuationHistoryFromDatacenter,
  fetchPeerComparisonFromDatacenter,
} from "./eastmoney.js";

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
 * 带重试的 runPythonScript：临时网络/API 抖动时自动重试
 */
async function runPythonScriptWithRetry<T>(
  script: string,
  label: string,
  defaultValue: T,
  isSuccess: (data: T) => boolean,
  timeoutMs = 60000,
  maxRetries = 2
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const data = await runPythonScript<T>(script, label, defaultValue, timeoutMs);
    if (isSuccess(data)) {
      if (attempt > 0) {
        console.log(`  [重试成功] ${label} 在第 ${attempt + 1} 次尝试成功`);
      }
      return data;
    }
    if (attempt < maxRetries) {
      console.warn(`  [重试中] ${label} 第 ${attempt + 1} 次失败，1秒后重试...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.warn(`  [重试耗尽] ${label} 已重试 ${maxRetries} 次仍失败`);
  return defaultValue;
}

/**
 * 获取历史估值数据（PE/PB）
 * 主方案：datacenter-web RPT_VALUEANALYSIS_DET（HTTP 直连，最稳定）
 * 备用：akshare stock_value_em
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

  // 主方案：datacenter-web HTTP 直连
  try {
    const data = await fetchValuationHistoryFromDatacenter(pureCode);
    if (data.length > 0) {
      console.log(`  [主方案] 历史估值 datacenter-web 成功: ${data.length} 条`);
      setCachedData(cacheKey, data);
      return data;
    }
    console.warn(`  [主方案] 历史估值 datacenter-web 返回空，尝试备用方案`);
  } catch (e) {
    console.warn(
      `  [主方案] 历史估值 datacenter-web 失败: ${e instanceof Error ? e.message : String(e)}，尝试备用方案`
    );
  }

  // 备用方案：akshare stock_value_em
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

  const data = await runPythonScriptWithRetry<HistoricalValuationPoint[]>(
    script,
    "历史估值[备用akshare]",
    [],
    (d) => d.length > 0,
    60000,
    1
  );
  if (data.length > 0) {
    console.log(`  [备用方案] 历史估值 akshare 成功: ${data.length} 条`);
    setCachedData(cacheKey, data);
  }
  return data;
}

/**
 * 获取财务数据（业绩报表）
 * 主方案：datacenter-web RPT_LICO_FN_CPD（HTTP 直连，单股查询，最稳定）
 * 备用 1：akshare stock_yjbb_em（按报告期查整表）
 * 备用 2：akshare stock_financial_abstract_ths（同花顺）
 */
export async function fetchFinancialData(stockCode: string): Promise<FinancialData[]> {
  const pureCode = stockCode.replace(/[^0-9]/g, "");
  const cacheKey = buildCacheKey(stockCode, "financials");
  const cached = getCachedData<FinancialData[]>(cacheKey, 168);
  if (cached) {
    console.log(`  [缓存] 财务数据: ${cached.length} 期`);
    return cached;
  }

  // 主方案：datacenter-web HTTP 直连
  try {
    const data = await fetchFinancialFromDatacenter(pureCode);
    if (data.length > 0) {
      console.log(`  [主方案] 财务数据 datacenter-web 成功: ${data.length} 期`);
      setCachedData(cacheKey, data);
      return data;
    }
    console.warn(`  [主方案] 财务数据 datacenter-web 返回空，尝试备用方案`);
  } catch (e) {
    console.warn(
      `  [主方案] 财务数据 datacenter-web 失败: ${e instanceof Error ? e.message : String(e)}，尝试备用方案`
    );
  }

  // 备用方案：akshare（yjbb 整表 → 同花顺单股）
  // 动态计算最近 3 个年报期
  const now = new Date();
  const currentYear = now.getFullYear();
  // 年报披露截止日为次年4月30日，如果当前日期在4月30日之前，上一年年报可能尚未全部披露
  const latestReportYear = now.getMonth() < 4 ? currentYear - 2 : currentYear - 1;
  const reportDates = [
    `${latestReportYear}1231`,
    `${latestReportYear - 1}1231`,
    `${latestReportYear - 2}1231`,
  ];

  const script = `
import akshare as ak
import json
import math

def safe_float(val, default=None):
    try:
        v = float(val)
        if math.isnan(v) or math.isinf(v):
            return default
        return v
    except:
        return default

results = []
target_dates = ${JSON.stringify(reportDates)}

# 备用 1：stock_yjbb_em (按报告期查整表)
try:
    for date in target_dates:
        try:
            df = ak.stock_yjbb_em(date=date)
            row = df[df["股票代码"] == "${pureCode}"]
            if len(row) == 0:
                continue
            r = row.iloc[0]
            revenue = safe_float(r.get("营业总收入-营业总收入"))
            rev_growth = safe_float(r.get("营业总收入-同比增长"))
            net_profit = safe_float(r.get("净利润-净利润"))
            profit_growth = safe_float(r.get("净利润-同比增长"))
            roe = safe_float(r.get("净资产收益率"))
            margin = safe_float(r.get("销售毛利率"))
            results.append({
                "year": int(date[:4]),
                "reportDate": date,
                "revenue": round(revenue / 1e8, 2) if revenue is not None else None,
                "revenueGrowth": round(rev_growth, 2) if rev_growth is not None else None,
                "netProfit": round(net_profit / 1e8, 2) if net_profit is not None else None,
                "profitGrowth": round(profit_growth, 2) if profit_growth is not None else None,
                "roe": round(roe, 2) if roe is not None else None,
                "grossMargin": round(margin, 2) if margin is not None else None
            })
        except Exception as e:
            print(f"Skip yjbb {date}: {e}", file=__import__("sys").stderr)
            continue
except Exception as e:
    print(f"yjbb 备用方案失败: {e}", file=__import__("sys").stderr)

# 备用 2：stock_financial_abstract_ths (同花顺单股财务摘要)
if len(results) == 0:
    try:
        print("备用 2: 尝试 stock_financial_abstract_ths", file=__import__("sys").stderr)
        df = ak.stock_financial_abstract_ths(symbol="${pureCode}", indicator="按年度")
        if df is not None and len(df) > 0:
            df = df.head(3)  # 取最近 3 年
            for _, r in df.iterrows():
                report_date = str(r.get("报告期", ""))
                if not report_date:
                    continue
                year_match = report_date[:4] if len(report_date) >= 4 else ""
                if not year_match.isdigit():
                    continue
                revenue = safe_float(r.get("营业总收入"))
                net_profit = safe_float(r.get("净利润"))
                roe = safe_float(r.get("净资产收益率"))
                margin = safe_float(r.get("销售毛利率"))
                results.append({
                    "year": int(year_match),
                    "reportDate": report_date,
                    "revenue": round(revenue / 1e8, 2) if revenue is not None and revenue > 1e7 else revenue,
                    "revenueGrowth": None,
                    "netProfit": round(net_profit / 1e8, 2) if net_profit is not None and net_profit > 1e6 else net_profit,
                    "profitGrowth": None,
                    "roe": round(roe, 2) if roe is not None else None,
                    "grossMargin": round(margin, 2) if margin is not None else None
                })
    except Exception as e:
        print(f"备用 2 失败: {e}", file=__import__("sys").stderr)

print(json.dumps({"success": True, "data": results}, ensure_ascii=False))
`;

  const data = await runPythonScriptWithRetry<FinancialData[]>(
    script,
    "财务数据[备用akshare]",
    [],
    (d) => d.length > 0,
    60000,
    1
  );
  if (data.length > 0) {
    console.log(`  [备用方案] 财务数据 akshare 成功: ${data.length} 期`);
    setCachedData(cacheKey, data);
  }
  return data;
}

/**
 * 获取同行对比数据
 * 主方案：datacenter-web RPT_VALUEANALYSIS_DET + RPT_LICO_FN_CPD（HTTP 直连）
 * 备用：akshare（东方财富 stock_individual_info_em + 新浪 stock_sector_spot）
 */
export async function fetchPeerComparison(stockCode: string): Promise<PeerComparison | null> {
  const pureCode = stockCode.replace(/[^0-9]/g, "");
  const cacheKey = buildCacheKey(stockCode, "peers");
  const cached = getCachedData<PeerComparison>(cacheKey, 720);
  if (cached) {
    console.log(`  [缓存] 同行对比: ${cached.peers.length} 家`);
    return cached;
  }

  // 主方案：datacenter-web HTTP 直连
  try {
    const data = await fetchPeerComparisonFromDatacenter(pureCode);
    if (data && data.peers.length > 0) {
      console.log(`  [主方案] 同行对比 datacenter-web 成功: 行业 ${data.industry}, ${data.peers.length} 家`);
      setCachedData(cacheKey, data);
      return data;
    }
    console.warn(`  [主方案] 同行对比 datacenter-web 返回空，尝试备用方案`);
  } catch (e) {
    console.warn(
      `  [主方案] 同行对比 datacenter-web 失败: ${e instanceof Error ? e.message : String(e)}，尝试备用方案`
    );
  }

  const script = `
import akshare as ak
import json
import math

found_label = None
found_name = None
cons_df = None
data_source = ""

# 主方案：东方财富板块（更稳定、更快，不需遍历）
try:
    info = ak.stock_individual_info_em(symbol="${pureCode}")
    industry = None
    for _, row in info.iterrows():
        if str(row.get("item", "")) == "行业":
            industry = str(row.get("value", ""))
            break
    if industry:
        cons_df = ak.stock_board_industry_cons_em(symbol=industry)
        if cons_df is not None and len(cons_df) > 0:
            found_label = industry
            found_name = industry
            data_source = "eastmoney"
            print(f"主方案: 找到东方财富行业 {industry}", file=__import__("sys").stderr)
except Exception as e:
    print(f"东方财富板块查询失败: {e}", file=__import__("sys").stderr)

# 备用方案：新浪行业（遍历）
if not found_label:
    try:
        print("备用方案: 尝试新浪行业分类", file=__import__("sys").stderr)
        target_symbol = "sh" + "${pureCode}" if "${pureCode}".startswith("6") else "sz" + "${pureCode}"
        sectors = ak.stock_sector_spot()
        for _, row in sectors.iterrows():
            try:
                df = ak.stock_sector_detail(sector=row["label"])
                if target_symbol in df["symbol"].values:
                    found_label = row["label"]
                    found_name = row["板块"]
                    cons_df = df
                    data_source = "sina"
                    break
            except Exception:
                continue
    except Exception as e:
        print(f"新浪行业查询失败: {e}", file=__import__("sys").stderr)

if not found_label or cons_df is None:
    print(json.dumps({"success": False, "error": "无法找到该股票所属行业"}, ensure_ascii=False))
    exit(0)

try:
    # 批量获取 ROE（最近两期年报）
    report_dates = ["20251231", "20241231", "20231231"]
    roe_map = {}
    for date in report_dates:
        try:
            df_yjbb = ak.stock_yjbb_em(date=date)
            for _, r in df_yjbb.iterrows():
                code = str(r.get("股票代码", ""))
                roe_val = r.get("净资产收益率")
                if code and roe_val is not None and code not in roe_map:
                    try:
                        rv = float(roe_val)
                        if not math.isnan(rv):
                            roe_map[code] = round(rv, 2)
                    except:
                        pass
        except Exception:
            continue

    peers = []
    for _, row in cons_df.iterrows():
        try:
            if data_source == "eastmoney":
                # 东方财富板块列字段
                code = str(row.get("代码", row.get("code", "")))
                name = str(row.get("名称", row.get("name", "")))
                pe_val = row.get("市盈率-动态", row.get("市盈率", row.get("per")))
                pb_val = row.get("市净率", row.get("pb"))
                mktcap_val = row.get("总市值", row.get("mktcap"))
                pe = float(pe_val) if pe_val is not None and not (isinstance(pe_val, float) and math.isnan(pe_val)) else 0
                pb = float(pb_val) if pb_val is not None and not (isinstance(pb_val, float) and math.isnan(pb_val)) else 0
                mktcap = float(mktcap_val) if mktcap_val is not None and not (isinstance(mktcap_val, float) and math.isnan(mktcap_val)) else 0
            else:
                # 新浪行业字段
                code = str(row.get("code", ""))
                name = str(row.get("name", ""))
                pe_val = row.get("per")
                pb_val = row.get("pb")
                mktcap_val = row.get("mktcap")
                pe = float(pe_val) if pe_val is not None and not math.isnan(pe_val) else 0
                pb = float(pb_val) if pb_val is not None and not math.isnan(pb_val) else 0
                mktcap = float(mktcap_val) * 10000 if mktcap_val is not None and not math.isnan(mktcap_val) else 0

            peers.append({
                "code": code,
                "name": name,
                "pe": pe,
                "pb": pb,
                "roe": roe_map.get(code, None),
                "marketCap": mktcap
            })
        except Exception as e:
            print(f"Skip peer row: {e}", file=__import__("sys").stderr)
            continue

    # 按市值排序，取前6家
    peers.sort(key=lambda x: x["marketCap"], reverse=True)
    peers = peers[:6]

    print(json.dumps({
        "success": True,
        "data": {"industry": found_name, "peers": peers}
    }, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
`;

  const data = await runPythonScriptWithRetry<PeerComparison | null>(
    script,
    "同行对比[备用akshare]",
    null,
    (d) => d !== null,
    120000,
    1
  );
  if (data) {
    console.log(`  [备用方案] 同行对比 akshare 成功: 行业 ${data.industry}, ${data.peers.length} 家`);
    setCachedData(cacheKey, data);
  }
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

    # 2. 十大流通股东（最新报告期）- 使用 stock_gdfx_free_top_10_em 获取持股变动
    holders = []
    try:
        prefix = "sh" if "${pureCode}".startswith("6") else "sz"
        holder_df = ak.stock_gdfx_free_top_10_em(symbol=prefix + "${pureCode}", date="latest")
        for _, row in holder_df.iterrows():
            try:
                change_raw = row.get("增减")
                change_ratio = row.get("变动比率")
                shares_val = row.get("持股数")

                change_dir = "不变"
                change_num = 0
                if pd.isna(change_raw) or str(change_raw) == "不变":
                    change_dir = "不变"
                elif str(change_raw) == "新进":
                    change_dir = "新进"
                elif isinstance(change_raw, (int, float)):
                    change_num = float(change_raw)
                    change_dir = "增持" if change_num > 0 else "减持"
                else:
                    # 尝试解析字符串格式的数字
                    try:
                        change_num = float(str(change_raw).replace(",", ""))
                        change_dir = "增持" if change_num > 0 else "减持"
                    except:
                        change_dir = str(change_raw)

                ratio = None
                if pd.notna(change_ratio):
                    try:
                        ratio = float(change_ratio)
                    except:
                        pass

                holders.append({
                    "name": str(row.get("股东名称", "")),
                    "holderType": str(row.get("股东性质", "")),
                    "shares": float(shares_val) if pd.notna(shares_val) else 0,
                    "change": abs(change_num),
                    "changeDirection": change_dir,
                    "changeRatio": ratio
                })
            except Exception as e:
                print(f"Holder row parse error: {e}", file=__import__("sys").stderr)
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

  const data = await runPythonScriptWithRetry<InsiderTrading | null>(
    script,
    "增减持",
    null,
    (d) => d !== null,
    60000,
    1
  );
  if (data) setCachedData(cacheKey, data);
  return data;
}
