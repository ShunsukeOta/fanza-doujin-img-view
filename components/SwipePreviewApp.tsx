import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { GlobalNav } from "@/components/GlobalNav";
import { FilterIcon } from "@/components/icons";
import { WorkCard } from "@/components/WorkCard";
import type {
  AssetType,
  CatalogResponse,
  DebugServerResponse,
  FeedItem,
  FilterValues,
  MetaResponse,
  SampleStatsRow,
  WorkDebugSnapshot,
} from "@/lib/types";

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
};

const STAT_KEYS: AssetType[] = ["all", "comic", "cg", "game", "voice", "other"];
const INITIAL_LIMIT = 6;
const PREFETCH_THRESHOLD = 3;
const AUTO_PREFETCH_MAX_PAGES = 7;

type Props = {
  initialFilters: FilterValues;
  initialCid: string;
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
  const params = new URLSearchParams();
  if (filters.assetType !== DEFAULT_FILTERS.assetType) params.set("asset_type", filters.assetType);
  if (filters.genreId) params.set("genre_id", filters.genreId);
  if (filters.minSamples !== DEFAULT_FILTERS.minSamples) params.set("min_samples", String(filters.minSamples));
  if (filters.minReviews !== DEFAULT_FILTERS.minReviews) params.set("min_reviews", String(filters.minReviews));
  if (filters.minRating !== DEFAULT_FILTERS.minRating) params.set("min_rating", String(filters.minRating));
  if (cid.trim()) params.set("cid", cid.trim());
  return params;
}

function normalizeApiError(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  return fallback;
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
      <td>{label}</td><td>{stats.total}</td><td>{stats.zero}</td><td>{stats.oneToFour}</td><td>{stats.fiveToNine}</td><td>{stats.tenPlus}</td>
    </tr>
  );
}

function isDefaultFilter(filters: FilterValues) {
  return filters.assetType === "all"
    && filters.genreId === ""
    && filters.minSamples === 1
    && filters.minReviews === 0
    && filters.minRating === 0;
}

export function SwipePreviewApp({ initialFilters, initialCid }: Props) {
  const feedRef = useRef<HTMLElement | null>(null);
  const feedScrollRaf = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreInFlight = useRef(false);
  const generation = useRef(0);
  const autoPrefetchPages = useRef(0);
  const booted = useRef(false);

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

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1700);
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
      const response = await fetch(`/api/catalog?${query.toString()}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
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
      const response = await fetch(`/api/catalog?${query.toString()}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(normalizeApiError(data, `追加作品の取得に失敗しました (${response.status})`));
      if (generation.current !== requestGeneration) return;
      const catalog = data as CatalogResponse;
      setItems((current) => mergeUniqueItems(current, catalog.items));
      setLastBatch(catalog);
      setNextOffset(catalog.nextOffset);
      setHasMore(catalog.hasMore);
    } catch (requestError) {
      if (generation.current === requestGeneration) showToast(requestError instanceof Error ? requestError.message : "追加作品の取得に失敗しました");
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
        credentials: "same-origin",
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

  const scrollToWork = useCallback((targetIndex: number, behavior: ScrollBehavior = "smooth") => {
    const feed = feedRef.current;
    if (!feed || items.length === 0) return;
    const next = Math.max(0, Math.min(items.length - 1, targetIndex));
    const target = feed.querySelector<HTMLElement>(`.feed-item[data-work-index="${next}"]`);
    if (!target) return;
    feed.scrollTo({ top: target.offsetTop, behavior });
  }, [items.length]);

  const moveWork = useCallback((fromIndex: number, direction: -1 | 1) => {
    const target = fromIndex + direction;
    if (target < 0) {
      scrollToWork(0);
      return;
    }
    if (target >= items.length) {
      if (hasMore) {
        void loadMore();
        showToast("次の作品を準備しています");
      }
      return;
    }
    scrollToWork(target);
  }, [hasMore, items.length, loadMore, scrollToWork, showToast]);

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
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.55)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target instanceof HTMLElement) {
        setActiveWork(Number(visible.target.dataset.workIndex ?? 0));
      }
    }, { root: feed, threshold: [0.55, 0.75, 0.9] });
    works.forEach((work) => observer.observe(work));
    return () => observer.disconnect();
  }, [items]);

  useEffect(() => {
    if (loading || loadingMore || !hasMore || nextOffset === null) return;
    if (autoPrefetchPages.current >= AUTO_PREFETCH_MAX_PAGES || items.length >= 10) return;
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

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (feedScrollRaf.current !== null) cancelAnimationFrame(feedScrollRaf.current);
  }, []);

  const activeGenreName = useMemo(() => meta?.genres.find((genre) => genre.id === filters.genreId)?.name ?? "", [filters.genreId, meta?.genres]);
  const activeAssetLabel = meta?.assetTypes.find((definition) => definition.key === filters.assetType)?.label ?? ASSET_LABELS[filters.assetType];
  const filtered = !isDefaultFilter(filters);
  const activeConditionText = filtered
    ? `${activeAssetLabel} · ${activeGenreName || "全ジャンル"} · sample ${filters.minSamples}+ · review ${filters.minReviews}+ · rating ${filters.minRating.toFixed(1)}+`
    : "絞り込みなし（サンプル画像あり）";

  const replaceUrl = (nextFilters: FilterValues, nextCid = "") => {
    const query = buildPageQuery(nextFilters, nextCid).toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
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
    const value = event.target.value;
    setDraftFilters((previous) => ({ ...previous, [key]: key === "assetType" ? value as AssetType : value }));
  };

  const updateDraftNumber = (key: "minSamples" | "minReviews" | "minRating") => (event: ChangeEvent<HTMLInputElement>) => {
    const value = key === "minRating" ? Number.parseFloat(event.target.value) : Number.parseInt(event.target.value, 10);
    if (!Number.isFinite(value)) return;
    setDraftFilters((previous) => ({ ...previous, [key]: value }));
  };

  const currentItem = items[activeWork] ?? null;
  const browserDebug = debugOpen ? {
    url: window.location.href,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    online: navigator.onLine,
    visibility: document.visibilityState,
    userAgent: navigator.userAgent,
  } : null;
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
      catalogError: catalogError || null,
      metaError: metaError || null,
    },
    filters,
    directCid: cid || null,
    currentWork: debugContext ?? (currentItem ? { item: currentItem, index: activeWork } : null),
    browser: browserDebug,
  };

  const noItemsButSearching = !loading && items.length === 0 && loadingMore;

  return (
    <>
      <header className="app-header">
        <div className="header-actions">
          <div className="feed-count"><span>{items.length > 0 ? activeWork + 1 : 0}</span> / {items.length}{hasMore ? "+" : ""}</div>
          <button className={`icon-btn${filtered ? " is-filtered" : ""}`} type="button" onClick={() => { setDebugOpen(false); setSheetOpen(true); }}>
            <FilterIcon /> 絞り込み
          </button>
        </div>
      </header>

      <main
        ref={feedRef}
        className="feed"
        id="feed"
        aria-label="作品フィード"
        onScroll={() => {
          if (feedScrollRaf.current !== null) return;
          feedScrollRaf.current = requestAnimationFrame(() => {
            feedScrollRaf.current = null;
            const feed = feedRef.current;
            if (!feed || feed.clientHeight <= 0 || items.length === 0) return;
            const next = Math.max(0, Math.min(items.length - 1, Math.round(feed.scrollTop / feed.clientHeight)));
            setActiveWork(next);
          });
        }}
      >
        {loading || noItemsButSearching ? (
          <section className="empty-state"><div className="empty-card loading-card"><div className="spinner" aria-hidden="true" /><h2>{loading ? "最初の作品を読み込んでいます" : "次の候補を探しています"}</h2><p>作品を準備しています。</p></div></section>
        ) : catalogError ? (
          <section className="empty-state"><div className="empty-card"><h2>作品を取得できませんでした</h2><p>デバッグ画面で取得状態を確認してください。</p><div className="empty-actions"><button className="btn btn-secondary" type="button" onClick={() => setSheetOpen(true)}>絞り込み</button><button className="btn btn-primary" type="button" onClick={() => openDebug(null)}>デバッグ</button></div></div></section>
        ) : items.length === 0 ? (
          <section className="empty-state"><div className="empty-card"><h2>表示できる作品がありません</h2><p>絞り込み条件またはDB状態を確認してください。</p><div className="empty-actions"><button className="btn btn-secondary" type="button" onClick={() => setSheetOpen(true)}>絞り込み</button><button className="btn btn-primary" type="button" onClick={() => openDebug(null)}>デバッグ</button></div></div></section>
        ) : items.map((item, index) => (
          <WorkCard
            key={item.cid}
            item={item}
            index={index}
            isActive={index === activeWork}
            onToast={showToast}
            onDebug={openDebug}
            onVerticalSwipe={(direction) => moveWork(index, direction)}
          />
        ))}
      </main>

      {loadingMore && items.length > 0 ? <div className="feed-loading-more" aria-live="polite"><span className="mini-spinner" aria-hidden="true" /> 次の作品を準備中</div> : null}

      <GlobalNav
        onFavorites={() => showToast("お気に入りページは準備中です")}
        onMain={() => { setSheetOpen(false); setDebugOpen(false); scrollToWork(activeWork); }}
        onMyPage={() => showToast("マイページは準備中です")}
      />

      <div className={`sheet-backdrop${sheetOpen || debugOpen ? " is-open" : ""}`} onClick={() => { setSheetOpen(false); setDebugOpen(false); }} aria-hidden="true" />

      <aside className={`sheet${sheetOpen ? " is-open" : ""}`} id="filterSheet" aria-hidden={!sheetOpen}>
        <div className="sheet-handle" />
        <div className="sheet-head"><div className="sheet-title">作品を絞り込む</div><button className="close-btn" type="button" onClick={() => setSheetOpen(false)} aria-label="閉じる">×</button></div>
        <form onSubmit={applyFilters}>
          <div className="filters">
            <div className="field"><label htmlFor="asset_type">作品タイプ</label><select id="asset_type" value={draftFilters.assetType} onChange={updateDraftSelect("assetType")}>{(meta?.assetTypes ?? Object.entries(ASSET_LABELS).map(([key, label]) => ({ key: key as AssetType, label }))).map((definition) => <option value={definition.key} key={definition.key}>{definition.label}</option>)}</select></div>
            <div className="field"><label htmlFor="genre_id">ジャンル</label><select id="genre_id" value={draftFilters.genreId} onChange={updateDraftSelect("genreId")}><option value="">すべて</option>{meta?.genres.map((genre) => <option value={genre.id} key={genre.id}>{genre.name}</option>)}</select>{metaError ? <div className="genre-note">ジャンル情報を取得できませんでした</div> : null}</div>
            <div className="field"><label htmlFor="min_samples">最低サンプル枚数</label><input id="min_samples" type="number" min="1" max="100" value={draftFilters.minSamples} onChange={updateDraftNumber("minSamples")} /></div>
            <div className="field"><label htmlFor="min_reviews">最低レビュー件数</label><input id="min_reviews" type="number" min="0" max="100000" value={draftFilters.minReviews} onChange={updateDraftNumber("minReviews")} /></div>
            <div className="field field--full"><label htmlFor="min_rating">最低平均評価</label><input id="min_rating" type="number" min="0" max="5" step="0.1" value={draftFilters.minRating} onChange={updateDraftNumber("minRating")} /></div>
          </div>
          <div className="filter-summary">現在: {activeConditionText}</div>
          <div className="sheet-actions"><button className="btn btn-secondary" type="button" onClick={() => setDraftFilters(DEFAULT_FILTERS)}>絞り込み解除</button><button className="btn btn-primary" type="submit" disabled={loading}>{loading ? "取得中…" : "この条件で見る"}</button></div>
        </form>
      </aside>

      <aside className={`sheet debug-sheet${debugOpen ? " is-open" : ""}`} aria-hidden={!debugOpen}>
        <div className="sheet-handle" />
        <div className="sheet-head debug-sheet-head"><div><div className="sheet-title">デバッグ</div><div className="debug-caption">表示用UIと分離した開発情報</div></div><div className="debug-head-actions"><button className="debug-refresh" type="button" onClick={() => void loadDebug()} disabled={debugLoading}>再取得</button><button className="close-btn" type="button" onClick={() => setDebugOpen(false)} aria-label="閉じる">×</button></div></div>
        {debugLoading && !debugData ? <div className="diag-loading"><span className="mini-spinner" /> DB・API状態を取得中…</div> : null}
        {debugError ? <div className="debug-error">{debugError}</div> : null}

        <section className="debug-section"><h3>現在のフィード</h3><div className="debug-grid">
          <DebugRow label="表示位置" value={`${items.length > 0 ? activeWork + 1 : 0} / ${items.length}`} />
          <DebugRow label="取得元" value={lastBatch?.source === "database" ? "MariaDB" : lastBatch?.source === "fanza-api" ? "FANZA API" : "-"} />
          <DebugRow label="直近走査件数" value={lastBatch?.scanned ?? 0} /><DebugRow label="対象総数" value={lastBatch?.apiTotal ?? 0} />
          <DebugRow label="nextOffset" value={nextOffset ?? "null"} /><DebugRow label="続き" value={hasMore ? "あり" : "なし"} status={hasMore ? "good" : "neutral"} />
          <DebugRow label="初期読込" value={loading ? "中" : "完了"} /><DebugRow label="追加読込" value={loadingMore ? "中" : "停止"} />
        </div><div className="debug-note">{activeConditionText}</div>{lastBatch?.queryError ? <div className="debug-error">CID: {lastBatch.queryError}</div> : null}{catalogError ? <div className="debug-error">Catalog: {catalogError}</div> : null}</section>

        <section className="debug-section"><h3>表示中作品</h3>{debugContext ? <><div className="debug-grid">
          <DebugRow label="index" value={debugContext.index + 1} /><DebugRow label="CID" value={debugContext.item.cid} />
          <DebugRow label="ページ" value={`${debugContext.currentPage + 1} / ${debugContext.item.images.length}`} /><DebugRow label="sampleCount" value={debugContext.item.sampleCount} />
          <DebugRow label="画像読込" value={`${debugContext.loadedImages} 成功 / ${debugContext.pendingImages} 待機 / ${debugContext.failedImages} 失敗`} status={debugContext.failedImages > 0 ? "bad" : "good"} />
          <DebugRow label="いいね" value={`${debugContext.liked ? "ON" : "OFF"} / ${debugContext.likeCount}件`} /><DebugRow label="保存" value={`${debugContext.saved ? "ON" : "OFF"} / ${debugContext.saveCount}件`} />
          <DebugRow label="assetType" value={debugContext.item.assetType} /><DebugRow label="assetBucket" value={debugContext.item.assetBucket || "-"} />
        </div><div className="debug-note debug-break">{debugContext.item.title}</div></> : currentItem ? <div className="debug-note">現在のCID: {currentItem.cid}。カードのデバッグボタンから開くと画像・リアクション状態まで取得できます。</div> : <div className="debug-note">表示中の作品はありません。</div>}</section>

        <section className="debug-section"><h3>MariaDB / サーバー</h3>{debugData ? <><div className="debug-grid">
          <DebugRow label="DB設定" value={debugData.database.configured ? "済" : "未設定"} status={debugData.database.configured ? "good" : "bad"} /><DebugRow label="DB接続" value={debugData.database.connected ? "OK" : "NG"} status={debugData.database.connected ? "good" : "bad"} />
          <DebugRow label="catalogReady" value={debugData.database.catalogReady ? "true" : "false"} status={debugData.database.catalogReady ? "good" : "bad"} /><DebugRow label="DB容量" value={formatBytes(debugData.database.sizeBytes)} />
          <DebugRow label="MariaDB/MySQL" value={debugData.database.serverVersion ?? "-"} /><DebugRow label="PHP" value={`${debugData.runtime.php} / ${debugData.runtime.sapi}`} />
          <DebugRow label="FANZA API" value={debugData.dmm.configured ? "設定済" : "未設定"} status={debugData.dmm.configured ? "good" : "bad"} />
        </div><div className="debug-subtitle">テーブル件数</div><div className="debug-grid">
          <DebugRow label="works" value={debugData.database.counts.works} /><DebugRow label="active works" value={debugData.database.counts.activeWorks} /><DebugRow label="sampleあり" value={debugData.database.counts.worksWithSamples} /><DebugRow label="初期表示対象" value={debugData.database.counts.defaultEligibleWorks} />
          <DebugRow label="genres" value={debugData.database.counts.genres} /><DebugRow label="work_genres" value={debugData.database.counts.workGenres} /><DebugRow label="anonymous_users" value={debugData.database.counts.anonymousUsers} /><DebugRow label="events" value={debugData.database.counts.events} /><DebugRow label="user_work_states" value={debugData.database.counts.userWorkStates} /><DebugRow label="user_genre_scores" value={debugData.database.counts.userGenreScores} />
        </div><div className="debug-subtitle">更新時刻</div><div className="debug-grid"><DebugRow label="作品最終更新" value={debugData.database.latest.workUpdatedAt ?? "-"} /><DebugRow label="イベント最終記録" value={debugData.database.latest.eventAt ?? "-"} /><DebugRow label="ユーザー最終行動" value={debugData.database.latest.userSeenAt ?? "-"} /><DebugRow label="診断生成" value={debugData.generatedAt} /></div></> : <div className="debug-note">サーバー情報はまだ取得していません。</div>}</section>

        <section className="debug-section"><h3>直近24時間イベント</h3>{debugData && Object.keys(debugData.database.eventCounts24h).length > 0 ? <div className="debug-grid">{Object.entries(debugData.database.eventCounts24h).map(([key, value]) => <DebugRow key={key} label={key} value={value} />)}</div> : <div className="debug-note">まだイベントはありません。</div>}</section>

        <section className="debug-section"><h3>sample_l 枚数分布</h3>{debugData?.diagnostics ? <><table className="diag-table"><thead><tr><th>素材</th><th>総数</th><th>0P</th><th>1–4P</th><th>5–9P</th><th>10P+</th></tr></thead><tbody>{STAT_KEYS.map((key) => <DiagnosticRow key={key} label={meta?.assetTypes.find((definition) => definition.key === key)?.label ?? ASSET_LABELS[key]} stats={debugData.diagnostics!.stats[key]} active={filters.assetType === key} />)}</tbody></table><div className="debug-note">診断走査 {debugData.diagnostics.scanned}件 / 対象総数 {debugData.diagnostics.apiTotal}件</div></> : <div className="debug-note">{debugData?.diagnosticsError ?? "データなし"}</div>}</section>

        <section className="debug-section"><h3>ブラウザ</h3>{browserDebug ? <div className="debug-grid"><DebugRow label="viewport" value={browserDebug.viewport} /><DebugRow label="DPR" value={browserDebug.devicePixelRatio} /><DebugRow label="online" value={browserDebug.online ? "true" : "false"} /><DebugRow label="visibility" value={browserDebug.visibility} /><div className="debug-row debug-row--full"><span>URL</span><strong>{browserDebug.url}</strong></div><div className="debug-row debug-row--full"><span>User-Agent</span><strong>{browserDebug.userAgent}</strong></div></div> : null}</section>

        <section className="debug-section"><h3>CID直接テスト</h3><form className="cid-test debug-cid-test" onSubmit={openCid}><input value={cidDraft} onChange={(event: ChangeEvent<HTMLInputElement>) => setCidDraft(event.target.value)} placeholder="CID / FANZA商品URL" autoComplete="off" /><button type="submit" disabled={loading || !cidDraft.trim()}>開く</button></form>{cid ? <div className="cid-active">直接表示中: {cid}</div> : null}</section>
        <details className="debug-raw"><summary>生データを表示</summary><pre>{JSON.stringify({ client: clientDebug, server: debugData }, null, 2)}</pre></details>
      </aside>

      <div className={`toast${toast ? " is-show" : ""}`}>{toast}</div>
    </>
  );
}
