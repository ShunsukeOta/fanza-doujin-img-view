import "server-only";

import { assetLabel, feedRowFromItem, initialScanStats, safeErrorMessage } from "@/lib/fanza";
import type { AssetType, FeedItem, FloorInfo, SampleStats } from "@/lib/types";

const API_BASE = "https://api.dmm.com/affiliate/v3";
const REQUEST_TIMEOUT_MS = 25_000;
const HITS = 100;
const MAX_PAGES = 8;
const FEED_LIMIT = 20;
const REQUEST_INTERVAL_MS = 120;

type UnknownRecord = Record<string, unknown>;

export type CatalogFilters = {
  minSamples: number;
  minReviews: number;
  minRating: number;
  assetType: AssetType;
  genreId: string;
};

export type FastCatalogResult = {
  items: FeedItem[];
  scanned: number;
  apiTotal: number;
  effectiveMinSamples: number;
  stats: SampleStats;
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
        "User-Agent": "fanza-doujin-img-view-next/1.1",
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

function buildParams(page: number, genreId: string): Record<string, string | number> {
  const params: Record<string, string | number> = {
    hits: HITS,
    offset: 1 + page * HITS,
    sort: "review",
  };
  if (genreId) {
    params.article = "genre";
    params.article_id = genreId;
  }
  return params;
}

/**
 * 通常表示用。20件揃った時点で走査を打ち切る。
 * 以前は診断統計のため常に最大800件走査していたため、初動が遅かった。
 */
export async function fetchFastCatalog(
  floor: FloorInfo,
  filters: CatalogFilters,
): Promise<FastCatalogResult> {
  const items: FeedItem[] = [];
  const seen = new Set<string>();
  const stats = initialScanStats();
  const effectiveMinSamples = Math.max(1, filters.minSamples);
  let scanned = 0;
  let apiTotal = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await itemListRequest(floor, buildParams(page, filters.genreId));
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

      if (filters.genreId && !itemHasGenre(rawItem, filters.genreId)) continue;
      if (filters.assetType !== "all" && item.assetType !== filters.assetType) continue;
      if (item.sampleCount < effectiveMinSamples) continue;
      if (item.reviews < filters.minReviews) continue;
      if (item.rating < filters.minRating) continue;

      items.push({ ...item, assetLabel: assetLabel(item.assetType) });
      if (items.length >= FEED_LIMIT) {
        return { items, scanned, apiTotal, stats, effectiveMinSamples };
      }
    }

    const resultCount = numberValue(result.result_count) || rows.length;
    if (rows.length < HITS || resultCount < HITS) break;
    if (page + 1 < MAX_PAGES) await sleep(REQUEST_INTERVAL_MS);
  }

  return { items, scanned, apiTotal, stats, effectiveMinSamples };
}

/**
 * API診断専用。フィード表示とは切り離し、ユーザーが絞り込みシートを開いた時だけ最大800件走査する。
 */
export async function scanCatalogDiagnostics(
  floor: FloorInfo,
  genreId: string,
): Promise<DiagnosticsResult> {
  const stats = initialScanStats();
  const seen = new Set<string>();
  let scanned = 0;
  let apiTotal = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await itemListRequest(floor, buildParams(page, genreId));
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
    if (page + 1 < MAX_PAGES) await sleep(REQUEST_INTERVAL_MS);
  }

  return { scanned, apiTotal, stats };
}
