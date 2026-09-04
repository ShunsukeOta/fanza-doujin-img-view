import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { FocusModeToggle } from "@/components/FocusModeToggle";
import { MyPage } from "@/components/MyPage";
import { SavedPage } from "@/components/SavedPage";
import { SwipePreviewApp } from "@/components/SwipePreviewApp";
import type { AssetType, FilterValues } from "@/lib/types";
import "@/styles/globals.css";
import "@/styles/navigation.css";
import "@/styles/pages.css";
import "@/styles/page-scroll.css";
import "@/styles/reader.css";
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
  minSamples: boundedInt(params, "min_samples", 1, 1, 100),
  minReviews: boundedInt(params, "min_reviews", 0, 0, 100_000),
  minRating: boundedFloat(params, "min_rating", 0, 0, 5),
};

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません。");

if (pathname === "/favorites") {
  window.location.replace("/saved");
} else {
  let app: ReactNode;
  if (pathname === "/saved") {
    app = <SavedPage />;
  } else if (pathname === "/mypage") {
    app = <MyPage />;
  } else {
    app = (
      <>
        <SwipePreviewApp initialFilters={initialFilters} initialCid={params.get("cid") ?? ""} />
        <FocusModeToggle />
      </>
    );
  }

  createRoot(root).render(<StrictMode>{app}</StrictMode>);
  if (pathname !== "/saved" && pathname !== "/mypage") startAnalytics();
}
