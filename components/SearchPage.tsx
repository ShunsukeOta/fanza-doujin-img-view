import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { GlobalNav } from "@/components/GlobalNav";
import { ExternalIcon } from "@/components/icons";
import {
  WorkCardActions,
  WorkCardBody,
  WorkCardFrame,
  WorkCardMedia,
  WorkCardMeta,
  WorkCardTitle,
  WorkListFeedback,
} from "@/components/WorkCardPrimitives";
import type { FeedItem, MetaResponse } from "@/lib/types";
import { trackEvent } from "@/src/analytics";
import { fetchJson } from "@/src/api";
import { openWorkInMain } from "@/src/navigationState";
import { formatPrice } from "@/src/price";
import { isHttpUrl, mergeUniqueByCid } from "@/src/workUtils";

type SearchSort = "popular" | "rating" | "new" | "price_asc";

type SearchFilters = {
  query: string;
  maker: string;
  series: string;
  genreId: string;
  minPrice: string;
  maxPrice: string;
  minSamples: string;
  minReviews: string;
  minRating: number;
  sort: SearchSort;
};

type SearchResponse = {
  ok: boolean;
  items: FeedItem[];
  total: number;
  cursor: number;
  nextCursor: number | null;
  hasMore: boolean;
};

const RATING_OPTIONS = [1, 2, 3, 4, 5] as const;
const PAGE_SIZE = 24;

function boundedText(value: string | null, max: number): string {
  return (value ?? "").slice(0, max);
}

function boundedNumberText(value: string | null, min: number, max: number): string {
  if (!value || !/^\d+$/.test(value)) return "";
  const parsed = Number.parseInt(value, 10);
  return String(Math.max(min, Math.min(max, parsed)));
}

function parseFilters(): SearchFilters {
  const params = new URLSearchParams(window.location.search);
  const rawRating = params.get("min_rating") ?? "";
  const rawSort = params.get("sort") ?? "popular";
  const sort: SearchSort = ["popular", "rating", "new", "price_asc"].includes(rawSort)
    ? rawSort as SearchSort
    : "popular";
  return {
    query: boundedText(params.get("q"), 100),
    maker: boundedText(params.get("maker"), 100),
    series: boundedText(params.get("series"), 100),
    genreId: boundedText(params.get("genre_id"), 64),
    minPrice: boundedNumberText(params.get("min_price"), 0, 10_000_000),
    maxPrice: boundedNumberText(params.get("max_price"), 0, 10_000_000),
    minSamples: boundedNumberText(params.get("min_samples"), 1, 100),
    minReviews: boundedNumberText(params.get("min_reviews"), 0, 100_000),
    minRating: /^[1-5]$/.test(rawRating) ? Number.parseInt(rawRating, 10) : 0,
    sort,
  };
}

function effectiveInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function buildSearchParams(filters: SearchFilters, cursor = 0): URLSearchParams {
  const params = new URLSearchParams({
    cursor: String(cursor),
    limit: String(PAGE_SIZE),
    min_samples: String(effectiveInt(filters.minSamples, 1, 1, 100)),
    min_reviews: String(effectiveInt(filters.minReviews, 0, 0, 100_000)),
    min_rating: String(filters.minRating),
    sort: filters.sort,
  });
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.maker.trim()) params.set("maker", filters.maker.trim());
  if (filters.series.trim()) params.set("series", filters.series.trim());
  if (filters.genreId) params.set("genre_id", filters.genreId);
  const minPrice = effectiveInt(filters.minPrice, 0, 0, 10_000_000);
  const maxPrice = effectiveInt(filters.maxPrice, 0, 0, 10_000_000);
  if (minPrice > 0) params.set("min_price", String(minPrice));
  if (maxPrice > 0) params.set("max_price", String(maxPrice));
  return params;
}

function pageUrl(filters: SearchFilters): string {
  const params = buildSearchParams(filters);
  params.delete("cursor");
  params.delete("limit");
  if (effectiveInt(filters.minSamples, 1, 1, 100) === 1) params.delete("min_samples");
  if (effectiveInt(filters.minReviews, 0, 0, 100_000) === 0) params.delete("min_reviews");
  if (filters.minRating === 0) params.delete("min_rating");
  if (filters.sort === "popular") params.delete("sort");
  const query = params.toString();
  return `/search${query ? `?${query}` : ""}`;
}

export function SearchPage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [draft, setDraft] = useState<SearchFilters>(() => parseFilters());
  const [applied, setApplied] = useState<SearchFilters>(() => parseFilters());
  const [items, setItems] = useState<FeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const priceInvalid = useMemo(() => {
    const min = effectiveInt(draft.minPrice, 0, 0, 10_000_000);
    const max = effectiveInt(draft.maxPrice, 0, 0, 10_000_000);
    return min > 0 && max > 0 && max < min;
  }, [draft.maxPrice, draft.minPrice]);

  const runSearch = useCallback(async (filters: SearchFilters, cursor = 0, append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    setError("");
    try {
      const data = await fetchJson<SearchResponse>(
        `/api/search?${buildSearchParams(filters, cursor)}`,
        { headers: { Accept: "application/json", "Cache-Control": "no-cache" }, credentials: "same-origin", cache: "no-store" },
        "検索結果を取得できませんでした",
      );
      setItems((current) => append ? mergeUniqueByCid(current, data.items ?? []) : data.items ?? []);
      setTotal(data.total ?? 0);
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "検索結果を取得できませんでした。");
      if (!append) {
        setItems([]);
        setTotal(0);
      }
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJson<MetaResponse>(
      "/api/meta",
      { headers: { Accept: "application/json" }, credentials: "same-origin" },
      "ジャンル情報を取得できませんでした",
    ).then(setMeta).catch(() => setMeta(null));
  }, []);

  useEffect(() => {
    void runSearch(applied);
  }, [applied, runSearch]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (priceInvalid) return;
    const normalized: SearchFilters = {
      ...draft,
      query: draft.query.trim(),
      maker: draft.maker.trim(),
      series: draft.series.trim(),
      minSamples: draft.minSamples.trim(),
      minReviews: draft.minReviews.trim(),
      minPrice: draft.minPrice.trim(),
      maxPrice: draft.maxPrice.trim(),
    };
    window.history.replaceState(null, "", pageUrl(normalized));
    setApplied(normalized);
  };

  const clear = () => {
    const empty: SearchFilters = {
      query: "",
      maker: "",
      series: "",
      genreId: "",
      minPrice: "",
      maxPrice: "",
      minSamples: "",
      minReviews: "",
      minRating: 0,
      sort: "popular",
    };
    setDraft(empty);
    window.history.replaceState(null, "", "/search");
    setApplied(empty);
  };

  return (
    <div className="subpage-shell search-shell">
      <header className="subpage-header search-header"><h1>詳細検索</h1></header>

      <main className="subpage-content search-content">
        <form className="detail-search-form" onSubmit={submit}>
          <div className="detail-search-grid">
            <label className="detail-search-field detail-search-field--wide">
              <span>キーワード</span>
              <input type="search" maxLength={100} placeholder="作品名・サークル・シリーズ" value={draft.query} onChange={(event) => setDraft((current) => ({ ...current, query: event.target.value }))} />
            </label>
            <label className="detail-search-field">
              <span>ジャンル</span>
              <select value={draft.genreId} onChange={(event) => setDraft((current) => ({ ...current, genreId: event.target.value }))}>
                <option value="">すべて</option>
                {meta?.genres.map((genre) => <option value={genre.id} key={genre.id}>{genre.name}</option>)}
              </select>
            </label>
            <label className="detail-search-field"><span>サークル</span><input type="search" maxLength={100} placeholder="サークル名" value={draft.maker} onChange={(event) => setDraft((current) => ({ ...current, maker: event.target.value }))} /></label>
            <label className="detail-search-field detail-search-field--wide"><span>シリーズ</span><input type="search" maxLength={100} placeholder="シリーズ名" value={draft.series} onChange={(event) => setDraft((current) => ({ ...current, series: event.target.value }))} /></label>
            <label className="detail-search-field"><span>価格下限</span><input type="number" inputMode="numeric" min="0" max="10000000" placeholder="指定なし" value={draft.minPrice} onChange={(event) => setDraft((current) => ({ ...current, minPrice: event.target.value }))} /></label>
            <label className="detail-search-field"><span>価格上限</span><input type="number" inputMode="numeric" min="0" max="10000000" placeholder="指定なし" value={draft.maxPrice} onChange={(event) => setDraft((current) => ({ ...current, maxPrice: event.target.value }))} /></label>
            <label className="detail-search-field"><span>最低サンプル枚数</span><input type="number" inputMode="numeric" min="1" max="100" placeholder="空欄 = 1" value={draft.minSamples} onChange={(event) => setDraft((current) => ({ ...current, minSamples: event.target.value }))} /></label>
            <label className="detail-search-field"><span>最低レビュー件数</span><input type="number" inputMode="numeric" min="0" max="100000" placeholder="空欄 = 0" value={draft.minReviews} onChange={(event) => setDraft((current) => ({ ...current, minReviews: event.target.value }))} /></label>
            <fieldset className="detail-search-rating detail-search-field--wide">
              <legend>最低評価</legend>
              <div className="detail-rating-stars" role="group" aria-label="最低評価">
                {RATING_OPTIONS.map((rating) => (
                  <button type="button" className={draft.minRating >= rating ? "is-active" : ""} aria-pressed={draft.minRating === rating} aria-label={`評価${rating}以上${draft.minRating === rating ? "を解除" : ""}`} onClick={() => setDraft((current) => ({ ...current, minRating: current.minRating === rating ? 0 : rating }))} key={rating}>★</button>
                ))}
                <span>{draft.minRating ? `${draft.minRating}以上` : "未指定"}</span>
              </div>
            </fieldset>
            <label className="detail-search-field detail-search-field--wide">
              <span>並び順</span>
              <select value={draft.sort} onChange={(event) => setDraft((current) => ({ ...current, sort: event.target.value as SearchSort }))}>
                <option value="popular">人気順</option><option value="rating">評価順</option><option value="new">新着順</option><option value="price_asc">価格が安い順</option>
              </select>
            </label>
          </div>
          {priceInvalid ? <p className="detail-search-error">価格上限は価格下限以上にしてください。</p> : null}
          <div className="detail-search-actions">
            <button type="button" className="detail-search-clear" onClick={clear}>条件をクリア</button>
            <button type="submit" className="detail-search-submit" disabled={loading || priceInvalid}>{loading ? "検索中…" : "この条件で検索"}</button>
          </div>
        </form>

        <section className="search-results" aria-live="polite">
          <div className="search-results-head"><h2>検索結果</h2><span><strong>{total.toLocaleString("ja-JP")}</strong>件</span></div>
          {loading ? (
            <div className="subpage-state"><div className="spinner" aria-hidden="true" /><strong>作品を検索しています</strong></div>
          ) : error && items.length === 0 ? (
            <div className="subpage-state is-error"><strong>検索できませんでした</strong><p>{error}</p><button type="button" onClick={() => void runSearch(applied)}>再試行</button></div>
          ) : items.length === 0 ? (
            <div className="subpage-state"><strong>条件に一致する作品がありません</strong><p>条件を少し緩めて再検索してください。</p></div>
          ) : (
            <>
              <div className="work-grid search-result-grid">
                {items.map((item) => {
                  const canBuy = item.available !== false && isHttpUrl(item.affiliateUrl);
                  const priceLabel = formatPrice(item.price, item.priceValue ?? null);
                  return (
                    <WorkCardFrame className="search-result-card" key={item.cid}>
                      <button className="work-card-media search-result-thumb" type="button" onClick={() => openWorkInMain(item.cid)} aria-label={`${item.title}のサンプルを読む`}>
                        {item.images[0] ? <img src={item.images[0]} alt="" loading="lazy" decoding="async" /> : <span>画像なし</span>}
                        {item.viewerSaved ? <span className="search-result-saved">保存済み</span> : null}
                      </button>
                      <WorkCardBody>
                        <WorkCardTitle>{item.title || item.cid}</WorkCardTitle>
                        {item.maker ? <p className="work-card-subtitle">{item.maker}</p> : null}
                        <WorkCardMeta><span>★ {item.rating.toFixed(1)} <small>({item.reviews}件)</small></span>{priceLabel ? <span>{priceLabel}</span> : null}</WorkCardMeta>
                        {item.genres.length ? <p className="work-card-tags">{item.genres.slice(0, 3).join(" / ")}</p> : null}
                        {item.series?.length ? <p className="work-card-tags">{item.series.slice(0, 2).join(" / ")}</p> : null}
                        <WorkCardActions className={canBuy ? "has-buy" : ""}>
                          <button className="work-card-secondary" type="button" onClick={() => openWorkInMain(item.cid)}>サンプルを読む</button>
                          {canBuy ? (
                            <a className="work-card-primary search-result-buy" href={item.affiliateUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={() => trackEvent({ eventType: "affiliate_click", cid: item.cid, placement: "search", metadata: { rating: item.rating, reviews: item.reviews, priceValue: item.priceValue ?? null } }, true)}>
                              FANZAで見る <ExternalIcon />
                            </a>
                          ) : null}
                        </WorkCardActions>
                      </WorkCardBody>
                    </WorkCardFrame>
                  );
                })}
              </div>
              <WorkListFeedback error={error} hasMore={hasMore && nextCursor !== null} loadingMore={loadingMore} onLoadMore={() => { if (nextCursor !== null) void runSearch(applied, nextCursor, true); }} />
            </>
          )}
        </section>
      </main>

      <GlobalNav active="search" />
    </div>
  );
}
