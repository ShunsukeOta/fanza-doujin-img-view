import "server-only";

import type {
  AssetType,
  AssetTypeDefinition,
  CatalogResponse,
  FeedItem,
  FloorInfo,
  Genre,
  SampleStats,
  SampleStatsRow,
} from "@/lib/types";

const API_BASE = "https://api.dmm.com/affiliate/v3";
const REQUEST_TIMEOUT_MS = 25_000;
const CATALOG_HITS = 100;
const CATALOG_PAGES = 8;
const CATALOG_LIMIT = 20;
const REQUEST_INTERVAL_MS = 350;

class FanzaApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FanzaApiError";
  }
}

type UnknownRecord = Record<string, unknown>;

type DmmRequestOptions = {
  revalidate?: number;
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
  const item = record.item;
  if (Array.isArray(item)) {
    return item.filter(
      (row): row is UnknownRecord => row !== null && typeof row === "object" && !Array.isArray(row),
    );
  }
  if (Object.keys(record).length > 0) return [record];
  return [];
}

function getEnv() {
  const apiId = process.env.DMM_API_ID?.trim() ?? "";
  const affiliateId = process.env.DMM_AFFILIATE_ID?.trim() ?? "";

  if (!apiId || !affiliateId) {
    throw new FanzaApiError(
      "DMM_API_ID または DMM_AFFILIATE_ID が設定されていません。VercelのEnvironment Variablesを確認してください。",
    );
  }

  return { apiId, affiliateId };
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function dmmRequest(
  endpointName: "FloorList" | "GenreSearch" | "ItemList",
  params: Record<string, string | number>,
  options: DmmRequestOptions = {},
): Promise<UnknownRecord> {
  const { apiId, affiliateId } = getEnv();
  const search = new URLSearchParams({
    api_id: apiId,
    affiliate_id: affiliateId,
    output: "json",
  });

  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }

  const requestUrl = `${API_BASE}/${endpointName}?${search.toString()}`;
  const init: RequestInit & { next?: { revalidate: number } } = {
    headers: {
      Accept: "application/json",
      "User-Agent": "fanza-doujin-img-view-next/1.0",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };

  if (typeof options.revalidate === "number") {
    init.next = { revalidate: options.revalidate };
  } else {
    init.cache = "no-store";
  }

  let response: Response;
  try {
    response = await fetch(requestUrl, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new FanzaApiError(`DMM Webサービスへの接続に失敗しました: ${message}`);
  }

  if (!response.ok) {
    throw new FanzaApiError(`DMM WebサービスがHTTP ${response.status}を返しました。`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new FanzaApiError("DMM WebサービスのレスポンスをJSONとして解析できませんでした。");
  }

  const root = asRecord(data);
  const result = asRecord(root.result);
  const status = stringValue(result.status);
  if (status && status !== "200") {
    const message = stringValue(result.message) || "APIエラーが発生しました。";
    throw new FanzaApiError(`${endpointName}: ${message}`);
  }

  return root;
}

function resultOf(data: UnknownRecord): UnknownRecord {
  return asRecord(data.result);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assetTypeDefinitions(): AssetTypeDefinition[] {
  return [
    { key: "all", label: "すべて" },
    { key: "comic", label: "コミック系" },
    { key: "cg", label: "CG・イラスト系" },
    { key: "game", label: "ゲーム系" },
    { key: "voice", label: "ボイス・音声系" },
    { key: "other", label: "その他・不明" },
  ];
}

export function assetLabel(type: AssetType): string {
  return assetTypeDefinitions().find((definition) => definition.key === type)?.label ?? "その他・不明";
}

export async function resolveDoujinFloor(): Promise<FloorInfo> {
  const data = await dmmRequest("FloorList", {}, { revalidate: 7 * 24 * 60 * 60 });
  const result = resultOf(data);

  for (const site of normalizeRows(result.site)) {
    if (stringValue(site.code) !== "FANZA") continue;

    for (const service of normalizeRows(site.service)) {
      if (stringValue(service.code) !== "doujin") continue;

      for (const floor of normalizeRows(service.floor)) {
        if (stringValue(floor.code) !== "digital_doujin") continue;
        const floorId = stringValue(floor.id);
        if (!floorId) {
          throw new FanzaApiError("FloorListでdigital_doujinのfloor_idを取得できませんでした。");
        }

        return {
          siteCode: "FANZA",
          siteName: stringValue(site.name) || "FANZA",
          serviceCode: "doujin",
          serviceName: stringValue(service.name) || "同人",
          floorCode: "digital_doujin",
          floorName: stringValue(floor.name) || "同人",
          floorId,
        };
      }
    }
  }

  throw new FanzaApiError("FloorListに FANZA / doujin / digital_doujin が見つかりませんでした。");
}

function normalizeGenreRows(data: UnknownRecord): Genre[] {
  const result = resultOf(data);
  const map = new Map<string, Genre>();

  for (const row of normalizeRows(result.genre)) {
    const id = stringValue(row.genre_id) || stringValue(row.id);
    const name = stringValue(row.name).trim();
    if (!id || !name) continue;
    map.set(id, { id, name, ruby: stringValue(row.ruby) });
  }

  return [...map.values()];
}

export async function fetchGenres(floorId: string): Promise<Genre[]> {
  const genres = new Map<string, Genre>();
  const hits = 100;

  for (let page = 0; page < 10; page += 1) {
    const data = await dmmRequest(
      "GenreSearch",
      { floor_id: floorId, hits, offset: 1 + page * hits },
      { revalidate: 24 * 60 * 60 },
    );
    const rows = normalizeGenreRows(data);
    rows.forEach((genre) => genres.set(genre.id, genre));

    const result = resultOf(data);
    const resultCount = numberValue(result.result_count) || rows.length;
    const totalCount = numberValue(result.total_count);
    if (resultCount < hits || (totalCount > 0 && genres.size >= totalCount)) break;
    await sleep(150);
  }

  return [...genres.values()].sort((a, b) =>
    (a.ruby || a.name).localeCompare(b.ruby || b.name, "ja", { numeric: true }),
  );
}

async function itemList(
  floor: FloorInfo,
  params: Record<string, string | number>,
): Promise<UnknownRecord> {
  return dmmRequest("ItemList", {
    site: floor.siteCode,
    service: floor.serviceCode,
    floor: floor.floorCode,
    ...params,
  });
}

export async function fetchItem(cid: string, floor: FloorInfo): Promise<UnknownRecord> {
  const data = await itemList(floor, { cid, hits: 1 });
  const items = normalizeRows(resultOf(data).items);
  if (items.length === 0) {
    throw new FanzaApiError("このCIDは現在のFANZA同人APIでは取得できません。");
  }
  return items[0];
}

export function normalizeCid(input: string): string {
  let value = input.trim();
  if (!value) return "";

  const pathMatch = value.match(/(?:^|\/)cid=([^/?#&]+)/i);
  const queryMatch = value.match(/[?&]cid=([^&#]+)/i);
  if (pathMatch) value = pathMatch[1];
  else if (queryMatch) value = queryMatch[1];

  try {
    value = decodeURIComponent(value);
  } catch {
    throw new FanzaApiError("CIDをURLデコードできませんでした。");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new FanzaApiError("作品IDの形式が正しくありません。CIDまたはFANZA同人の商品URLを入力してください。");
  }

  return value;
}

function sampleImages(item: UnknownRecord): string[] {
  const sampleImageUrl = asRecord(item.sampleImageURL);
  const sampleLarge = asRecord(sampleImageUrl.sample_l);
  const images = sampleLarge.image;
  if (!Array.isArray(images)) return [];

  return [...new Set(images.filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url)))];
}

function itemGenres(item: UnknownRecord): Genre[] {
  const itemInfo = asRecord(item.iteminfo);
  const result: Genre[] = [];

  for (const row of normalizeRows(itemInfo.genre)) {
    const name = stringValue(row.name).trim();
    if (!name) continue;
    result.push({
      id: stringValue(row.id) || stringValue(row.genre_id),
      name,
      ruby: stringValue(row.ruby),
    });
  }
  return result;
}

function itemAssetUrls(item: UnknownRecord): string[] {
  const imageUrl = asRecord(item.imageURL);
  const urls = [imageUrl.large, imageUrl.list, imageUrl.small]
    .filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url));
  return [...new Set([...urls, ...sampleImages(item)])];
}

function detectAssetBucket(item: UnknownRecord): string {
  for (const url of itemAssetUrls(item)) {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\/digital\/([^/]+)\//i);
      if (!match) continue;
      const bucket = match[1].toLowerCase();
      return ["comic", "cg", "game", "voice"].includes(bucket) ? bucket : `other:${bucket}`;
    } catch {
      continue;
    }
  }
  return "unknown";
}

function normalizedAssetType(bucket: string): Exclude<AssetType, "all"> {
  if (bucket === "comic" || bucket === "cg" || bucket === "game" || bucket === "voice") {
    return bucket;
  }
  return "other";
}

function itemHasGenreId(item: UnknownRecord, genreId: string): boolean {
  if (!genreId) return true;
  return itemGenres(item).some((genre) => genre.id === genreId);
}

export function feedRowFromItem(item: UnknownRecord): FeedItem {
  const images = sampleImages(item);
  const bucket = detectAssetBucket(item);
  const assetType = normalizedAssetType(bucket);
  const review = asRecord(item.review);
  const prices = asRecord(item.prices);

  return {
    cid: stringValue(item.content_id),
    title: stringValue(item.title),
    affiliateUrl: stringValue(item.affiliateURL),
    images,
    sampleCount: images.length,
    reviews: Math.trunc(numberValue(review.count)),
    rating: numberValue(review.average),
    genres: itemGenres(item).map((genre) => genre.name),
    price: stringValue(prices.price),
    assetBucket: bucket,
    assetType,
    assetLabel: assetLabel(assetType),
  };
}

function emptySampleStats(): SampleStatsRow {
  return { total: 0, zero: 0, oneToFour: 0, fiveToNine: 0, tenPlus: 0 };
}

export function initialScanStats(): SampleStats {
  return {
    all: emptySampleStats(),
    comic: emptySampleStats(),
    cg: emptySampleStats(),
    game: emptySampleStats(),
    voice: emptySampleStats(),
    other: emptySampleStats(),
    rawBuckets: {},
  };
}

function incrementSampleStats(
  stats: SampleStats,
  type: Exclude<AssetType, "all">,
  rawBucket: string,
  sampleCount: number,
) {
  for (const key of ["all", type] as const) {
    const row = stats[key];
    row.total += 1;
    if (sampleCount === 0) row.zero += 1;
    else if (sampleCount <= 4) row.oneToFour += 1;
    else if (sampleCount <= 9) row.fiveToNine += 1;
    else row.tenPlus += 1;
  }

  if (type === "other") {
    stats.rawBuckets[rawBucket] = (stats.rawBuckets[rawBucket] ?? 0) + 1;
  }
}

type CatalogFilters = {
  minSamples: number;
  minReviews: number;
  minRating: number;
  assetType: AssetType;
  genreId: string;
};

export async function fetchCatalog(
  floor: FloorInfo,
  filters: CatalogFilters,
): Promise<Omit<CatalogResponse, "floor" | "queryError">> {
  const items: FeedItem[] = [];
  const seen = new Set<string>();
  const stats = initialScanStats();
  const effectiveMinSamples = Math.max(1, filters.minSamples);
  let scanned = 0;
  let apiTotal = 0;

  for (let page = 0; page < CATALOG_PAGES; page += 1) {
    const params: Record<string, string | number> = {
      hits: CATALOG_HITS,
      offset: 1 + page * CATALOG_HITS,
      sort: "review",
    };
    if (filters.genreId) {
      params.article = "genre";
      params.article_id = filters.genreId;
    }

    const data = await itemList(floor, params);
    const result = resultOf(data);
    const rows = normalizeRows(result.items);
    if (rows.length === 0) break;

    if (page === 0) apiTotal = numberValue(result.total_count);
    scanned += rows.length;

    for (const item of rows) {
      const row = feedRowFromItem(item);
      if (!row.cid || seen.has(row.cid)) continue;
      seen.add(row.cid);
      incrementSampleStats(stats, row.assetType, row.assetBucket, row.sampleCount);

      if (filters.genreId && !itemHasGenreId(item, filters.genreId)) continue;
      if (filters.assetType !== "all" && row.assetType !== filters.assetType) continue;
      if (row.sampleCount < effectiveMinSamples) continue;
      if (row.reviews < filters.minReviews) continue;
      if (row.rating < filters.minRating) continue;
      if (items.length < CATALOG_LIMIT) items.push(row);
    }

    const resultCount = numberValue(result.result_count) || rows.length;
    if (rows.length < CATALOG_HITS || resultCount < CATALOG_HITS) break;
    if (page + 1 < CATALOG_PAGES) await sleep(REQUEST_INTERVAL_MS);
  }

  return { items, scanned, apiTotal, stats, effectiveMinSamples };
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "予期しないエラーが発生しました。";
}

export function environmentStatus() {
  return {
    DMM_API_ID: Boolean(process.env.DMM_API_ID?.trim()),
    DMM_AFFILIATE_ID: Boolean(process.env.DMM_AFFILIATE_ID?.trim()),
  };
}
