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

export type ReactionSummary = {
  cid: string;
  likeCount: number;
  saveCount: number;
  viewerLiked: boolean;
  viewerSaved: boolean;
};

export type FeedItem = {
  cid: string;
  title: string;
  affiliateUrl: string;
  images: string[];
  sampleCount: number;
  fullPageCount?: number | null;
  reviews: number;
  rating: number;
  genres: string[];
  price: string;
  assetBucket: string;
  assetType: Exclude<AssetType, "all">;
  assetLabel: string;
  likeCount: number;
  saveCount: number;
  viewerLiked: boolean;
  viewerSaved: boolean;
};

export type WorkDebugSnapshot = {
  item: FeedItem;
  index: number;
  currentPage: number;
  loadedImages: number;
  failedImages: number;
  pendingImages: number;
  liked: boolean;
  saved: boolean;
  likeCount: number;
  saveCount: number;
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

export type DebugDatabaseCounts = {
  works: number;
  activeWorks: number;
  worksWithSamples: number;
  defaultEligibleWorks: number;
  genres: number;
  workGenres: number;
  anonymousUsers: number;
  events: number;
  userWorkStates: number;
  userGenreScores: number;
};

export type DebugServerResponse = {
  ok: boolean;
  generatedAt: string;
  runtime: {
    php: string;
    sapi: string;
  };
  database: {
    configured: boolean;
    connected: boolean;
    catalogReady: boolean;
    driver: string | null;
    serverVersion: string | null;
    sizeBytes: number | null;
    counts: DebugDatabaseCounts;
    latest: {
      workUpdatedAt: string | null;
      eventAt: string | null;
      userSeenAt: string | null;
    };
    assetCounts: Record<string, number>;
    eventCounts24h: Record<string, number>;
  };
  dmm: {
    configured: boolean;
  };
  retention: {
    eventDays: number;
    profileDays: number;
    syncPages: number;
  };
  diagnostics: DiagnosticsResponse | null;
  diagnosticsError: string | null;
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
  minPrice: number;
  maxPrice: number;
};
