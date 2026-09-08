import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { FocusModeToggle } from "@/components/FocusModeToggle";
import { GlobalNav } from "@/components/GlobalNav";
import { FilterIcon } from "@/components/icons";
import { WorkCard } from "@/components/WorkCard";
import type { AssetType, CatalogResponse, FeedItem, FilterValues, MetaResponse } from "@/lib/types";
import { fetchJson } from "@/src/api";
import { preloadAndDecodeImage } from "@/src/imagePreload";
import { formatPrice } from "@/src/price";
import {
  applyReaderControlsVisibility,
  loadReaderSettings,
  saveReaderSettings,
  type ReaderSettings,
} from "@/src/readerSettings";

const ASSET_LABELS: Record<AssetType, string> = {
  all: "すべて",
  comic: "コミック系",
  cg: "CG・イラスト系",
  game: "ゲーム系",
  voice: "ボイス・音声系",
  other: "その他・不明",
};
const DEFAULT_FILTERS: FilterValues = {
  assetType: "all",
  genreId: "",
  minSamples: 1,
  minReviews: 0,
  minRating: 0,
  minPrice: 0,
  maxPrice: 0,
  query: "",
};
const INITIAL_LIMIT = 6;
const PREFETCH_THRESHOLD = 3;
const WINDOW_RADIUS = 4;

type Props = { initialFilters: FilterValues; initialCid: string };

function buildCatalogQuery(
  filters: FilterValues,
  options: { feedId?: string | null; cursor?: number; limit?: number; cid?: string } = {},
) {
  const params = new URLSearchParams({
    asset_type: filters.assetType,
    genre_id: filters.genreId,
    min_samples: String(filters.minSamples),
    min_reviews: String(filters.minReviews),
    min_rating: String(filters.minRating),
    min_price: String(filters.minPrice),
    max_price: String(filters.maxPrice),
    q: filters.query,
    cursor: String(options.cursor ?? 0),
    limit: String(options.limit ?? INITIAL_LIMIT),
  });
  if (options.feedId) params.set("feed_id", options.feedId);
  if (options.cid?.trim()) params.set("cid", options.cid.trim());
  return params;
}

function buildPageQuery(filters: FilterValues, cid = "") {
  const params = new URLSearchParams();
  if (filters.assetType !== "all") params.set("asset_type", filters.assetType);
  if (filters.genreId) params.set("genre_id", filters.genreId);
  if (filters.minSamples !== 1) params.set("min_samples", String(filters.minSamples));
  if (filters.minReviews) params.set("min_reviews", String(filters.minReviews));
  if (filters.minRating) params.set("min_rating", String(filters.minRating));
  if (filters.minPrice) params.set("min_price", String(filters.minPrice));
  if (filters.maxPrice) params.set("max_price", String(filters.maxPrice));
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (cid.trim()) params.set("cid", cid.trim());
  return params;
}

function mergeUniqueItems(current: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  const seen = new Set(current.map((item) => item.cid));
  const additions = incoming.filter((item) => {
    if (!item.cid || seen.has(item.cid)) return false;
    seen.add(item.cid);
    return true;
  });
  return [...current, ...additions];
}

export function SwipePreviewApp({ initialFilters, initialCid }: Props) {
  const feedRef = useRef<HTMLElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const feedScrollRaf = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreInFlight = useRef<number | null>(null);
  const initialAbort = useRef<AbortController | null>(null);
  const moreAbort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const booted = useRef(false);
  const wheelLockedUntil = useRef(0);
  const pageByCid = useRef(new Map<string, number>());

  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [filters, setFilters] = useState(initialFilters);
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(() => loadReaderSettings());
  const [feedId, setFeedId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [metaError, setMetaError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeWork, setActiveWork] = useState(0);
  const [toast, setToast] = useState("");
  const [targetTotal, setTargetTotal] = useState(0);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1700);
  }, []);

  const updateReaderSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setReaderSettings((current) => ({ ...current, ...patch }));
  }, []);

  const toggleReaderControls = useCallback(() => {
    setReaderSettings((current) => ({ ...current, controlsHidden: !current.controlsHidden }));
  }, []);

  useEffect(() => {
    saveReaderSettings(readerSettings);
    applyReaderControlsVisibility(readerSettings.controlsHidden);
    return () => applyReaderControlsVisibility(false);
  }, [readerSettings]);

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await fetchJson<MetaResponse>(
        "/api/meta",
        { headers: { Accept: "application/json" } },
        "メタ情報の取得に失敗しました",
      ));
      setMetaError("");
    } catch (error) {
      setMetaError(error instanceof Error ? error.message : "メタ情報の取得に失敗しました。");
    }
  }, []);

  const loadInitial = useCallback(async (nextFilters: FilterValues, nextCid = "") => {
    const requestGeneration = ++generation.current;
    initialAbort.current?.abort();
    moreAbort.current?.abort();
    const controller = new AbortController();
    initialAbort.current = controller;
    loadMoreInFlight.current = null;
    setLoading(true);
    setLoadingMore(false);
    setCatalogError("");
    setLoadMoreError("");
    setActiveWork(0);
    setItems([]);
    setFeedId(null);
    setNextCursor(0);
    setHasMore(true);
    setTargetTotal(0);
    pageByCid.current.clear();
    feedRef.current?.scrollTo({ top: 0, behavior: "auto" });

    try {
      const query = buildCatalogQuery(nextFilters, { cursor: 0, limit: INITIAL_LIMIT, cid: nextCid });
      const catalog = await fetchJson<CatalogResponse>(
        `/api/catalog?${query}`,
        {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
        },
        "作品取得に失敗しました",
      );
      if (generation.current !== requestGeneration) return;
      setItems(catalog.items);
      setFeedId(catalog.feedId);
      setNextCursor(catalog.nextCursor);
      setHasMore(catalog.hasMore);
      setTargetTotal(catalog.apiTotal);
      if (catalog.queryError) showToast(catalog.queryError);
    } catch (error) {
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      setCatalogError(error instanceof Error ? error.message : "作品取得に失敗しました。");
      setHasMore(false);
      setNextCursor(null);
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
    }
  }, [showToast]);

  const loadMore = useCallback(async (manual = false) => {
    const requestGeneration = generation.current;
    if (loadMoreInFlight.current !== null || !hasMore || nextCursor === null) return;
    if (!manual && loadMoreError) return;

    loadMoreInFlight.current = requestGeneration;
    moreAbort.current?.abort();
    const controller = new AbortController();
    moreAbort.current = controller;
    setLoadingMore(true);
    if (manual) setLoadMoreError("");

    try {
      const query = buildCatalogQuery(filters, { feedId, cursor: nextCursor, limit: INITIAL_LIMIT });
      const catalog = await fetchJson<CatalogResponse>(
        `/api/catalog?${query}`,
        {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
        },
        "追加作品の取得に失敗しました",
      );
      if (generation.current !== requestGeneration) return;
      setItems((current) => mergeUniqueItems(current, catalog.items));
      setFeedId(catalog.feedId);
      setNextCursor(catalog.nextCursor);
      setHasMore(catalog.hasMore);
      setTargetTotal(catalog.apiTotal);
      setLoadMoreError("");
    } catch (error) {
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      setLoadMoreError(error instanceof Error ? error.message : "追加作品の取得に失敗しました");
    } finally {
      if (loadMoreInFlight.current === requestGeneration) loadMoreInFlight.current = null;
      if (generation.current === requestGeneration) setLoadingMore(false);
    }
  }, [feedId, filters, hasMore, loadMoreError, nextCursor]);

  const scrollToWork = useCallback((targetIndex: number, behavior: ScrollBehavior = "smooth") => {
    const feed = feedRef.current;
    if (!feed || items.length === 0) return;
    const next = Math.max(0, Math.min(items.length - 1, targetIndex));
    const target = feed.querySelector<HTMLElement>(`.feed-item[data-work-index="${next}"]`);
    if (target) feed.scrollTo({ top: target.offsetTop, behavior });
  }, [items.length]);

  const moveWork = useCallback((fromIndex: number, direction: -1 | 1) => {
    const target = fromIndex + direction;
    if (target < 0) {
      scrollToWork(0);
      return;
    }
    if (target >= items.length) {
      if (hasMore && !loadMoreError) void loadMore();
      return;
    }
    scrollToWork(target);
  }, [hasMore, items.length, loadMore, loadMoreError, scrollToWork]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void loadInitial(initialFilters, initialCid);
    void loadMeta();
  }, [initialCid, initialFilters, loadInitial, loadMeta]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || items.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.55)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target instanceof HTMLElement) {
        setActiveWork(Number(visible.target.dataset.workIndex ?? 0));
      }
    }, { root: feed, threshold: [0.55, 0.75, 0.9] });
    feed.querySelectorAll<HTMLElement>(".feed-item").forEach((work) => observer.observe(work));
    return () => observer.disconnect();
  }, [items]);

  useEffect(() => {
    if (loading || loadingMore || !hasMore || nextCursor === null || items.length === 0 || loadMoreError) return;
    if (activeWork >= items.length - PREFETCH_THRESHOLD) void loadMore();
  }, [activeWork, hasMore, items.length, loadMore, loadMoreError, loading, loadingMore, nextCursor]);

  useEffect(() => {
    const nextImage = items[activeWork + 1]?.images?.[0];
    if (!nextImage) return;
    let cancelled = false;
    let cancelFallback: (() => void) | null = null;
    let idleId: number | null = null;
    const warm = () => {
      if (!cancelled) void preloadAndDecodeImage(nextImage, "auto");
    };
    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(warm, { timeout: 900 });
    } else {
      const timeoutId = globalThis.setTimeout(warm, 350);
      cancelFallback = () => globalThis.clearTimeout(timeoutId);
    }
    return () => {
      cancelled = true;
      if (idleId !== null && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
      cancelFallback?.();
    };
  }, [activeWork, items]);

  useEffect(() => {
    const sheet = sheetRef.current;
    const feed = feedRef.current;
    if (sheet) sheet.inert = !sheetOpen;
    if (feed) feed.inert = sheetOpen;
    if (!sheetOpen) return;
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : filterButtonRef.current;
    window.requestAnimationFrame(() => sheet?.querySelector<HTMLElement>("input,select,button")?.focus());
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
      if (event.key === "Tab" && sheet) {
        const focusable = [...sheet.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled])',
        )];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [sheetOpen]);

  useEffect(() => () => {
    initialAbort.current?.abort();
    moreAbort.current?.abort();
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (feedScrollRaf.current !== null) cancelAnimationFrame(feedScrollRaf.current);
  }, []);

  const replaceUrl = useCallback((nextFilters: FilterValues, nextCid = "") => {
    const query = buildPageQuery(nextFilters, nextCid);
    window.history.replaceState(null, "", query.size ? `/?${query}` : "/");
  }, []);

  const applyFilters = async (event: FormEvent) => {
    event.preventDefault();
    if (draftFilters.minPrice > 0 && draftFilters.maxPrice > 0 && draftFilters.maxPrice < draftFilters.minPrice) return;
    const next = { ...draftFilters, query: draftFilters.query.trim() };
    setFilters(next);
    setSheetOpen(false);
    replaceUrl(next);
    await loadInitial(next);
  };

  const updateSelect = (key: "assetType" | "genreId") => (event: ChangeEvent<HTMLSelectElement>) => {
    setDraftFilters((old) => ({
      ...old,
      [key]: key === "assetType" ? event.target.value as AssetType : event.target.value,
    }));
  };

  const updateNumber = (
    key: "minSamples" | "minReviews" | "minRating" | "minPrice" | "maxPrice",
  ) => (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.trim();
    if (!raw && (key === "minPrice" || key === "maxPrice")) {
      setDraftFilters((old) => ({ ...old, [key]: 0 }));
      return;
    }
    const value = key === "minRating" ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
    if (Number.isFinite(value)) setDraftFilters((old) => ({ ...old, [key]: value }));
  };

  const priceInvalid = draftFilters.minPrice > 0
    && draftFilters.maxPrice > 0
    && draftFilters.maxPrice < draftFilters.minPrice;
  const activeGenre = meta?.genres.find((genre) => genre.id === filters.genreId)?.name ?? "";
  const activeCondition = useMemo(() => {
    const parts: string[] = [];
    if (filters.query) parts.push(`「${filters.query}」`);
    if (filters.assetType !== "all") parts.push(ASSET_LABELS[filters.assetType]);
    if (activeGenre) parts.push(activeGenre);
    if (filters.minPrice && filters.maxPrice) {
      parts.push(`${formatPrice("", filters.minPrice)}〜${formatPrice("", filters.maxPrice)}`);
    } else if (filters.minPrice) parts.push(`${formatPrice("", filters.minPrice)}以上`);
    else if (filters.maxPrice) parts.push(`${formatPrice("", filters.maxPrice)}以下`);
    if (filters.minSamples > 1) parts.push(`サンプル${filters.minSamples}枚以上`);
    if (filters.minReviews) parts.push(`レビュー${filters.minReviews}件以上`);
    if (filters.minRating) parts.push(`評価${filters.minRating}以上`);
    return parts.length ? parts.join(" / ") : "すべての作品";
  }, [activeGenre, filters]);

  const handleFeedKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      moveWork(activeWork, 1);
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      moveWork(activeWork, -1);
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (
      Math.abs(event.deltaY) < 24
      || Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      || performance.now() < wheelLockedUntil.current
    ) return;
    event.preventDefault();
    wheelLockedUntil.current = performance.now() + 260;
    moveWork(activeWork, event.deltaY > 0 ? 1 : -1);
  };

  return (
    <>
      <header className="app-header">
        <div className="header-actions">
          <div className="feed-count">
            <span>{items.length ? activeWork + 1 : 0}</span> / {targetTotal ? targetTotal.toLocaleString("ja-JP") : items.length || "-"}
          </div>
          <button
            ref={filterButtonRef}
            className="icon-btn"
            type="button"
            onClick={() => setSheetOpen(true)}
          >
            <FilterIcon /> 絞り込み
          </button>
        </div>
      </header>

      <FocusModeToggle active={readerSettings.controlsHidden} onToggle={toggleReaderControls} />

      <main
        ref={feedRef}
        className="feed"
        id="feed"
        aria-label="作品フィード"
        tabIndex={0}
        onKeyDown={handleFeedKey}
        onWheel={handleWheel}
        onScroll={() => {
          if (feedScrollRaf.current !== null) return;
          feedScrollRaf.current = requestAnimationFrame(() => {
            feedScrollRaf.current = null;
            const feed = feedRef.current;
            if (!feed || feed.clientHeight <= 0 || !items.length) return;
            setActiveWork(Math.max(
              0,
              Math.min(items.length - 1, Math.round(feed.scrollTop / feed.clientHeight)),
            ));
          });
        }}
      >
        {loading ? (
          <section className="empty-state">
            <div className="empty-card loading-card">
              <div className="spinner" aria-hidden="true" />
              <h2>作品を読み込んでいます</h2>
            </div>
          </section>
        ) : catalogError ? (
          <section className="empty-state">
            <div className="empty-card">
              <h2>作品を取得できませんでした</h2>
              <p>{catalogError}</p>
              <button className="btn btn-primary" type="button" onClick={() => void loadInitial(filters, initialCid)}>再試行</button>
            </div>
          </section>
        ) : items.length === 0 ? (
          <section className="empty-state">
            <div className="empty-card">
              <h2>表示できる作品がありません</h2>
              <p>絞り込み条件を変更してください。</p>
              <button className="btn btn-primary" type="button" onClick={() => setSheetOpen(true)}>絞り込み</button>
            </div>
          </section>
        ) : items.map((item, index) => Math.abs(index - activeWork) <= WINDOW_RADIUS ? (
          <WorkCard
            key={item.cid}
            item={item}
            index={index}
            isActive={index === activeWork}
            initialPage={pageByCid.current.get(item.cid) ?? 0}
            readerSettings={readerSettings}
            onToggleControls={toggleReaderControls}
            onPageChange={(workCid, page, isCta) => {
              pageByCid.current.set(workCid, page);
              if (isCta || page >= Math.max(0, item.images.length - 2)) {
                const nextImage = items[index + 1]?.images?.[0];
                if (nextImage) void preloadAndDecodeImage(nextImage, "high");
              }
            }}
            onToast={showToast}
            onVerticalSwipe={(direction) => moveWork(index, direction)}
          />
        ) : (
          <article
            key={item.cid}
            className="feed-item feed-item-virtual"
            data-work-index={index}
            data-cid={item.cid}
            aria-label={`${index + 1}件目 ${item.title}`}
          />
        ))}
      </main>

      {loadingMore ? (
        <div className="feed-loading-more" aria-live="polite">
          <span className="mini-spinner" aria-hidden="true" /> 次の作品を準備中
        </div>
      ) : null}
      {loadMoreError ? (
        <div className="feed-load-error" role="status">
          <span>{loadMoreError}</span>
          <button type="button" onClick={() => void loadMore(true)}>再試行</button>
        </div>
      ) : null}

      <GlobalNav active="main" />
      {toast ? <div className="toast is-show" role="status">{toast}</div> : null}

      <div
        className={`sheet-backdrop${sheetOpen ? " is-open" : ""}`}
        onClick={() => setSheetOpen(false)}
        aria-hidden="true"
      />
      <aside
        ref={sheetRef}
        className={`sheet${sheetOpen ? " is-open" : ""}`}
        id="filterSheet"
        role="dialog"
        aria-modal="true"
        aria-label="作品とビューアーを設定"
        aria-hidden={!sheetOpen}
      >
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-title">設定</div>
          <button className="close-btn" type="button" onClick={() => setSheetOpen(false)} aria-label="閉じる">×</button>
        </div>

        <section className="reader-settings-panel" aria-labelledby="reader_settings_title">
          <h2 id="reader_settings_title">ビューアー</h2>
          <div className="reader-setting-row">
            <span>画像表示</span>
            <div className="reader-segmented" role="group" aria-label="画像表示方式">
              <button
                type="button"
                className={readerSettings.fitMode === "contain" ? "is-active" : ""}
                aria-pressed={readerSettings.fitMode === "contain"}
                onClick={() => updateReaderSettings({ fitMode: "contain" })}
              >
                全体表示
              </button>
              <button
                type="button"
                className={readerSettings.fitMode === "width" ? "is-active" : ""}
                aria-pressed={readerSettings.fitMode === "width"}
                onClick={() => updateReaderSettings({ fitMode: "width" })}
              >
                横幅優先
              </button>
            </div>
          </div>
          <div className="reader-setting-row">
            <span>読む方向</span>
            <div className="reader-segmented" role="group" aria-label="読む方向">
              <button
                type="button"
                className={readerSettings.readingDirection === "rtl" ? "is-active" : ""}
                aria-pressed={readerSettings.readingDirection === "rtl"}
                onClick={() => updateReaderSettings({ readingDirection: "rtl" })}
              >
                右→左
              </button>
              <button
                type="button"
                className={readerSettings.readingDirection === "ltr" ? "is-active" : ""}
                aria-pressed={readerSettings.readingDirection === "ltr"}
                onClick={() => updateReaderSettings({ readingDirection: "ltr" })}
              >
                左→右
              </button>
            </div>
          </div>
          <label className="reader-setting-toggle">
            <span><strong>画面端タップでページ送り</strong><small>中央タップはUI表示切替</small></span>
            <input
              type="checkbox"
              checked={readerSettings.tapNavigation}
              onChange={(event) => updateReaderSettings({ tapNavigation: event.target.checked })}
            />
          </label>
          <p className="reader-settings-note">ダブルタップで拡大・解除、2本指ピンチで1〜4倍に拡大できます。設定はこの端末に保存されます。</p>
        </section>

        <form onSubmit={applyFilters}>
          <div className="filters">
            <div className="field field--full">
              <label htmlFor="work_query">作品名・サークル・シリーズ</label>
              <input
                id="work_query"
                type="search"
                maxLength={100}
                placeholder="キーワードで検索"
                value={draftFilters.query}
                onChange={(event) => setDraftFilters((old) => ({ ...old, query: event.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="asset_type">作品タイプ</label>
              <select id="asset_type" value={draftFilters.assetType} onChange={updateSelect("assetType")}>
                {(meta?.assetTypes ?? Object.entries(ASSET_LABELS).map(([key, label]) => ({ key: key as AssetType, label }))).map((definition) => (
                  <option value={definition.key} key={definition.key}>{definition.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="genre_id">ジャンル</label>
              <select id="genre_id" value={draftFilters.genreId} onChange={updateSelect("genreId")}>
                <option value="">すべて</option>
                {meta?.genres.map((genre) => <option value={genre.id} key={genre.id}>{genre.name}</option>)}
              </select>
              {metaError ? <div className="genre-note">ジャンル情報を取得できませんでした</div> : null}
            </div>
            <div className="field">
              <label htmlFor="min_price">価格下限</label>
              <input id="min_price" type="number" inputMode="numeric" min="0" max="10000000" placeholder="指定なし" value={draftFilters.minPrice || ""} onChange={updateNumber("minPrice")} />
            </div>
            <div className="field">
              <label htmlFor="max_price">価格上限</label>
              <input id="max_price" type="number" inputMode="numeric" min="0" max="10000000" placeholder="指定なし" value={draftFilters.maxPrice || ""} onChange={updateNumber("maxPrice")} />
            </div>
            {priceInvalid ? <div className="filter-error field--full">価格上限は価格下限以上にしてください。</div> : null}
            <div className="field">
              <label htmlFor="min_samples">最低サンプル枚数</label>
              <input id="min_samples" type="number" min="1" max="100" value={draftFilters.minSamples} onChange={updateNumber("minSamples")} />
            </div>
            <div className="field">
              <label htmlFor="min_reviews">最低レビュー件数</label>
              <input id="min_reviews" type="number" min="0" max="100000" value={draftFilters.minReviews} onChange={updateNumber("minReviews")} />
            </div>
            <div className="field field--full">
              <label htmlFor="min_rating">最低平均評価</label>
              <input id="min_rating" type="number" min="0" max="5" step="0.1" value={draftFilters.minRating} onChange={updateNumber("minRating")} />
            </div>
          </div>
          <div className="filter-summary">現在: {activeCondition}</div>
          <div className="sheet-actions">
            <button className="btn btn-secondary" type="button" onClick={() => setDraftFilters(DEFAULT_FILTERS)}>絞り込み解除</button>
            <button className="btn btn-primary" type="submit" disabled={loading || priceInvalid}>{loading ? "取得中…" : "この条件で見る"}</button>
          </div>
        </form>
      </aside>
    </>
  );
}
