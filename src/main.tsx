import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { SwipePreviewApp } from "@/components/SwipePreviewApp";
import type { AssetType, FilterValues } from "@/lib/types";
import "@/styles/globals.css";
import { startAnalytics } from "@/src/analytics";

const ASSET_TYPES = new Set<AssetType>(["all", "comic", "cg", "game", "voice", "other"]);

function boundedInt(params: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(params.get(key) ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function boundedFloat(params: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(params.get(key) ?? "");
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

const params = new URLSearchParams(window.location.search);
const rawAssetType = (params.get("asset_type") ?? params.get("category") ?? "all") as AssetType;
const initialFilters: FilterValues = {
  assetType: ASSET_TYPES.has(rawAssetType) ? rawAssetType : "all",
  genreId: params.get("genre_id") ?? "",
  minSamples: boundedInt(params, "min_samples", 10, 0, 100),
  minReviews: boundedInt(params, "min_reviews", 10, 0, 100_000),
  minRating: boundedFloat(params, "min_rating", 4.5, 0, 5),
};

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません。");

createRoot(root).render(
  <StrictMode>
    <SwipePreviewApp initialFilters={initialFilters} initialCid={params.get("cid") ?? ""} />
  </StrictMode>,
);

startAnalytics();
