export type FloorInfo = {
  siteCode: string;
  siteName: string;
  serviceCode: string;
  serviceName: string;
  floorCode: string;
  floorName: string;
  floorId: string;
};

export type Genre = { id: string; name: string; ruby: string };

export type SaveState = {
  cid: string;
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
  series?: string[];
  maker?: string;
  makerId?: string;
  price: string;
  priceValue?: number | null;
  savedPriceValue?: number | null;
  priceDropValue?: number | null;
  available?: boolean;
  availabilityStatus?: string;
  feedId?: string | null;
  rank?: number;
  recommendationSource?: string;
  viewerSaved?: boolean;
};

export type CatalogResponse = {
  items: FeedItem[];
  scanned: number;
  apiTotal: number;
  effectiveMinSamples: number;
  floor: FloorInfo;
  queryError: string;
  feedId: string | null;
  cursor: number;
  nextCursor: number | null;
  hasMore: boolean;
  source: "database" | "fanza-api";
  recommenderVersion: string;
};

export type MetaResponse = {
  floor: FloorInfo;
  genres: Genre[];
  recommenderVersion?: string;
};

export type FilterValues = {
  genreId: string;
  minSamples: number;
  minReviews: number;
  minRating: number;
  minPrice: number;
  maxPrice: number;
  query: string;
};
