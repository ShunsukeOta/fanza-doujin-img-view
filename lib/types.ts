export type AssetType = "all" | "comic" | "cg" | "game" | "voice" | "other";

export type FloorInfo = {
  siteCode: string;
  siteName: string;
  serviceCode: string;
  serviceName: string;
  floorCode: string;
  floorName: string;
  floorId: string;
};

export type Genre = {
  id: string;
  name: string;
  ruby: string;
};

export type AssetTypeDefinition = {
  key: AssetType;
  label: string;
};

export type FeedItem = {
  cid: string;
  title: string;
  affiliateUrl: string;
  images: string[];
  sampleCount: number;
  reviews: number;
  rating: number;
  genres: string[];
  price: string;
  assetBucket: string;
  assetType: Exclude<AssetType, "all">;
  assetLabel: string;
};

export type SampleStatsRow = {
  total: number;
  zero: number;
  oneToFour: number;
  fiveToNine: number;
  tenPlus: number;
};

export type SampleStats = Record<AssetType, SampleStatsRow> & {
  rawBuckets: Record<string, number>;
};

export type CatalogResponse = {
  items: FeedItem[];
  scanned: number;
  apiTotal: number;
  effectiveMinSamples: number;
  floor: FloorInfo;
  queryError: string;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
  source: "database" | "fanza-api";
};

export type DiagnosticsResponse = {
  scanned: number;
  apiTotal: number;
  stats: SampleStats;
};

export type MetaResponse = {
  floor: FloorInfo;
  genres: Genre[];
  assetTypes: AssetTypeDefinition[];
};

export type FilterValues = {
  assetType: AssetType;
  genreId: string;
  minSamples: number;
  minReviews: number;
  minRating: number;
};
