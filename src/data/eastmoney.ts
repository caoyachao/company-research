import https from "https";
import iconv from "iconv-lite";
import type { RealtimeQuote, KLineData } from "./types.js";

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
  console.log(`正在获取 ${stockCode} 的数据...`);

  const [realtime, kline] = await Promise.all([
    getRealtimeQuote(stockCode),
    getKLineData(stockCode, 500),
  ]);

  console.log(`  ✓ 实时行情: ${realtime.name} 当前价 ¥${realtime.price.toFixed(2)}`);
  console.log(`  ✓ K线数据: ${kline.length} 个交易日`);

  return { realtime, kline };
}
