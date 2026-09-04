import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AssetType,
  CatalogResponse,
  DebugServerResponse,
  FeedItem,
  FilterValues,
  MetaResponse,
  SampleStatsRow,
} from "@/lib/types";
import { trackEvent } from "@/src/analytics";

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
  minSamples: 10,
  minReviews: 10,
  minRating: 4.5,
};

const STAT_KEYS: AssetType[] = ["all", "comic", "cg", "game", "voice", "other"];
const INITIAL_LIMIT = 6;
const PREFETCH_THRESHOLD = 3;
const AUTO_PREFETCH_MAX_PAGES = 7;

type Props = {
  initialFilters: FilterValues;
  initialCid: string;
};

type LoadState = "pending" | "loaded" | "error";

type WorkDebugSnapshot = {
  item: FeedItem;
  index: number;
  currentPage: number;
  loadedImages: number;
  failedImages: number;
  pendingImages: number;
  liked: boolean;
  saved: boolean;
};

function buildCatalogQuery(filters: FilterValues, options?: { cid?: string; offset?: number; limit?: number }) {
  const params = new URLSearchParams({
    asset_type: filters.assetType,
    genre_id: filters.genreId,
    min_samples: String(filters.minSamples),
    min_reviews: String(filters.minReviews),
    min_rating: String(filters.minRating),
    offset: String(options?.offset ?? 1),
    limit: String(options?.limit ?? INITIAL_LIMIT),
  });
  if (options?.cid?.trim()) params.set("cid", options.cid.trim());
  return params;
}

function buildPageQuery(filters: FilterValues, cid = "") {
  const params = new URLSearchParams({
    asset_type: filters.assetType,
    genre_id: filters.genreId,
    min_samples: String(filters.minSamples),
    min_reviews: String(filters.minReviews),
    min_rating: String(filters.minRating),
  });
  if (cid.trim()) params.set("cid", cid.trim());
  return params;
}

function normalizeApiError(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    return data.error;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatPrice(price: string) {
  const digits = price.replace(/[^0-9]/g, "");
  if (!digits) return price;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? `¥${value.toLocaleString("ja-JP")}` : price;
}

function formatBytes(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function mergeUniqueItems(current: FeedItem[], incoming: FeedItem[]) {
  const seen = new Set(current.map((item) => item.cid));
  const next = [...current];
  for (const item of incoming) {
    if (!item.cid || seen.has(item.cid)) continue;
    seen.add(item.cid);
    next.push(item);
  }
  return next;
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4h12v17l-6-4-6 4V4Z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
    </svg>
  );
}

function DebugIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 9h8v8H8zM9 5v4M15 5v4M9 17v3M15 17v3M5 10h3M16 10h3M5 16h3M16 16h3" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

function DebugRow({ label, value, status }: { label: string; value: string | number; status?: "good" | "bad" | "neutral" }) {
  return (
    <div className="debug-row">
      <span>{label}</span>
      <strong className={status ? `is-${status}` : undefined}>{value}</strong>
    </div>
  );
}

function DiagnosticRow({ label, stats, active }: { label: string; stats: SampleStatsRow; active: boolean }) {
  return (
    <tr className={active ? "is-active" : undefined}>
      <td>{label}</td>
      <td>{stats.total}</td>
      <td>{stats.zero}</td>
      <td>{stats.oneToFour}</td>
      <td>{stats.fiveToNine}</td>
      <td>{stats.tenPlus}</td>
    </tr>
  );
}

function WorkCard({
  item,
  index,
  totalWorks,
  onToast,
  onDebug,
}: {
  item: FeedItem;
  index: number;
  totalWorks: number;
  onToast: (message: string) => void;
  onDebug: (snapshot: WorkDebugSnapshot) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const scrollRaf = useRef<number | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [loadStates, setLoadStates] = useState<LoadState[]>(() => item.images.map(() => "pending"));
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoadStates(item.images.map(() => "pending"));
    setCurrentPage(0);
  }, [item.cid, item.images]);

  useEffect(() => {
    try {
      setLiked(localStorage.getItem(`fanza-preview:like:${item.cid}`) === "1");
      setSaved(localStorage.getItem(`fanza-preview:save:${item.cid}`) === "1");
    } catch {
      setLiked(false);
      setSaved(false);
    }
  }, [item.cid]);

  useEffect(() => {
    return () => {
      if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
    };
  }, []);

  const markLoad = useCallback((pageIndex: number, state: Exclude<LoadState, "pending">) => {
    setLoadStates((previous) => {
      if (previous[pageIndex] !== "pending") return previous;
      const next = [...previous];
      next[pageIndex] = state;
      return next;
    });
  }, []);

  const loaded = loadStates.filter((state) => state === "loaded").length;
  const failed = loadStates.filter((state) => state === "error").length;
  const pending = Math.max(0, item.images.length - loaded - failed);

  const pageIndexFromScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth <= 0 || item.images.length === 0) return 0;
    return clamp(Math.round(track.scrollLeft / track.clientWidth), 0, item.images.length - 1);
  }, [item.images.length]);

  const syncCurrentPage = () => {
    if (scrollRaf.current !== null) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null;
      setCurrentPage(pageIndexFromScroll());
    });
  };

  const goToPage = (target: number) => {
    const track = trackRef.current;
    if (!track || item.images.length === 0) return;
    const next = clamp(target, 0, item.images.length - 1);
    track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
    setCurrentPage(next);
  };

  const toggleLocal = (type: "like" | "save") => {
    const key = `fanza-preview:${type}:${item.cid}`;
    const current = type === "like" ? liked : saved;
    const nextActive = !current;
    try {
      if (current) localStorage.removeItem(key);
      else localStorage.setItem(key, "1");
    } catch {
      onToast("ブラウザに保存できませんでした");
      return;
    }

    if (type === "like") setLiked(nextActive);
    else setSaved(nextActive);
    trackEvent({
      eventType: type === "like" ? "like_toggle" : "save_toggle",
      cid: item.cid,
      metadata: { active: nextActive },
    });
    onToast(
      type === "like"
        ? current
          ? "いいねを解除しました"
          : "いいねしました"
        : current
          ? "保存を解除しました"
          : "保存しました",
    );
  };

  const share = async () => {
    const url = item.affiliateUrl || window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title || "FANZA同人作品", url });
        trackEvent({ eventType: "share", cid: item.cid });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        trackEvent({ eventType: "share", cid: item.cid });
        onToast("リンクをコピーしました");
      } else {
        onToast("このブラウザでは共有できません");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      onToast("共有できませんでした");
    }
  };

  return (
    <article
      className="feed-item"
      data-work-index={index}
      data-cid={item.cid}
      aria-label={`${index + 1}件目 ${item.title || item.cid}`}
    >
      <div
        ref={trackRef}
        className="preview-track"
        tabIndex={0}
        onScroll={syncCurrentPage}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            goToPage(currentPage + (event.key === "ArrowRight" ? 1 : -1));
          }
        }}
      >
        {item.images.map((url, pageIndex) => (
          <div
            className={`preview-page${loadStates[pageIndex] === "error" ? " is-error" : ""}`}
            key={`${item.cid}-${pageIndex}`}
          >
            <img
              src={url}
              alt={`${item.title} サンプル ${pageIndex + 1}`}
              loading={index === 0 && pageIndex === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 && pageIndex === 0 ? "high" : "auto"}
              decoding="async"
              onLoad={() => markLoad(pageIndex, "loaded")}
              onError={() => markLoad(pageIndex, "error")}
            />
          </div>
        ))}
      </div>

      <div className="page-counter">
        <span>{currentPage + 1}</span>&nbsp;/&nbsp;{item.images.length}
      </div>
      {item.images.length > 1 && index === 0 ? <div className="swipe-hint">← 横にスワイプして読む →</div> : null}

      <div className="item-gradient" />
      <div className="item-info">
        <div className="item-type">{item.assetLabel}</div>
        <h2 className="item-title">{item.title || item.cid}</h2>
        <div className="item-stats">
          <span className="stat-chip">
            ★<strong>{item.rating.toFixed(1)}</strong> <span>({item.reviews}件)</span>
          </span>
          {item.price ? (
            <span className="stat-chip">
              <strong>{formatPrice(item.price)}</strong>
            </span>
          ) : null}
        </div>
        {item.genres.length > 0 ? <div className="genre-line">{item.genres.slice(0, 6).join(" / ")}</div> : null}
        {/^https?:\/\//i.test(item.affiliateUrl) ? (
          <a
            className="open-link"
            href={item.affiliateUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={() => trackEvent({ eventType: "affiliate_click", cid: item.cid })}
          >
            FANZAで続きを読む <ExternalIcon />
          </a>
        ) : null}
      </div>

      <div className="action-rail">
        <button className={`action-btn${liked ? " is-active" : ""}`} type="button" onClick={() => toggleLocal("like")}>
          <span className="action-icon"><HeartIcon /></span>
          <span className="action-label">いいね</span>
        </button>
        <button className={`action-btn${saved ? " is-active" : ""}`} type="button" onClick={() => toggleLocal("save")}>
          <span className="action-icon"><BookmarkIcon /></span>
          <span className="action-label">保存</span>
        </button>
        <button className="action-btn" type="button" onClick={share}>
          <span className="action-icon"><ShareIcon /></span>
          <span className="action-label">共有</span>
        </button>
        <button
          className="action-btn debug-action"
          type="button"
          onClick={() => onDebug({ item, index, currentPage, loadedImages: loaded, failedImages: failed, pendingImages: pending, liked, saved })}
        >
          <span className="action-icon"><DebugIcon /></span>
          <span className="action-label">デバッグ</span>
        </button>
      </div>
      {index < totalWorks - 1 ? <div className="next-hint">SWIPE UP</div> : null}
    </article>
  );
}

export function SwipePreviewApp({ initialFilters, initialCid }: Props) {
  const feedRef = useRef<HTMLElement | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [lastBatch, setLastBatch] = useState<CatalogResponse | null>(null);
  const [filters, setFilters] = useState<FilterValues>(initialFilters);
  const [draftFilters, setDraftFilters] = useState<FilterValues>(initialFilters);
  const [cid, setCid] = useState(initialCid);
  const [cidDraft, setCidDraft] = useState(initialCid);
  const [nextOffset, setNextOffset] = useState<number | null>(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [metaError, setMetaError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugContext, setDebugContext] = useState<WorkDebugSnapshot | null>(null);
  const [debugData, setDebugData] = useState<DebugServerResponse | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState("");
  const [activeWork, setActiveWork] = useState(0);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreInFlight = useRef(false);
  const generation = useRef(0);
  const autoPrefetchPages = useRef(0);
  const booted = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1600);
  }, []);

  const loadMeta = useCallback(async () => {
    try {
      const response = await fetch("/api/meta", { headers: { Accept: "application/json" } });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(normalizeApiError(data, `メタ情報の取得に失敗しました (${response.status})`));
      setMeta(data as MetaResponse);
      setMetaError("");
    } catch (requestError) {
      setMetaError(requestError instanceof Error ? requestError.message : "メタ情報の取得に失敗しました。");
    }
  }, []);

  const loadInitial = useCallback(async (nextFilters: FilterValues, nextCid = "") => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    autoPrefetchPages.current = 0;
    loadMoreInFlight.current = false;
    setLoading(true);
    setLoadingMore(false);
    setCatalogError("");
    setActiveWork(0);
    setItems([]);
    setLastBatch(null);
    setNextOffset(1);
    setHasMore(true);
    feedRef.current?.scrollTo({ top: 0, behavior: "auto" });

    try {
      const query = buildCatalogQuery(nextFilters, { cid: nextCid, offset: 1, limit: INITIAL_LIMIT });
      const response = await fetch(`/api/catalog?${query.toString()}`, { headers: { Accept: "application/json" } });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(normalizeApiError(data, `作品取得に失敗しました (${response.status})`));
      if (generation.current !== requestGeneration) return;
      const catalog = data as CatalogResponse;
      setItems(catalog.items);
      setLastBatch(catalog);
      setNextOffset(catalog.nextOffset);
      setHasMore(catalog.hasMore);
    } catch (requestError) {
      if (generation.current !== requestGeneration) return;
      setCatalogError(requestError instanceof Error ? requestError.message : "作品取得に失敗しました。");
      setHasMore(false);
      setNextOffset(null);
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadMoreInFlight.current || !hasMore || nextOffset === null) return;
    const requestGeneration = generation.current;
    loadMoreInFlight.current = true;
    setLoadingMore(true);

    try {
      const query = buildCatalogQuery(filters, { offset: nextOffset, limit: INITIAL_LIMIT });
      const response = await fetch(`/api/catalog?${query.toString()}`, { headers: { Accept: "application/json" } });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(normalizeApiError(data, `追加作品の取得に失敗しました (${response.status})`));
      if (generation.current !== requestGeneration) return;
      const catalog = data as CatalogResponse;
      setItems((current) => mergeUniqueItems(current, catalog.items));
      setLastBatch(catalog);
      setNextOffset(catalog.nextOffset);
      setHasMore(catalog.hasMore);
    } catch (requestError) {
      if (generation.current === requestGeneration) {
        showToast(requestError instanceof Error ? requestError.message : "追加作品の取得に失敗しました");
      }
    } finally {
      if (generation.current === requestGeneration) setLoadingMore(false);
      loadMoreInFlight.current = false;
    }
  }, [filters, hasMore, nextOffset, showToast]);

  const loadDebug = useCallback(async () => {
    setDebugLoading(true);
    setDebugError("");
    try {
      const query = new URLSearchParams({ genre_id: filters.genreId });
      const response = await fetch(`/api/debug?${query.toString()}`, {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        cache: "no-store",
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(normalizeApiError(data, `デバッグ情報の取得に失敗しました (${response.status})`));
      setDebugData(data as DebugServerResponse);
    } catch (requestError) {
      setDebugError(requestError instanceof Error ? requestError.message : "デバッグ情報の取得に失敗しました。");
    } finally {
      setDebugLoading(false);
    }
  }, [filters.genreId]);

  const openDebug = useCallback((snapshot: WorkDebugSnapshot | null = null) => {
    setDebugContext(snapshot);
    setSheetOpen(false);
    setDebugOpen(true);
    void loadDebug();
  }, [loadDebug]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void loadInitial(initialFilters, initialCid);
    void loadMeta();
  }, [initialCid, initialFilters, loadInitial, loadMeta]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || items.length === 0) return;
    const works = [...feed.querySelectorAll<HTMLElement>(".feed-item")];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;
          setActiveWork(Number((entry.target as HTMLElement).dataset.workIndex ?? 0));
        }
      },
      { root: feed, threshold: [0.6] },
    );
    works.forEach((work) => observer.observe(work));
    return () => observer.disconnect();
  }, [items]);

  useEffect(() => {
    if (loading || loadingMore || !hasMore || nextOffset === null) return;
    if (autoPrefetchPages.current >= AUTO_PREFETCH_MAX_PAGES) return;
    if (items.length >= 10) return;

    const timer = window.setTimeout(() => {
      autoPrefetchPages.current += 1;
      void loadMore();
    }, items.length === 0 ? 180 : 450);
    return () => window.clearTimeout(timer);
  }, [hasMore, items.length, loadMore, loading, loadingMore, nextOffset]);

  useEffect(() => {
    if (loading || loadingMore || !hasMore || nextOffset === null || items.length === 0) return;
    if (activeWork < items.length - PREFETCH_THRESHOLD) return;
    void loadMore();
  }, [activeWork, hasMore, items.length, loadMore, loading, loadingMore, nextOffset]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const activeGenreName = useMemo(
    () => meta?.genres.find((genre) => genre.id === filters.genreId)?.name ?? "",
    [filters.genreId, meta?.genres],
  );
  const activeAssetLabel =
    meta?.assetTypes.find((definition) => definition.key === filters.assetType)?.label ?? ASSET_LABELS[filters.assetType];
  const activeConditionText = `${activeAssetLabel} · ${activeGenreName || "全ジャンル"}`;

  const replaceUrl = (nextFilters: FilterValues, nextCid = "") => {
    const query = buildPageQuery(nextFilters, nextCid);
    window.history.replaceState(null, "", `?${query.toString()}`);
  };

  const applyFilters = async (event: FormEvent) => {
    event.preventDefault();
    const next = { ...draftFilters };
    setFilters(next);
    setCid("");
    setCidDraft("");
    setSheetOpen(false);
    replaceUrl(next);
    await loadInitial(next);
  };

  const openCid = async (event: FormEvent) => {
    event.preventDefault();
    const nextCid = cidDraft.trim();
    if (!nextCid) return;
    setCid(nextCid);
    setDebugOpen(false);
    replaceUrl(filters, nextCid);
    await loadInitial(filters, nextCid);
  };

  const updateDraftSelect = (key: "assetType" | "genreId") => (event: ChangeEvent<HTMLSelectElement>) => {
    setDraftFilters((previous) => ({ ...previous, [key]: event.target.value } as FilterValues));
  };

  const updateDraftNumber =
    (key: "minSamples" | "minReviews" | "minRating") => (event: ChangeEvent<HTMLInputElement>) => {
      const value = key === "minRating" ? Number.parseFloat(event.target.value) : Number.parseInt(event.target.value, 10);
      if (!Number.isFinite(value)) return;
      setDraftFilters((previous) => ({ ...previous, [key]: value }));
    };

  const noItemsButSearching = !loading && items.length === 0 && loadingMore;
  const currentItem = items[activeWork] ?? null;
  const browserDebug = debugOpen
    ? {
        url: window.location.href,
        viewport: `${window.innerWidth}×${window.innerHeight}`,
        devicePixelRatio: window.devicePixelRatio,
        online: navigator.onLine,
        visibility: document.visibilityState,
        userAgent: navigator.userAgent,
      }
    : null;
  const clientDebug = {
    feed: {
      loadedItems: items.length,
      activeIndex: items.length > 0 ? activeWork + 1 : 0,
      hasMore,
      nextOffset,
      loading,
      loadingMore,
      source: lastBatch?.source ?? null,
      lastBatchScanned: lastBatch?.scanned ?? 0,
      targetTotal: lastBatch?.apiTotal ?? 0,
      effectiveMinSamples: lastBatch?.effectiveMinSamples ?? filters.minSamples,
      queryError: lastBatch?.queryError || null,
      catalogError: catalogError || null,
      metaError: metaError || null,
    },
    filters,
    directCid: cid || null,
    currentWork: debugContext ?? (currentItem ? { item: currentItem, index: activeWork } : null),
    browser: browserDebug,
  };

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">F</div>
          <div className="brand-copy">
            <div className="brand-title">Swipe Preview</div>
            <div className="brand-condition">{activeConditionText}</div>
          </div>
        </div>
        <div className="header-actions">
          <div className="feed-count">
            <span>{items.length > 0 ? activeWork + 1 : 0}</span> / {items.length}{hasMore ? "+" : ""}
          </div>
          <button className="icon-btn" type="button" onClick={() => { setDebugOpen(false); setSheetOpen(true); }}>
            <FilterIcon /> 絞り込み
          </button>
        </div>
      </header>

      <main ref={feedRef} className="feed" id="feed" aria-label="作品フィード">
        {loading || noItemsButSearching ? (
          <section className="empty-state">
            <div className="empty-card loading-card">
              <div className="spinner" aria-hidden="true" />
              <h2>{loading ? "最初の作品を読み込んでいます" : "次の候補を探しています"}</h2>
              <p>{loading ? "条件に合う作品を準備しています。" : "次の候補をバックグラウンドで準備しています。"}</p>
            </div>
          </section>
        ) : catalogError ? (
          <section className="empty-state">
            <div className="empty-card">
              <h2>作品を取得できませんでした</h2>
              <p>条件を変更するか、デバッグ画面で取得状態を確認してください。</p>
              <div className="empty-actions">
                <button className="btn btn-secondary" type="button" onClick={() => setSheetOpen(true)}>絞り込み</button>
                <button className="btn btn-primary" type="button" onClick={() => openDebug(null)}>デバッグ</button>
              </div>
            </div>
          </section>
        ) : items.length === 0 ? (
          <section className="empty-state">
            <div className="empty-card">
              <h2>条件に合う作品がありません</h2>
              <p>条件を緩めるか、デバッグ画面でDB・取得件数を確認してください。</p>
              <div className="empty-actions">
                <button className="btn btn-secondary" type="button" onClick={() => setSheetOpen(true)}>絞り込み</button>
                <button className="btn btn-primary" type="button" onClick={() => openDebug(null)}>デバッグ</button>
              </div>
            </div>
          </section>
        ) : (
          items.map((item, index) => (
            <WorkCard
              key={item.cid}
              item={item}
              index={index}
              totalWorks={items.length}
              onToast={showToast}
              onDebug={openDebug}
            />
          ))
        )}
      </main>

      {loadingMore && items.length > 0 ? (
        <div className="feed-loading-more" aria-live="polite">
          <span className="mini-spinner" aria-hidden="true" /> 次の作品を準備中
        </div>
      ) : null}

      <div
        className={`sheet-backdrop${sheetOpen || debugOpen ? " is-open" : ""}`}
        onClick={() => { setSheetOpen(false); setDebugOpen(false); }}
        aria-hidden="true"
      />

      <aside className={`sheet${sheetOpen ? " is-open" : ""}`} id="filterSheet" aria-hidden={!sheetOpen}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-title">作品を絞り込む</div>
          <button className="close-btn" type="button" onClick={() => setSheetOpen(false)} aria-label="閉じる">×</button>
        </div>

        <form onSubmit={applyFilters}>
          <div className="filters">
            <div className="field">
              <label htmlFor="asset_type">作品タイプ</label>
              <select id="asset_type" value={draftFilters.assetType} onChange={updateDraftSelect("assetType")}>
                {(meta?.assetTypes ?? Object.entries(ASSET_LABELS).map(([key, label]) => ({ key: key as AssetType, label }))).map((definition) => (
                  <option value={definition.key} key={definition.key}>{definition.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="genre_id">ジャンル</label>
              <select id="genre_id" value={draftFilters.genreId} onChange={updateDraftSelect("genreId")}>
                <option value="">すべて</option>
                {meta?.genres.map((genre) => <option value={genre.id} key={genre.id}>{genre.name}</option>)}
              </select>
              {metaError ? <div className="genre-note">ジャンル情報を取得できませんでした</div> : null}
            </div>
            <div className="field">
              <label htmlFor="min_samples">最低サンプル枚数</label>
              <input id="min_samples" type="number" min="0" max="100" value={draftFilters.minSamples} onChange={updateDraftNumber("minSamples")} />
            </div>
            <div className="field">
              <label htmlFor="min_reviews">最低レビュー件数</label>
              <input id="min_reviews" type="number" min="0" max="100000" value={draftFilters.minReviews} onChange={updateDraftNumber("minReviews")} />
            </div>
            <div className="field field--full">
              <label htmlFor="min_rating">最低平均評価</label>
              <input id="min_rating" type="number" min="0" max="5" step="0.1" value={draftFilters.minRating} onChange={updateDraftNumber("minRating")} />
            </div>
          </div>

          <div className="filter-summary">
            現在: {activeConditionText}<br />
            サンプル {filters.minSamples}枚以上 / レビュー {filters.minReviews}件以上 / 評価 {filters.minRating.toFixed(1)}以上
          </div>

          <div className="sheet-actions">
            <button className="btn btn-secondary" type="button" onClick={() => setDraftFilters(DEFAULT_FILTERS)}>初期値に戻す</button>
            <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? "取得中…" : "この条件で見る"}</button>
          </div>
        </form>
      </aside>

      <aside className={`sheet debug-sheet${debugOpen ? " is-open" : ""}`} aria-hidden={!debugOpen}>
        <div className="sheet-handle" />
        <div className="sheet-head debug-sheet-head">
          <div>
            <div className="sheet-title">デバッグ</div>
            <div className="debug-caption">表示用UIと分離した開発情報</div>
          </div>
          <div className="debug-head-actions">
            <button className="debug-refresh" type="button" onClick={() => void loadDebug()} disabled={debugLoading}>再取得</button>
            <button className="close-btn" type="button" onClick={() => setDebugOpen(false)} aria-label="閉じる">×</button>
          </div>
        </div>

        {debugLoading && !debugData ? (
          <div className="diag-loading"><span className="mini-spinner" /> DB・API状態を取得中…</div>
        ) : null}
        {debugError ? <div className="debug-error">{debugError}</div> : null}

        <section className="debug-section">
          <h3>現在のフィード</h3>
          <div className="debug-grid">
            <DebugRow label="表示位置" value={`${items.length > 0 ? activeWork + 1 : 0} / ${items.length}`} />
            <DebugRow label="取得元" value={lastBatch?.source === "database" ? "MariaDB" : lastBatch?.source === "fanza-api" ? "FANZA API" : "-"} />
            <DebugRow label="直近走査件数" value={lastBatch?.scanned ?? 0} />
            <DebugRow label="対象総数" value={lastBatch?.apiTotal ?? 0} />
            <DebugRow label="nextOffset" value={nextOffset ?? "null"} />
            <DebugRow label="続き" value={hasMore ? "あり" : "なし"} status={hasMore ? "good" : "neutral"} />
            <DebugRow label="初期読込" value={loading ? "中" : "完了"} status={loading ? "neutral" : "good"} />
            <DebugRow label="追加読込" value={loadingMore ? "中" : "停止"} />
          </div>
          <div className="debug-note">{activeConditionText} / sample {filters.minSamples}+ / review {filters.minReviews}+ / rating {filters.minRating.toFixed(1)}+</div>
          {lastBatch?.queryError ? <div className="debug-error">CID: {lastBatch.queryError}</div> : null}
          {catalogError ? <div className="debug-error">Catalog: {catalogError}</div> : null}
          {metaError ? <div className="debug-error">Meta: {metaError}</div> : null}
        </section>

        <section className="debug-section">
          <h3>表示中作品</h3>
          {debugContext ? (
            <>
              <div className="debug-grid">
                <DebugRow label="index" value={debugContext.index + 1} />
                <DebugRow label="CID" value={debugContext.item.cid} />
                <DebugRow label="ページ" value={`${debugContext.currentPage + 1} / ${debugContext.item.images.length}`} />
                <DebugRow label="sampleCount" value={debugContext.item.sampleCount} />
                <DebugRow label="画像読込" value={`${debugContext.loadedImages} 成功 / ${debugContext.pendingImages} 待機 / ${debugContext.failedImages} 失敗`} status={debugContext.failedImages > 0 ? "bad" : "good"} />
                <DebugRow label="assetType" value={debugContext.item.assetType} />
                <DebugRow label="assetBucket" value={debugContext.item.assetBucket || "-"} />
                <DebugRow label="評価" value={debugContext.item.rating.toFixed(1)} />
                <DebugRow label="レビュー" value={debugContext.item.reviews} />
                <DebugRow label="価格" value={debugContext.item.price || "-"} />
                <DebugRow label="いいね" value={debugContext.liked ? "ON" : "OFF"} />
                <DebugRow label="保存" value={debugContext.saved ? "ON" : "OFF"} />
              </div>
              <div className="debug-note debug-break">{debugContext.item.title}</div>
              <div className="debug-note debug-break">genres: {debugContext.item.genres.join(" / ") || "-"}</div>
            </>
          ) : currentItem ? (
            <div className="debug-note">現在のCID: {currentItem.cid}。カード右側のデバッグボタンから開くと画像読込状態まで取得できます。</div>
          ) : (
            <div className="debug-note">表示中の作品はありません。</div>
          )}
        </section>

        <section className="debug-section">
          <h3>MariaDB / サーバー</h3>
          {debugData ? (
            <>
              <div className="debug-grid">
                <DebugRow label="DB設定" value={debugData.database.configured ? "済" : "未設定"} status={debugData.database.configured ? "good" : "bad"} />
                <DebugRow label="DB接続" value={debugData.database.connected ? "OK" : "NG"} status={debugData.database.connected ? "good" : "bad"} />
                <DebugRow label="catalogReady" value={debugData.database.catalogReady ? "true" : "false"} status={debugData.database.catalogReady ? "good" : "bad"} />
                <DebugRow label="DB driver" value={debugData.database.driver ?? "-"} />
                <DebugRow label="MariaDB/MySQL" value={debugData.database.serverVersion ?? "-"} />
                <DebugRow label="DB容量" value={formatBytes(debugData.database.sizeBytes)} />
                <DebugRow label="PHP" value={`${debugData.runtime.php} / ${debugData.runtime.sapi}`} />
                <DebugRow label="FANZA API" value={debugData.dmm.configured ? "設定済" : "未設定"} status={debugData.dmm.configured ? "good" : "bad"} />
              </div>
              <div className="debug-subtitle">テーブル件数</div>
              <div className="debug-grid">
                <DebugRow label="works" value={debugData.database.counts.works} />
                <DebugRow label="active works" value={debugData.database.counts.activeWorks} />
                <DebugRow label="sampleあり" value={debugData.database.counts.worksWithSamples} />
                <DebugRow label="初期条件対象" value={debugData.database.counts.defaultEligibleWorks} />
                <DebugRow label="genres" value={debugData.database.counts.genres} />
                <DebugRow label="work_genres" value={debugData.database.counts.workGenres} />
                <DebugRow label="anonymous_users" value={debugData.database.counts.anonymousUsers} />
                <DebugRow label="events" value={debugData.database.counts.events} />
                <DebugRow label="user_work_states" value={debugData.database.counts.userWorkStates} />
                <DebugRow label="user_genre_scores" value={debugData.database.counts.userGenreScores} />
              </div>
              <div className="debug-subtitle">更新時刻</div>
              <div className="debug-grid">
                <DebugRow label="作品最終更新" value={debugData.database.latest.workUpdatedAt ?? "-"} />
                <DebugRow label="イベント最終記録" value={debugData.database.latest.eventAt ?? "-"} />
                <DebugRow label="ユーザー最終行動" value={debugData.database.latest.userSeenAt ?? "-"} />
                <DebugRow label="診断生成" value={debugData.generatedAt} />
              </div>
              <div className="debug-note">保持期間: events {debugData.retention.eventDays}日 / profile {debugData.retention.profileDays}日 / 定期同期 {debugData.retention.syncPages}ページ</div>
            </>
          ) : (
            <div className="debug-note">サーバー情報はまだ取得していません。</div>
          )}
        </section>

        <section className="debug-section">
          <h3>作品タイプ件数</h3>
          {debugData && Object.keys(debugData.database.assetCounts).length > 0 ? (
            <div className="debug-grid">
              {Object.entries(debugData.database.assetCounts).map(([key, value]) => <DebugRow key={key} label={key} value={value} />)}
            </div>
          ) : <div className="debug-note">データなし</div>}
        </section>

        <section className="debug-section">
          <h3>直近24時間イベント</h3>
          {debugData && Object.keys(debugData.database.eventCounts24h).length > 0 ? (
            <div className="debug-grid">
              {Object.entries(debugData.database.eventCounts24h).map(([key, value]) => <DebugRow key={key} label={key} value={value} />)}
            </div>
          ) : <div className="debug-note">まだイベントはありません。</div>}
        </section>

        <section className="debug-section">
          <h3>sample_l 枚数分布</h3>
          {debugData?.diagnostics ? (
            <>
              <table className="diag-table">
                <thead>
                  <tr><th>素材</th><th>総数</th><th>0P</th><th>1–4P</th><th>5–9P</th><th>10P+</th></tr>
                </thead>
                <tbody>
                  {STAT_KEYS.map((key) => (
                    <DiagnosticRow
                      key={key}
                      label={meta?.assetTypes.find((definition) => definition.key === key)?.label ?? ASSET_LABELS[key]}
                      stats={debugData.diagnostics!.stats[key]}
                      active={filters.assetType === key}
                    />
                  ))}
                </tbody>
              </table>
              <div className="debug-note">診断走査 {debugData.diagnostics.scanned}件 / 対象総数 {debugData.diagnostics.apiTotal}件</div>
              {Object.keys(debugData.diagnostics.stats.rawBuckets).length > 0 ? (
                <div className="debug-note debug-break">rawBuckets: {Object.entries(debugData.diagnostics.stats.rawBuckets).map(([key, value]) => `${key}:${value}`).join(" / ")}</div>
              ) : null}
            </>
          ) : <div className="debug-note">{debugData?.diagnosticsError ?? "データなし"}</div>}
        </section>

        <section className="debug-section">
          <h3>ブラウザ</h3>
          {browserDebug ? (
            <div className="debug-grid">
              <DebugRow label="viewport" value={browserDebug.viewport} />
              <DebugRow label="DPR" value={browserDebug.devicePixelRatio} />
              <DebugRow label="online" value={browserDebug.online ? "true" : "false"} status={browserDebug.online ? "good" : "bad"} />
              <DebugRow label="visibility" value={browserDebug.visibility} />
              <div className="debug-row debug-row--full"><span>URL</span><strong>{browserDebug.url}</strong></div>
              <div className="debug-row debug-row--full"><span>User-Agent</span><strong>{browserDebug.userAgent}</strong></div>
            </div>
          ) : null}
        </section>

        <section className="debug-section">
          <h3>CID直接テスト</h3>
          <form className="cid-test debug-cid-test" onSubmit={openCid}>
            <input value={cidDraft} onChange={(event: ChangeEvent<HTMLInputElement>) => setCidDraft(event.target.value)} placeholder="CID / FANZA商品URL" autoComplete="off" />
            <button type="submit" disabled={loading || !cidDraft.trim()}>開く</button>
          </form>
          {cid ? <div className="cid-active">直接表示中: {cid}</div> : null}
        </section>

        <details className="debug-raw">
          <summary>生データを表示</summary>
          <pre>{JSON.stringify({ client: clientDebug, server: debugData }, null, 2)}</pre>
        </details>
      </aside>

      <div className={`toast${toast ? " is-show" : ""}`}>{toast}</div>
    </>
  );
}
