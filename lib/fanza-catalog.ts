import "server-only";

import { assetLabel, feedRowFromItem, initialScanStats, safeErrorMessage } from "@/lib/fanza";
import type { AssetType, FeedItem, FloorInfo, SampleStats } from "@/lib/types";

const API_BASE = "https://api.dmm.com/affiliate/v3";
const REQUEST_TIMEOUT_MS = 25_000;
const HITS = 100;
const DIAGNOSTIC_MAX_PAGES = 8;
const REQUEST_INTERVAL_MS = 120;

type UnknownRecord = Record<string, unknown>;

export type CatalogFilters = {
  minSamples: number;
  minReviews: number;
  minRating: number;
  assetType: AssetType;
  genreId: string;
};

export type CatalogBatchResult = {
  items: FeedItem[];
  scanned: number;
  apiTotal: number;
  effectiveMinSamples: number;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
};

export type DiagnosticsResult = {
  scanned: number;
  apiTotal: number;
  stats: SampleStats;
};

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function normalizeRows(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is UnknownRecord => row !== null && typeof row === "object" && !Array.isArray(row),
    );
  }

  const record = asRecord(value);
  if (Array.isArray(record.item)) {
    return record.item.filter(
      (row): row is UnknownRecord => row !== null && typeof row === "object" && !Array.isArray(row),
    );
  }
  return Object.keys(record).length > 0 ? [record] : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getEnv() {
  const apiId = process.env.DMM_API_ID?.trim() ?? "";
  const affiliateId = process.env.DMM_AFFILIATE_ID?.trim() ?? "";
  if (!apiId || !affiliateId) {
    throw new Error("DMM_API_ID または DMM_AFFILIATE_ID が設定されていません。");
  }
  return { apiId, affiliateId };
}

async function itemListRequest(
  floor: FloorInfo,
  params: Record<string, string | number>,
): Promise<UnknownRecord> {
  const { apiId, affiliateId } = getEnv();
  const query = new URLSearchParams({
    api_id: apiId,
    affiliate_id: affiliateId,
    output: "json",
    site: floor.siteCode,
    service: floor.serviceCode,
    floor: floor.floorCode,
  });

  for (const [key, value] of Object.entries(params)) query.set(key, String(value));

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/ItemList?${query.toString()}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "fanza-doujin-img-view-next/1.2",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`DMM Webサービスへの接続に失敗しました: ${safeErrorMessage(error)}`);
  }

  if (!response.ok) throw new Error(`DMM WebサービスがHTTP ${response.status}を返しました。`);

  const data = (await response.json()) as unknown;
  const root = asRecord(data);
  const result = asRecord(root.result);
  const status = stringValue(result.status);
  if (status && status !== "200") {
    throw new Error(`ItemList: ${stringValue(result.message) || "APIエラーが発生しました。"}`);
  }
  return root;
}

function resultOf(data: UnknownRecord) {
  return asRecord(data.result);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function itemHasGenre(item: UnknownRecord, genreId: string): boolean {
  if (!genreId) return true;
  const itemInfo = asRecord(item.iteminfo);
  return normalizeRows(itemInfo.genre).some((genre) => {
    const id = stringValue(genre.id) || stringValue(genre.genre_id);
    return id === genreId;
  });
}

function incrementStats(stats: SampleStats, item: FeedItem) {
  const keys: AssetType[] = ["all", item.assetType];
  for (const key of keys) {
    const row = stats[key];
    row.total += 1;
    if (item.sampleCount === 0) row.zero += 1;
    else if (item.sampleCount <= 4) row.oneToFour += 1;
    else if (item.sampleCount <= 9) row.fiveToNine += 1;
    else row.tenPlus += 1;
  }
  if (item.assetType === "other") {
    stats.rawBuckets[item.assetBucket] = (stats.rawBuckets[item.assetBucket] ?? 0) + 1;
  }
}

function buildParams(offset: number, genreId: string): Record<string, string | number> {
  const params: Record<string, string | number> = {
    hits: HITS,
    offset,
    sort: "review",
  };
  if (genreId) {
    params.article = "genre";
    params.article_id = genreId;
  }
  return params;
}

/**
 * 通常フィード用。
 * DMM APIは1回100件だけ取得し、その中から最大limit件を返す。
 * 次の100件はnextOffsetを使ってクライアントが必要な時だけ取得する。
 */
export async function fetchCatalogBatch(
  floor: FloorInfo,
  filters: CatalogFilters,
  offset: number,
  limit: number,
): Promise<CatalogBatchResult> {
  const safeOffset = Math.max(1, Math.trunc(offset));
  const safeLimit = Math.max(1, Math.min(12, Math.trunc(limit)));
  const effectiveMinSamples = Math.max(1, filters.minSamples);
  const data = await itemListRequest(floor, buildParams(safeOffset, filters.genreId));
  const result = resultOf(data);
  const rows = normalizeRows(result.items);
  const apiTotal = numberValue(result.total_count);
  const resultCount = numberValue(result.result_count) || rows.length;
  const items: FeedItem[] = [];
  const seen = new Set<string>();

  for (const rawItem of rows) {
    const item = feedRowFromItem(rawItem);
    if (!item.cid || seen.has(item.cid)) continue;
    seen.add(item.cid);

    if (filters.genreId && !itemHasGenre(rawItem, filters.genreId)) continue;
    if (filters.assetType !== "all" && item.assetType !== filters.assetType) continue;
    if (item.sampleCount < effectiveMinSamples) continue;
    if (item.reviews < filters.minReviews) continue;
    if (item.rating < filters.minRating) continue;

    items.push({ ...item, assetLabel: assetLabel(item.assetType) });
    if (items.length >= safeLimit) break;
  }

  const candidateNextOffset = safeOffset + rows.length;
  const hasMoreByTotal = apiTotal > 0 ? candidateNextOffset <= apiTotal : rows.length >= HITS;
  const hasMore = rows.length > 0 && resultCount >= HITS && hasMoreByTotal;

  return {
    items,
    scanned: rows.length,
    apiTotal,
    effectiveMinSamples,
    offset: safeOffset,
    nextOffset: hasMore ? candidateNextOffset : null,
    hasMore,
  };
}

/**
 * API診断専用。通常フィードとは完全に分離し、最大800件を走査する。
 */
export async function scanCatalogDiagnostics(
  floor: FloorInfo,
  genreId: string,
): Promise<DiagnosticsResult> {
  const stats = initialScanStats();
  const seen = new Set<string>();
  let scanned = 0;
  let apiTotal = 0;

  for (let page = 0; page < DIAGNOSTIC_MAX_PAGES; page += 1) {
    const offset = 1 + page * HITS;
    const data = await itemListRequest(floor, buildParams(offset, genreId));
    const result = resultOf(data);
    const rows = normalizeRows(result.items);
    if (rows.length === 0) break;

    if (page === 0) apiTotal = numberValue(result.total_count);
    scanned += rows.length;

    for (const rawItem of rows) {
      const item = feedRowFromItem(rawItem);
      if (!item.cid || seen.has(item.cid)) continue;
      seen.add(item.cid);
      incrementStats(stats, item);
    }

    const resultCount = numberValue(result.result_count) || rows.length;
    if (rows.length < HITS || resultCount < HITS) break;
    if (page + 1 < DIAGNOSTIC_MAX_PAGES) await sleep(REQUEST_INTERVAL_MS);
  }

  return { scanned, apiTotal, stats };
}
