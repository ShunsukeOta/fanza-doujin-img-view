import { SwipePreviewAppOptimized } from "@/components/SwipePreviewAppOptimized";
import type { AssetType, FilterValues } from "@/lib/types";

type SearchValue = string | string[] | undefined;
type SearchParams = Record<string, SearchValue>;

const ASSET_TYPES = new Set<AssetType>(["all", "comic", "cg", "game", "voice", "other"]);

function first(value: SearchValue): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function boundedInt(value: SearchValue, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(first(value), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function boundedFloat(value: SearchValue, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(first(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const rawAssetType = (first(params.asset_type) || first(params.category) || "all") as AssetType;
  const initialFilters: FilterValues = {
    assetType: ASSET_TYPES.has(rawAssetType) ? rawAssetType : "all",
    genreId: first(params.genre_id),
    minSamples: boundedInt(params.min_samples, 10, 0, 100),
    minReviews: boundedInt(params.min_reviews, 10, 0, 100_000),
    minRating: boundedFloat(params.min_rating, 4.5, 0, 5),
  };

  return <SwipePreviewAppOptimized initialFilters={initialFilters} initialCid={first(params.cid)} />;
}
