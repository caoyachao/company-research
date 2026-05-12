// 东方财富实时行情数据
export interface RealtimeQuote {
  code: string;           // 股票代码
  name: string;           // 股票名称
  price: number;          // 当前价格 (f43)
  open: number;           // 开盘价 (f46)
  high: number;           // 最高价 (f44)
  low: number;            // 最低价 (f45)
  prevClose: number;      // 昨收价 (f60)
  volume: number;         // 成交量 (f47)
  amount: number;         // 成交额 (f48)
  pe: number;             // 市盈率 (f162)
  pb: number;             // 市净率 (f167)
  marketCap: number;      // 总市值 (f116)
  turnover: number;       // 换手率 (f168)
}

// K线数据
export interface KLineData {
  date: string;           // 日期
  open: number;           // 开盘价
  close: number;          // 收盘价
  high: number;           // 最高价
  low: number;            // 最低价
  volume: number;         // 成交量
  amount: number;         // 成交额
  amplitude: number;      // 振幅
  changePercent: number;  // 涨跌幅
  changeAmount: number;   // 涨跌额
  turnover: number;       // 换手率
}

// 技术指标
export interface TechnicalIndicators {
  currentPrice: number;
  ma5: number;
  ma20: number;
  ma60: number;
  ma120?: number;
  trend: "上升通道" | "下降通道" | "震荡整理";
  ma5Position: "上方" | "下方";
  ma20Position: "上方" | "下方";
  ma60Position: "上方" | "下方";
  supports: number[];     // 支撑位
  resistances: number[];  // 压力位
}

// 历史估值数据点
export interface HistoricalValuationPoint {
  date: string;
  close: number;
  peTtm: number;
  peStatic: number;
  pb: number;
  peg?: number;
}

// 估值指标
export interface ValuationMetrics {
  pe: number;
  pb: number;
  marketCap: number;
  // 历史PE统计数据（用于百分位计算）
  pePercentile?: number;          // 当前PE在历史中的百分位 (0-100)
  peStats?: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p25: number;
    p75: number;
    historicalMin: number;
    historicalMax: number;
  };
  historicalPE?: HistoricalValuationPoint[];
}

// 财务数据（单期）
export interface FinancialData {
  year: number;
  reportDate: string;
  revenue: number;        // 营业总收入（亿元）
  revenueGrowth: number;  // 营收同比增速（%）
  netProfit: number;      // 净利润（亿元）
  profitGrowth: number;   // 净利润同比增速（%）
  roe: number | null;     // 净资产收益率（%）
  grossMargin: number | null; // 销售毛利率（%）
}

// 同行对比
export interface PeerComparison {
  industry: string;
  peers: {
    code: string;
    name: string;
    pe: number;
    pb: number;
    roe: number | null;
    marketCap: number;
  }[];
}

// 增减持数据
export interface InsiderTrade {
  name: string;
  position: string;
  date: string;
  changeShares: number;
  avgPrice: number;
  changeAmount: number;
  direction: "增持" | "减持";
}

export interface MajorHolder {
  name: string;
  holderType: string;
  shares: number;
  change: number;
  changeDirection: string;
  changeRatio?: number;
}

export interface InsiderTrading {
  managementTrades: InsiderTrade[];
  mgmtNetBuyAmount: number;  // 高管净买入金额（负数为净卖出）
  mgmtNetBuyCount: number;   // 净买入人次
  majorHolders: MajorHolder[];
}

// 财务风险指标（步骤 7 输入）
export interface FinancialRiskMetrics {
  reportDate: string;           // YYYY-MM-DD
  reportName: string;           // 如"2025年报"
  // 资产负债（亿元）
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  accountsReceivable: number;
  accountsReceivableYoY: number | null;  // 同比变化（%）
  inventory: number;
  inventoryYoY: number | null;
  monetaryFunds: number;
  debtAssetRatio: number;        // 资产负债率（%）
  // 利润（亿元）
  totalRevenue: number;
  totalRevenueYoY: number | null;
  parentNetProfit: number;
  parentNetProfitYoY: number | null;
  saleExpense: number;
  manageExpense: number;
  financeExpense: number;
  // 现金流（亿元）
  netCashOperate: number;
  salesServices: number;
  // 计算指标
  operatingCashToProfitRatio: number | null;  // 经营现金流/净利润（健康 > 1.0）
  salesCashToRevenueRatio: number | null;     // 销现/营收（高质量 > 1.0）
  expenseRatio: number | null;                // (销售+管理+财务)/营收（%）
  saleExpenseRatio: number | null;            // 销售费用率（%）
  manageExpenseRatio: number | null;          // 管理费用率（%）
}

// 主营业务构成（步骤 8 输入，作为客户/供应商依赖的代理指标）
export interface MainBusinessSegment {
  name: string;        // 类目名称
  income: number;      // 营业收入（亿元）
  ratio: number;       // 占总营收比（0~1）
  grossMargin: number; // 毛利率（0~1）
}

export interface MainBusinessComposition {
  reportDate: string;
  reportName: string;
  byProduct: MainBusinessSegment[];  // 按产品/行业
  byRegion: MainBusinessSegment[];   // 按地区
  productCR1: number;   // 最大产品占比
  productCR3: number;   // 前三大产品合计占比
  regionCR1: number;    // 最大地区占比
}

// 完整的分析数据上下文
export interface DataContext {
  stockCode: string;
  realtime: RealtimeQuote;
  kline: KLineData[];
  technical: TechnicalIndicators;
  valuation: ValuationMetrics;
  financials?: FinancialData[];
  peerComparison?: PeerComparison | null;
  insiderTrading?: InsiderTrading | null;
  financialRisk?: FinancialRiskMetrics | null;
  mainBusiness?: MainBusinessComposition | null;
  summaries?: string[];
  stepSummaries?: Record<number, string>;  // 按步骤 ID 索引的摘要（用于上下文裁剪）
}
