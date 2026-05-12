import https from "https";
import iconv from "iconv-lite";
import type { RealtimeQuote, KLineData, FinancialData, HistoricalValuationPoint, PeerComparison } from "./types.js";

function requestBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

async function requestJSON<T>(url: string): Promise<T> {
  const buffer = await requestBuffer(url);
  const text = buffer.toString("utf-8");
  return JSON.parse(text) as T;
}

interface EastmoneySearchResult {
  QuotationCodeTable?: {
    Data: Array<{
      Code: string;
      Name: string;
      Classify: string;
    }>;
  };
}

/**
 * 解析用户输入的股票代码或名称
 * - 000001.SZ → 000001.SZ
 * - 000001 → 000001
 * - 平安银行 → 000001（通过东方财富搜索 API）
 */
export async function resolveStockCode(input: string): Promise<string> {
  const trimmed = input.trim();

  // 已是标准代码格式
  if (/^\d{6}\.(SH|SZ|BJ)$/i.test(trimmed)) {
    return trimmed;
  }

  // 纯 6 位数字
  if (/^\d{6}$/.test(trimmed)) {
    return trimmed;
  }

  // 包含中文，尝试搜索
  if (/[一-龥]/.test(trimmed)) {
    const encoded = encodeURIComponent(trimmed);
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encoded}&type=14&count=10`;

    try {
      const data = await requestJSON<EastmoneySearchResult>(url);
      const results = data.QuotationCodeTable?.Data || [];
      const aStock = results.find((item) => item.Classify === "AStock");
      if (aStock) {
        return aStock.Code;
      }
    } catch {
      // 搜索失败，继续抛错
    }
    throw new Error(`未找到股票"${trimmed}"，请输入正确的股票代码（如 000001.SZ）`);
  }

  // 其他格式，尝试提取 6 位数字
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length === 6) {
    return digits;
  }

  throw new Error(`无法识别的股票代码格式: ${trimmed}`);
}

// 将用户输入的股票代码转换为腾讯格式
// 600519.SH → sh600519
// 000001.SZ → sz000001
function normalizeCode(code: string): string {
  const pure = code.replace(/[^0-9]/g, "");
  if (code.includes(".SH") || pure.startsWith("6") || pure.startsWith("5")) {
    return `sh${pure}`;
  }
  return `sz${pure}`;
}

/**
 * 获取实时行情（腾讯接口）
 * 返回格式: v_sh600519="1~名称~代码~当前价~昨收~开盘价~..."
 *
 * 字段索引（基于实际数据验证）:
 * 0:市场(1=上海) 1:名称 2:代码 3:当前价 4:昨收 5:开盘价 6:成交量(手) 7:外盘 8:内盘
 * 9~28: 买1~买5 价格+数量
 * 29~48: 卖1~卖5 价格+数量
 * 49:逐笔成交 50:空 51:时间(14位)
 * 时间后:
 *   +0:涨跌额 +1:涨跌幅 +2:最高 +3:最低 +4:价格/成交量/成交额
 *   +5:成交量 +6:成交额(万) +7:换手率 +8:市盈率 +9:空
 *   +10:最高 +11:最低 +12:振幅 +13:流通市值 +14:总市值 +15:市净率
 */
export async function getRealtimeQuote(stockCode: string): Promise<RealtimeQuote> {
  const tencentCode = normalizeCode(stockCode);
  const url = `https://qt.gtimg.cn/q=${tencentCode}`;

  const buffer = await requestBuffer(url);
  // 腾讯返回 GBK 编码
  const raw = iconv.decode(buffer, "gb2312");

  // 解析: v_sh600519="1~贵州茅台~600519~1381.88~1401.17~1400.00~..."
  const match = raw.match(/v_[^=]+="([^"]+)"/);
  if (!match) {
    throw new Error(`无法解析 ${stockCode} 的实时行情数据`);
  }

  const parts = match[1].split("~");

  // 找时间字段 (14位数字 yyyyMMddHHmmss)
  let timeIdx = -1;
  for (let i = 30; i < parts.length; i++) {
    if (/^\d{12,14}$/.test(parts[i])) {
      timeIdx = i;
      break;
    }
  }

  if (timeIdx === -1) {
    throw new Error(`无法解析 ${stockCode} 的字段结构`);
  }

  const baseIdx = timeIdx;

  return {
    code: parts[2],
    name: parts[1],
    price: parseFloat(parts[3]),
    prevClose: parseFloat(parts[4]),
    open: parseFloat(parts[5]),
    high: parseFloat(parts[baseIdx + 3]) || parseFloat(parts[3]),
    low: parseFloat(parts[baseIdx + 4]) || parseFloat(parts[3]),
    volume: parseFloat(parts[6]) * 100, // 成交量(手) → 股
    amount: parseFloat(parts[baseIdx + 7]) * 10000, // 成交额(万) → 元
    pe: parseFloat(parts[baseIdx + 9]) || 0,
    pb: parseFloat(parts[baseIdx + 16]) || 0,
    marketCap: parseFloat(parts[baseIdx + 14]) || 0, // 总市值(亿)
    turnover: parseFloat(parts[baseIdx + 8]) || 0,
  };
}

/**
 * 获取历史K线数据（腾讯接口）
 * 返回格式: ["日期", "开盘", "收盘", "最高", "最低", "成交量"]
 * 注意: 腾讯返回的是前复权数据
 */
export async function getKLineData(stockCode: string, days: number = 500): Promise<KLineData[]> {
  const tencentCode = normalizeCode(stockCode);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days * 1.5);

  const beg = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);

  // 腾讯K线接口: qfq=前复权
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentCode},day,${beg},${end},${days},qfq`;

  const buffer = await requestBuffer(url);
  const raw = iconv.decode(buffer, "gb2312");
  const json = JSON.parse(raw);

  const stockData = json.data?.[tencentCode];
  if (!stockData || !stockData.qfqday) {
    throw new Error(`无法获取 ${stockCode} 的历史K线数据`);
  }

  const lines: KLineData[] = stockData.qfqday.map((line: string[]) => ({
    date: line[0],
    open: parseFloat(line[1]),
    close: parseFloat(line[2]),
    high: parseFloat(line[3]),
    low: parseFloat(line[4]),
    volume: parseFloat(line[5]),
    amount: 0,
    amplitude: 0,
    changePercent: 0,
    changeAmount: 0,
    turnover: 0,
  }));

  // 补充计算：涨跌幅、涨跌额、振幅
  for (let i = 1; i < lines.length; i++) {
    const curr = lines[i];
    const prev = lines[i - 1];
    curr.changeAmount = curr.close - prev.close;
    curr.changePercent = (curr.changeAmount / prev.close) * 100;
    curr.amplitude = ((curr.high - curr.low) / prev.close) * 100;
  }

  return lines;
}

/**
 * 获取所有需要的数据
 */
export async function fetchStockData(stockCode: string) {
  const resolvedCode = await resolveStockCode(stockCode);
  if (resolvedCode !== stockCode) {
    console.log(`  → 名称解析: ${stockCode} → ${resolvedCode}`);
  }

  console.log(`正在获取 ${resolvedCode} 的数据...`);

  const [realtime, kline] = await Promise.all([
    getRealtimeQuote(resolvedCode),
    getKLineData(resolvedCode, 500),
  ]);

  console.log(`  ✓ 实时行情: ${realtime.name} 当前价 ¥${realtime.price.toFixed(2)}`);
  console.log(`  ✓ K线数据: ${kline.length} 个交易日`);

  return { realtime, kline };
}

// ==================== datacenter-web 报表 ====================

interface DatacenterResponse<T> {
  version: string | null;
  result: { pages: number; data: T[] } | null;
  success: boolean;
  message?: string;
}

interface RawFinancialRow {
  SECURITY_CODE: string;
  REPORTDATE: string;
  QDATE: string;
  TOTAL_OPERATE_INCOME: number | null;
  PARENT_NETPROFIT: number | null;
  WEIGHTAVG_ROE: number | null;
  YSTZ: number | null;
  SJLTZ: number | null;
  XSMLL: number | null;
}

interface RawValuationRow {
  SECURITY_CODE: string;
  TRADE_DATE: string;
  CLOSE_PRICE: number | null;
  PE_TTM: number | null;
  PE_LAR: number | null;
  PB_MRQ: number | null;
}

async function fetchDatacenter<T>(
  reportName: string,
  columns: string,
  filter: string,
  pageSize: number = 500,
  pageNumber: number = 1,
  sortColumns: string = "",
  sortTypes: string = ""
): Promise<T[]> {
  const params = new URLSearchParams({
    reportName,
    columns,
    filter,
    pageSize: String(pageSize),
    pageNumber: String(pageNumber),
  });
  if (sortColumns) {
    params.set("sortColumns", sortColumns);
    params.set("sortTypes", sortTypes);
  }
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?${params.toString()}`;
  const data = await requestJSON<DatacenterResponse<T>>(url);
  if (!data.success || !data.result) {
    throw new Error(`datacenter ${reportName}: ${data.message || "no data"}`);
  }
  return data.result.data;
}

/**
 * 获取近 3 年年报财务数据（datacenter-web RPT_LICO_FN_CPD）
 * 筛选 QDATE 形如 YYYYQ4 的记录作为年报
 */
export async function fetchFinancialFromDatacenter(
  pureCode: string
): Promise<FinancialData[]> {
  const rows = await fetchDatacenter<RawFinancialRow>(
    "RPT_LICO_FN_CPD",
    "SECURITY_CODE,REPORTDATE,QDATE,TOTAL_OPERATE_INCOME,PARENT_NETPROFIT,WEIGHTAVG_ROE,YSTZ,SJLTZ,XSMLL",
    `(SECURITY_CODE="${pureCode}")`,
    50,
    1,
    "REPORTDATE",
    "-1"
  );

  const annuals = rows.filter((r) => r.QDATE && r.QDATE.endsWith("Q4")).slice(0, 3);
  return annuals.map((r) => {
    const year = parseInt(r.QDATE.slice(0, 4), 10);
    const revenue = r.TOTAL_OPERATE_INCOME;
    const netProfit = r.PARENT_NETPROFIT;
    return {
      year,
      reportDate: r.REPORTDATE.slice(0, 10).replace(/-/g, ""),
      revenue: revenue != null ? Math.round((revenue / 1e8) * 100) / 100 : 0,
      revenueGrowth: r.YSTZ != null ? Math.round(r.YSTZ * 100) / 100 : 0,
      netProfit: netProfit != null ? Math.round((netProfit / 1e8) * 100) / 100 : 0,
      profitGrowth: r.SJLTZ != null ? Math.round(r.SJLTZ * 100) / 100 : 0,
      roe: r.WEIGHTAVG_ROE != null ? Math.round(r.WEIGHTAVG_ROE * 100) / 100 : null,
      grossMargin: r.XSMLL != null ? Math.round(r.XSMLL * 100) / 100 : null,
    };
  });
}

/**
 * 获取历史 PE/PB 数据（datacenter-web RPT_VALUEANALYSIS_DET）
 * 分页拉取，按日期升序返回（calculatePEPercentile 期望升序）
 */
export async function fetchValuationHistoryFromDatacenter(
  pureCode: string
): Promise<HistoricalValuationPoint[]> {
  const allRows: RawValuationRow[] = [];
  // 单次最多 500 条，最多拉 6 页（约 3000 个交易日，覆盖近 12 年）
  for (let page = 1; page <= 6; page++) {
    const rows = await fetchDatacenter<RawValuationRow>(
      "RPT_VALUEANALYSIS_DET",
      "SECURITY_CODE,TRADE_DATE,CLOSE_PRICE,PE_TTM,PE_LAR,PB_MRQ",
      `(SECURITY_CODE="${pureCode}")`,
      500,
      page,
      "TRADE_DATE",
      "-1"
    );
    if (rows.length === 0) break;
    allRows.push(...rows);
    if (rows.length < 500) break;
  }

  // 按日期升序排（calculator 期望旧->新）
  allRows.sort((a, b) => a.TRADE_DATE.localeCompare(b.TRADE_DATE));

  return allRows
    .filter((r) => r.PE_TTM != null && r.CLOSE_PRICE != null)
    .map((r) => ({
      date: r.TRADE_DATE.slice(0, 10),
      close: r.CLOSE_PRICE!,
      peTtm: r.PE_TTM!,
      peStatic: r.PE_LAR ?? r.PE_TTM!,
      pb: r.PB_MRQ ?? 0,
    }));
}

interface RawIndustryValuationRow {
  SECURITY_CODE: string;
  SECURITY_NAME_ABBR: string;
  BOARD_NAME: string;
  TRADE_DATE: string;
  CLOSE_PRICE: number | null;
  PE_TTM: number | null;
  PB_MRQ: number | null;
  TOTAL_MARKET_CAP: number | null;
}

interface RawIndustryROERow {
  SECURITY_CODE: string;
  QDATE: string;
  WEIGHTAVG_ROE: number | null;
}

/**
 * 获取同行对比数据（datacenter-web）
 * 1. RPT_LICO_FN_CPD 单股查询拿目标股所属行业（PUBLISHNAME）
 * 2. RPT_VALUEANALYSIS_DET 按 BOARD_NAME 取行业最新一天的所有股票（含 PE/PB/市值）
 * 3. RPT_LICO_FN_CPD 按 PUBLISHNAME + Q4 拿同行的 ROE map
 */
export async function fetchPeerComparisonFromDatacenter(
  pureCode: string
): Promise<PeerComparison | null> {
  // 1. 拿目标股所属行业
  const targetRows = await fetchDatacenter<{ PUBLISHNAME: string }>(
    "RPT_LICO_FN_CPD",
    "SECURITY_CODE,PUBLISHNAME",
    `(SECURITY_CODE="${pureCode}")`,
    1,
    1,
    "REPORTDATE",
    "-1"
  );
  const industry = targetRows[0]?.PUBLISHNAME;
  if (!industry) {
    throw new Error(`未找到股票 ${pureCode} 所属行业`);
  }

  // 2. 拿行业最新一天所有股票的估值（按市值降序，取 top 50 含目标股）
  const escapedIndustry = industry.replace(/"/g, '\\"');
  const valuationRows = await fetchDatacenter<RawIndustryValuationRow>(
    "RPT_VALUEANALYSIS_DET",
    "SECURITY_CODE,SECURITY_NAME_ABBR,BOARD_NAME,TRADE_DATE,CLOSE_PRICE,PE_TTM,PB_MRQ,TOTAL_MARKET_CAP",
    `(BOARD_NAME="${escapedIndustry}")`,
    50,
    1,
    "TRADE_DATE,TOTAL_MARKET_CAP",
    "-1,-1"
  );
  if (valuationRows.length === 0) {
    throw new Error(`未找到行业 ${industry} 的成分股`);
  }

  // 只保留最新一天（valuationRows 已按 TRADE_DATE 降序，取第一条的日期作为基准）
  const latestDate = valuationRows[0].TRADE_DATE;
  const latestRows = valuationRows.filter((r) => r.TRADE_DATE === latestDate);

  // 3. 拿同行最新 Q4 的 ROE map（多年报兜底）
  const roeMap: Record<string, number> = {};
  for (const quarter of ["2025Q4", "2024Q4", "2023Q4"]) {
    if (Object.keys(roeMap).length >= latestRows.length) break;
    try {
      const roeRows = await fetchDatacenter<RawIndustryROERow>(
        "RPT_LICO_FN_CPD",
        "SECURITY_CODE,QDATE,WEIGHTAVG_ROE",
        `(PUBLISHNAME="${escapedIndustry}")(QDATE="${quarter}")`,
        100,
        1
      );
      for (const r of roeRows) {
        if (r.WEIGHTAVG_ROE != null && !(r.SECURITY_CODE in roeMap)) {
          roeMap[r.SECURITY_CODE] = Math.round(r.WEIGHTAVG_ROE * 100) / 100;
        }
      }
    } catch {
      // 某个季度查询失败不影响整体
    }
  }

  // 4. 按市值排序取 top 6
  const sorted = [...latestRows].sort(
    (a, b) => (b.TOTAL_MARKET_CAP || 0) - (a.TOTAL_MARKET_CAP || 0)
  );
  const peers = sorted.slice(0, 6).map((r) => ({
    code: r.SECURITY_CODE,
    name: r.SECURITY_NAME_ABBR,
    pe: r.PE_TTM ?? 0,
    pb: r.PB_MRQ ?? 0,
    roe: roeMap[r.SECURITY_CODE] ?? null,
    marketCap: r.TOTAL_MARKET_CAP ?? 0,
  }));

  return { industry, peers };
}
