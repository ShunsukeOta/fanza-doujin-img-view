export type FeedFloorKey = "comic" | "amateur";
export type FeedMediaType = "comic" | "video";

export type FeedItem = {
  cid: string;
  floorKey: FeedFloorKey;
  mediaType: FeedMediaType;
  title: string;
  affiliateUrl: string;
  images: string[];
  sampleMovieUrl: string;
  sampleCount: number;
  fullPageCount?: number | null;
  reviews: number;
  rating: number;
  genres: string[];
  series: string[];
  price: string;
  priceValue?: number | null;
  maker: string;
  makerId?: string;
  available?: boolean;
  availabilityStatus?: string;
  feedId?: string | null;
  rank?: number | null;
  recommendationSource?: string;
  likeCount?: number;
  saveCount?: number;
  viewerLiked?: boolean;
  viewerSaved?: boolean;
  savedAt?: string;
  savedPriceValue?: number | null;
  priceDropValue?: number | null;
  viewedAt?: string;
};

export type FloorInfo = {
  key?: string;
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

export type CatalogResponse = {
  items: FeedItem[];
  feedId: string | null;
  cursor: number;
  nextCursor: number | null;
  hasMore: boolean;
  apiTotal: number;
  scanned: number;
  effectiveMinSamples: number;
  source: "database" | "fanza-api";
  queryError?: string;
  recommenderVersion?: string;
  floor: FloorInfo;
};
