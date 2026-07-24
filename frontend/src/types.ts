export interface SourceRecord {
  name: string;
  url: string;
  usage: string;
}

export interface SoxMetrics {
  return1m?: number | null;
  return3m?: number | null;
  return6m?: number | null;
  return12m?: number | null;
  quarterlyRevenueYoY?: number | null;
  quarterlyEpsYoY?: number | null;
  quarterlyNetIncomeYoY?: number | null;
  netMargin?: number | null;
  trailingPe?: number | null;
  [key: string]: unknown;
}

export interface SoxScores {
  combined?: number | null;
  priceMomentum?: number | null;
  earningsMomentum?: number | null;
  label?: string;
}

export interface SoxConstituent {
  rank?: number | null;
  ticker: string;
  name?: string;
  indexName?: string;
  proxyWeight?: number | null;
  officialWeight?: number | null;
  price?: number | null;
  marketCap?: number | null;
  scores?: SoxScores;
  metrics?: SoxMetrics;
  dataQuality?: {
    pricePoints?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SoxLeader {
  rank?: number | null;
  ticker: string;
  name?: string;
  proxyWeight?: number | null;
  priceMomentum?: number | null;
  earningsMomentum?: number | null;
  combined?: number | null;
  return3m?: number | null;
  return12m?: number | null;
  quarterlyRevenueYoY?: number | null;
  quarterlyEpsYoY?: number | null;
  label?: string;
  [key: string]: unknown;
}

export interface SoxAnalysis {
  schemaVersion: 1;
  projectId: "sox";
  dataAsOf: string;
  generatedAt: string;
  constituents: SoxConstituent[];
  leaders: {
    combined?: SoxLeader[];
    priceMomentum?: SoxLeader[];
    earningsMomentum?: SoxLeader[];
    proxyWeight?: SoxLeader[];
  };
  coverage?: {
    price?: { count?: number; ratio?: number };
    marketCap?: { count?: number; ratio?: number };
    fundamentals?: { count?: number; ratio?: number };
  };
  index?: {
    constituentCount?: number;
    weightMethod?: string;
    weightMethodLabel?: string;
    constituentSource?: {
      tradeDate?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  status?: {
    level?: string;
    message?: string;
    publicPagesReadback?: string;
    [key: string]: unknown;
  };
  methodology?: {
    weightCaveat?: string;
    [key: string]: unknown;
  };
  sources?: Record<string, SourceRecord>;
  history?: {
    url?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SoxHistory {
  schemaVersion: 1;
  projectId: "sox";
  generatedAt: string;
  latestDataAsOf: string;
  snapshotCount: number;
  snapshots: SoxAnalysis[];
}

export type SortKey =
  | "rank"
  | "ticker"
  | "name"
  | "proxyWeight"
  | "price"
  | "marketCap"
  | "return3m"
  | "return12m"
  | "quarterlyRevenueYoY"
  | "quarterlyEpsYoY"
  | "trailingPe"
  | "priceMomentum"
  | "earningsMomentum"
  | "label";

export type SortDirection = "asc" | "desc";

export interface SoxViewState {
  snapshotDate: string;
  selectedTicker: string;
  searchQuery: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  theme: "light" | "dark";
}
