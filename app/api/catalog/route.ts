import { NextRequest, NextResponse } from "next/server";

import {
  assetTypeDefinitions,
  feedRowFromItem,
  fetchCatalog,
  fetchItem,
  normalizeCid,
  resolveDoujinFloor,
  safeErrorMessage,
} from "@/lib/fanza";
import type { AssetType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function readInt(params: URLSearchParams, key: string, fallback: number, min: number, max: number) {
  const raw = params.get(key);
  const parsed = raw === null || raw === "" ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readFloat(params: URLSearchParams, key: string, fallback: number, min: number, max: number) {
  const raw = params.get(key);
  const parsed = raw === null || raw === "" ? fallback : Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readAssetType(params: URLSearchParams): AssetType {
  const raw = (params.get("asset_type") ?? params.get("category") ?? "all") as AssetType;
  return assetTypeDefinitions().some((definition) => definition.key === raw) ? raw : "all";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const filters = {
    minSamples: readInt(params, "min_samples", 10, 0, 100),
    minReviews: readInt(params, "min_reviews", 10, 0, 100_000),
    minRating: readFloat(params, "min_rating", 4.5, 0, 5),
    assetType: readAssetType(params),
    genreId: (params.get("genre_id") ?? "").trim(),
  };
  const cidInput = (params.get("cid") ?? "").trim();

  try {
    const floor = await resolveDoujinFloor();
    const catalog = await fetchCatalog(floor, filters);
    let items = catalog.items;
    let queryError = "";

    if (cidInput) {
      try {
        const cid = normalizeCid(cidInput);
        const directItem = feedRowFromItem(await fetchItem(cid, floor));
        if (directItem.images.length === 0) {
          throw new Error("指定した作品には sampleImageURL.sample_l.image がありません。");
        }
        items = [directItem, ...items.filter((item) => item.cid !== directItem.cid)];
      } catch (error) {
        queryError = safeErrorMessage(error);
      }
    }

    return NextResponse.json(
      { ...catalog, items, floor, queryError },
      {
        headers: cidInput
          ? { "Cache-Control": "private, no-store" }
          : { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
      },
    );
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
