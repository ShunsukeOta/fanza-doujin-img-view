"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AssetType,
  CatalogResponse,
  FeedItem,
  FilterValues,
  MetaResponse,
  SampleStats,
  SampleStatsRow,
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
  minSamples: 10,
  minReviews: 10,
  minRating: 4.5,
};

const STAT_KEYS: AssetType[] = ["all", "comic", "cg", "game", "voice", "other"];
const EMPTY_ROW: SampleStatsRow = { total: 0, zero: 0, oneToFour: 0, fiveToNine: 0, tenPlus: 0 };

type Props = {
  initialFilters: FilterValues;
  initialCid: string;
};

type LoadState = "pending" | "loaded" | "error";

type DiagnosticsResponse = {
  scanned: number;
  apiTotal: number;
  stats: SampleStats;
};

function buildCatalogQuery(filters: FilterValues, cid = "") {
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
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  return fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function FilterIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
}
function HeartIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" /></svg>;
}
function BookmarkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4V4Z" /></svg>;
}
function ShareIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></svg>;
}
function ExternalIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>;
}

function WorkCard({ item, index, totalWorks, onToast }: { item: FeedItem; index: number; totalWorks: number; onToast: (message: string) => void }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [loadStates, setLoadStates] = useState<LoadState[]>(() => item.images.map(() => "pending"));
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const dragRef = useRef({ pointerId: -1, startX: 0, startY: 0, startScroll: 0, startTime: 0, axis: "" as "" | "x" | "y" });

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

  const pageIndexFromScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth <= 0) return 0;
    return clamp(Math.round(track.scrollLeft / track.clientWidth), 0, item.images.length - 1);
  }, [item.images.length]);

  const goToPage = useCallback((target: number, behavior: ScrollBehavior = "smooth") => {
    const track = trackRef.current;
    if (!track || item.images.length === 0) return;
    const next = clamp(target, 0, item.images.length - 1);
    track.classList.remove("is-dragging");
    track.scrollTo({ left: next * track.clientWidth, behavior });
    setCurrentPage(next);
  }, [item.images.length]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const track = trackRef.current;
    if (!track) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScroll: track.scrollLeft,
      startTime: performance.now(),
      axis: "",
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    const drag = dragRef.current;
    if (!track || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) drag.axis = Math.abs(dx) > Math.abs(dy) * 1.12 ? "x" : "y";
    if (drag.axis !== "x") return;
    event.preventDefault();
    track.classList.add("is-dragging");
    track.scrollLeft = drag.startScroll - dx;
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const track = trackRef.current;
    if (!track) return;
    if (drag.axis === "x") {
      const dx = event.clientX - drag.startX;
      const elapsed = Math.max(1, performance.now() - drag.startTime);
      const velocity = Math.abs(dx) / elapsed;
      let target = Math.round(drag.startScroll / Math.max(1, track.clientWidth));
      if (Math.abs(dx) > 48 || velocity > 0.45) target += dx < 0 ? 1 : -1;
      goToPage(target);
    } else {
      track.classList.remove("is-dragging");
    }
    dragRef.current.pointerId = -1;
    dragRef.current.axis = "";
  };

  const toggleLocal = (type: "like" | "save") => {
    const key = `fanza-preview:${type}:${item.cid}`;
    const current = type === "like" ? liked : saved;
    try {
      if (current) localStorage.removeItem(key);
      else localStorage.setItem(key, "1");
    } catch {
      onToast("ブラウザに保存できませんでした");
      return;
    }
    if (type === "like") setLiked(!current);
    else setSaved(!current);
    onToast(type === "like" ? (current ? "いいねを解除しました" : "いいねしました") : (current ? "保存を解除しました" : "保存しました"));
  };

  const share = async () => {
    const url = item.affiliateUrl || window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: item.title || "FANZA同人作品", url });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        onToast("リンクをコピーしました");
      } else onToast("このブラウザでは共有できません");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      onToast("共有できませんでした");
    }
  };

  return (
    <article className="feed-item" data-work-index={index} data-cid={item.cid} aria-label={`${index + 1}件目 ${item.title || item.cid}`}>
      <div
        ref={trackRef}
        className="preview-track"
        data-preview-track
        tabIndex={0}
        onScroll={() => setCurrentPage(pageIndexFromScroll())}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            goToPage(currentPage + (event.key === "ArrowRight" ? 1 : -1));
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        {item.images.map((url, pageIndex) => (
          <div className={`preview-page${loadStates[pageIndex] === "error" ? " is-error" : ""}`} key={`${item.cid}-${pageIndex}`}>
            <img
              src={url}
              alt={`${item.title} サンプル ${pageIndex + 1}`}
              loading={index < 2 && pageIndex < 2 ? "eager" : "lazy"}
              decoding="async"
              onLoad={() => markLoad(pageIndex, "loaded")}
              onError={() => markLoad(pageIndex, "error")}
            />
          </div>
        ))}
      </div>

      <div className="page-counter"><span>{currentPage + 1}</span>&nbsp;/&nbsp;{item.images.length}</div>
      <div className={`load-status${failed > 0 ? " has-error" : ""}`}>API {item.images.length}P · 読込 {loaded}/{item.images.length}{failed > 0 ? ` · 失敗 ${failed}` : ""}</div>
      {item.images.length > 1 && index === 0 ? <div className="swipe-hint">← 横にスワイプして読む →</div> : null}

      <div className="item-gradient" />
      <div className="item-info">
        <div className="item-type">{item.assetLabel} · API素材 {item.assetBucket}</div>
        <h2 className="item-title">{item.title || item.cid}</h2>
        <div className="item-stats">
          <span className="stat-chip">★ <strong>{item.rating.toFixed(1)}</strong></span>
          <span className="stat-chip">レビュー <strong>{item.reviews}</strong></span>
          <span className="stat-chip">サンプル <strong>{item.images.length}</strong>P</span>
          {item.price ? <span className="stat-chip"><strong>{item.price}</strong></span> : null}
        </div>
        {item.genres.length > 0 ? <div className="genre-line">{item.genres.slice(0, 6).join(" / ")}</div> : null}
        {/^(https?:\/\/)/i.test(item.affiliateUrl) ? (
          <a className="open-link" href={item.affiliateUrl} target="_blank" rel="noopener noreferrer sponsored">FANZAで続きを読む <ExternalIcon /></a>
        ) : null}
      </div>

      <div className="action-rail">
        <button className={`action-btn${liked ? " is-active" : ""}`} type="button" onClick={() => toggleLocal("like")}><span className="action-icon"><HeartIcon /></span><span className="action-label">いいね</span></button>
        <button className={`action-btn${saved ? " is-active" : ""}`} type="button" onClick={() => toggleLocal("save")}><span className="action-icon"><BookmarkIcon /></span><span className="action-label">保存</span></button>
        <button className="action-btn" type="button" onClick={share}><span className="action-icon"><ShareIcon /></span><span className="action-label">共有</span></button>
      </div>
      {index < totalWorks - 1 ? <div className="next-hint">SWIPE UP</div> : null}
    </article>
  );
}

function DiagnosticRow({ label, stats, active }: { label: string; stats: SampleStatsRow; active: boolean }) {
  return <tr className={active ? "is-active" : undefined}><td>{label}</td><td>{stats.total}</td><td>{stats.zero}</td><td>{stats.oneToFour}</td><td>{stats.fiveToNine}</td><td>{stats.tenPlus}</td></tr>;
}

export function SwipePreviewAppOptimized({ initialFilters, initialCid }: Props) {
  const feedRef = useRef<HTMLElement | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [diagnosticsGenreId, setDiagnosticsGenreId] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const [filters, setFilters] = useState<FilterValues>(initialFilters);
  const [draftFilters, setDraftFilters] = useState<FilterValues>(initialFilters);
  const [cid, setCid] = useState(initialCid);
  const [cidDraft, setCidDraft] = useState(initialCid);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [metaError, setMetaError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeWork, setActiveWork] = useState(0);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelLock = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1600);
  }, []);

  const loadMeta = useCallback(async () => {
    const response = await fetch("/api/meta", { headers: { Accept: "application/json" } });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(normalizeApiError(data, `メタ情報の取得に失敗しました (${response.status})`));
    setMeta(data as MetaResponse);
  }, []);

  const loadCatalog = useCallback(async (nextFilters: FilterValues, nextCid = "") => {
    setLoading(true);
    setCatalogError("");
    setActiveWork(0);
    try {
      const query = buildCatalogQuery(nextFilters, nextCid);
      const response = await fetch(`/api/catalog?${query.toString()}`, { headers: { Accept: "application/json" } });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(normalizeApiError(data, `作品取得に失敗しました (${response.status})`));
      setCatalog(data as CatalogResponse);
    } catch (requestError) {
      setCatalog(null);
      setCatalogError(requestError instanceof Error ? requestError.message : "作品取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDiagnostics = useCallback(async (genreId: string) => {
    setDiagnosticsLoading(true);
    setDiagnosticsError("");
    try {
      const query = new URLSearchParams({ genre_id: genreId });
      const response = await fetch(`/api/diagnostics?${query.toString()}`, { headers: { Accept: "application/json" } });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(normalizeApiError(data, `API診断の取得に失敗しました (${response.status})`));
      setDiagnostics(data as DiagnosticsResponse);
      setDiagnosticsGenreId(genreId);
    } catch (requestError) {
      setDiagnostics(null);
      setDiagnosticsGenreId(null);
      setDiagnosticsError(requestError instanceof Error ? requestError.message : "API診断の取得に失敗しました。");
    } finally {
      setDiagnosticsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog(initialFilters, initialCid);
    void loadMeta().then(() => setMetaError("")).catch((requestError) => {
      setMetaError(requestError instanceof Error ? requestError.message : "メタ情報の取得に失敗しました。");
    });
  }, [initialCid, initialFilters, loadCatalog, loadMeta]);

  useEffect(() => {
    if (!sheetOpen) return;
    document.body.classList.add("sheet-open");
    if (diagnosticsGenreId !== filters.genreId && !diagnosticsLoading) void loadDiagnostics(filters.genreId);
    return () => document.body.classList.remove("sheet-open");
  }, [diagnosticsGenreId, diagnosticsLoading, filters.genreId, loadDiagnostics, sheetOpen]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || !catalog?.items.length) return;
    const works = [...feed.querySelectorAll<HTMLElement>(".feed-item")];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.62) continue;
        setActiveWork(Number((entry.target as HTMLElement).dataset.workIndex ?? 0));
      }
    }, { root: feed, threshold: [0.62] });
    works.forEach((work) => observer.observe(work));
    return () => observer.disconnect();
  }, [catalog?.items]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const activeGenreName = useMemo(() => meta?.genres.find((genre) => genre.id === filters.genreId)?.name ?? "", [filters.genreId, meta?.genres]);
  const activeAssetLabel = meta?.assetTypes.find((definition) => definition.key === filters.assetType)?.label ?? ASSET_LABELS[filters.assetType];
  const activeConditionText = `${activeAssetLabel} · ${activeGenreName || "全ジャンル"}`;
  const feedItems = catalog?.items ?? [];
  const diagnosticStats = diagnosticsGenreId === filters.genreId ? diagnostics?.stats : null;

  const replaceUrl = (nextFilters: FilterValues, nextCid = "") => {
    const query = buildCatalogQuery(nextFilters, nextCid);
    window.history.replaceState(null, "", `?${query.toString()}`);
  };

  const applyFilters = async (event: FormEvent) => {
    event.preventDefault();
    const next = { ...draftFilters };
    setFilters(next);
    setCid("");
    setCidDraft("");
    setSheetOpen(false);
    if (next.genreId !== filters.genreId) {
      setDiagnostics(null);
      setDiagnosticsGenreId(null);
    }
    replaceUrl(next);
    await loadCatalog(next);
  };

  const openCid = async (event: FormEvent) => {
    event.preventDefault();
    const nextCid = cidDraft.trim();
    if (!nextCid) return;
    setCid(nextCid);
    setSheetOpen(false);
    replaceUrl(filters, nextCid);
    await loadCatalog(filters, nextCid);
  };

  const updateDraftSelect = (key: "assetType" | "genreId") => (event: ChangeEvent<HTMLSelectElement>) => {
    setDraftFilters((previous) => ({ ...previous, [key]: event.target.value } as FilterValues));
  };
  const updateDraftNumber = (key: "minSamples" | "minReviews" | "minRating") => (event: ChangeEvent<HTMLInputElement>) => {
    const value = key === "minRating" ? Number.parseFloat(event.target.value) : Number.parseInt(event.target.value, 10);
    if (!Number.isFinite(value)) return;
    setDraftFilters((previous) => ({ ...previous, [key]: value }));
  };

  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (!catalog?.items.length || wheelLock.current || Math.abs(event.deltaY) < 18) return;
    event.preventDefault();
    const feed = feedRef.current;
    if (!feed) return;
    const works = [...feed.querySelectorAll<HTMLElement>(".feed-item")];
    const current = Math.round(feed.scrollTop / Math.max(1, feed.clientHeight));
    const next = clamp(current + (event.deltaY > 0 ? 1 : -1), 0, works.length - 1);
    works[next]?.scrollIntoView({ behavior: "smooth", block: "start" });
    wheelLock.current = true;
    setTimeout(() => { wheelLock.current = false; }, 420);
  };

  return (
    <>
      <header className="app-header">
        <div className="brand"><div className="brand-mark">F</div><div className="brand-copy"><div className="brand-title">Swipe Preview</div><div className="brand-condition">{activeConditionText}</div></div></div>
        <div className="header-actions"><div className="feed-count"><span>{feedItems.length > 0 ? activeWork + 1 : 0}</span> / {feedItems.length}</div><button className="icon-btn" type="button" onClick={() => setSheetOpen(true)}><FilterIcon /> 絞り込み</button></div>
      </header>

      {catalog?.queryError ? <div className="error-banner">CID取得エラー: {catalog.queryError}</div> : null}

      <main ref={feedRef} className="feed" id="feed" aria-label="作品フィード" onWheel={handleWheel}>
        {loading ? (
          <section className="empty-state"><div className="empty-card loading-card"><div className="spinner" aria-hidden="true" /><h2>作品を読み込んでいます</h2><p>表示条件に合う作品が揃い次第、すぐにフィードを表示します。</p></div></section>
        ) : catalogError ? (
          <section className="empty-state"><div className="empty-card"><h2>API取得に失敗しました</h2><p>{catalogError}</p><button className="btn btn-primary" type="button" onClick={() => setSheetOpen(true)}>API診断を見る</button></div></section>
        ) : feedItems.length === 0 ? (
          <section className="empty-state"><div className="empty-card"><h2>条件に合う表示可能作品がありません</h2><p>右上の「絞り込み」を開くと、API走査結果のsample_l枚数分布を確認できます。</p><button className="btn btn-primary" type="button" onClick={() => setSheetOpen(true)}>API診断を見る</button></div></section>
        ) : feedItems.map((item, index) => <WorkCard key={item.cid} item={item} index={index} totalWorks={feedItems.length} onToast={showToast} />)}
      </main>

      <div className="sheet-backdrop" onClick={() => setSheetOpen(false)} aria-hidden="true" />
      <aside className="sheet" id="filterSheet" aria-hidden={!sheetOpen}>
        <div className="sheet-handle" />
        <div className="sheet-head"><div className="sheet-title">作品を絞り込む / API診断</div><button className="close-btn" type="button" onClick={() => setSheetOpen(false)} aria-label="閉じる">×</button></div>
        <div className="api-note"><strong>重要:</strong> ItemListの <code>iteminfo.genre</code> はジャンルタグで、作品形式ではありません。このツールではAPIが返す <code>imageURL / sampleImageURL</code> の <code>/digital/comic|cg|game|voice/</code> を「API素材タイプ」として別軸で判定します。</div>

        <form onSubmit={applyFilters}>
          <div className="filters">
            <div className="field"><label htmlFor="asset_type">API素材タイプ</label><select id="asset_type" value={draftFilters.assetType} onChange={updateDraftSelect("assetType")}>{(meta?.assetTypes ?? STAT_KEYS.map((key) => ({ key, label: ASSET_LABELS[key] }))).map((definition) => <option value={definition.key} key={definition.key}>{definition.label}</option>)}</select></div>
            <div className="field"><label htmlFor="genre_id">ジャンル</label><select id="genre_id" value={draftFilters.genreId} onChange={updateDraftSelect("genreId")}><option value="">すべて</option>{meta?.genres.map((genre) => <option value={genre.id} key={genre.id}>{genre.name}</option>)}</select>{metaError ? <div className="genre-note">GenreSearch: {metaError}</div> : null}</div>
            <div className="field"><label htmlFor="min_samples">最低sample_l枚数</label><input id="min_samples" type="number" min="0" max="100" value={draftFilters.minSamples} onChange={updateDraftNumber("minSamples")} /></div>
            <div className="field"><label htmlFor="min_reviews">最低レビュー件数</label><input id="min_reviews" type="number" min="0" max="100000" value={draftFilters.minReviews} onChange={updateDraftNumber("minReviews")} /></div>
            <div className="field field--full"><label htmlFor="min_rating">最低平均評価</label><input id="min_rating" type="number" min="0" max="5" step="0.1" value={draftFilters.minRating} onChange={updateDraftNumber("minRating")} /></div>
          </div>

          <div className="filter-summary">
            {catalog?.floor ? <>API: {catalog.floor.siteCode} / {catalog.floor.serviceCode} / {catalog.floor.floorCode} / floor_id {catalog.floor.floorId}<br /></> : null}
            現在: {activeConditionText} / sample_l {filters.minSamples}枚以上 / レビュー {filters.minReviews}件以上 / 評価 {filters.minRating.toFixed(1)}以上<br />
            フィード取得走査: {catalog?.scanned ?? 0}件{catalog?.apiTotal ? ` / API該当総数 ${catalog.apiTotal}件` : ""} / フィード: {feedItems.length}作品
            {filters.minSamples < 1 ? <><br />※フィード表示には画像が必要なため、sample_l=0件は診断には含めますが表示対象外です。</> : null}
          </div>

          <div className="diag">
            <div className="diag-title">sample_l 枚数分布</div>
            <div className="diag-sub">
              {diagnosticsLoading
                ? "最大800件のAPI診断をバックグラウンドで取得しています。フィード表示には影響しません。"
                : diagnosticsError
                  ? `診断取得エラー: ${diagnosticsError}`
                  : diagnosticStats
                    ? `現在のジャンル条件で${diagnostics?.scanned ?? 0}件を走査した完全診断です。レビュー/評価/sample_l数値フィルタ適用前に集計しています。`
                    : "絞り込みを開いた時だけ最大800件の診断を取得します。"}
            </div>
            <table className="diag-table">
              <thead><tr><th>API素材</th><th>総数</th><th>0P</th><th>1–4P</th><th>5–9P</th><th>10P+</th></tr></thead>
              <tbody>{STAT_KEYS.map((key) => <DiagnosticRow key={key} label={meta?.assetTypes.find((definition) => definition.key === key)?.label ?? ASSET_LABELS[key]} stats={diagnosticStats?.[key] ?? EMPTY_ROW} active={filters.assetType === key} />)}</tbody>
            </table>
            {diagnosticStats && Object.keys(diagnosticStats.rawBuckets).length > 0 ? <div className="diag-sub diag-raw">その他bucket: {Object.entries(diagnosticStats.rawBuckets).map(([key, value]) => `${key}:${value}`).join(" / ")}</div> : null}
          </div>

          <div className="sheet-actions"><button className="btn btn-secondary" type="button" onClick={() => setDraftFilters(DEFAULT_FILTERS)}>初期値に戻す</button><button className="btn btn-primary" type="submit" disabled={loading}>{loading ? "取得中…" : "この条件で見る"}</button></div>
        </form>

        <form className="cid-test" onSubmit={openCid}><input value={cidDraft} onChange={(event: ChangeEvent<HTMLInputElement>) => setCidDraft(event.target.value)} placeholder="CID / FANZA商品URLで直接テスト" autoComplete="off" /><button type="submit" disabled={loading || !cidDraft.trim()}>開く</button></form>
        {cid ? <div className="cid-active">直接表示中: {cid}</div> : null}
      </aside>

      <div className={`toast${toast ? " is-show" : ""}`}>{toast}</div>
    </>
  );
}
