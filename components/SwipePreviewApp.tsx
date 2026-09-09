import {
  type KeyboardEvent as ReactKeyboardEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { FocusModeToggle } from "@/components/FocusModeToggle";
import { GlobalNav } from "@/components/GlobalNav";
import { SettingsIcon } from "@/components/icons";
import { WorkCard } from "@/components/WorkCard";
import type { CatalogResponse, FeedItem } from "@/lib/types";
import { fetchJson } from "@/src/api";
import { preloadAndDecodeImage } from "@/src/imagePreload";
import { rememberActiveReader } from "@/src/readerResumeState";
import {
  applyReaderControlsVisibility,
  loadReaderSettings,
  readerSettingsEqual,
  saveReaderSettings,
  subscribeReaderSettings,
  type ReaderSettings,
} from "@/src/readerSettings";
import { mergeUniqueByCid } from "@/src/workUtils";

const INITIAL_LIMIT = 6;
const PREFETCH_THRESHOLD = 3;
const WINDOW_RADIUS = 2;

type Props = { initialCid: string };

function buildCatalogQuery(
  options: { feedId?: string | null; cursor?: number; limit?: number; cid?: string } = {},
) {
  const params = new URLSearchParams({
    cursor: String(options.cursor ?? 0),
    limit: String(options.limit ?? INITIAL_LIMIT),
  });
  if (options.feedId) params.set("feed_id", options.feedId);
  if (options.cid?.trim()) params.set("cid", options.cid.trim());
  return params;
}

export function SwipePreviewApp({ initialCid }: Props) {
  const feedRef = useRef<HTMLElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
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

  const [items, setItems] = useState<FeedItem[]>([]);
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(() => loadReaderSettings());
  const [feedId, setFeedId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  useEffect(() => subscribeReaderSettings((next) => {
    setReaderSettings((current) => readerSettingsEqual(current, next) ? current : next);
  }), []);

  useEffect(() => {
    saveReaderSettings(readerSettings);
    applyReaderControlsVisibility(readerSettings.controlsHidden);
    return () => applyReaderControlsVisibility(false);
  }, [readerSettings]);

  const loadInitial = useCallback(async (nextCid = "") => {
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
      const query = buildCatalogQuery({ cursor: 0, limit: INITIAL_LIMIT, cid: nextCid });
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
      setTargetTotal(catalog.source === "database" ? catalog.apiTotal : 0);
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
      const query = buildCatalogQuery({ feedId, cursor: nextCursor, limit: INITIAL_LIMIT });
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
      setItems((current) => mergeUniqueByCid(current, catalog.items));
      setFeedId(catalog.feedId);
      setNextCursor(catalog.nextCursor);
      setHasMore(catalog.hasMore);
      setTargetTotal(catalog.source === "database" ? catalog.apiTotal : 0);
      setLoadMoreError("");
    } catch (error) {
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      setLoadMoreError(error instanceof Error ? error.message : "追加取得に失敗しました");
    } finally {
      if (loadMoreInFlight.current === requestGeneration) loadMoreInFlight.current = null;
      if (generation.current === requestGeneration) setLoadingMore(false);
    }
  }, [feedId, hasMore, loadMoreError, nextCursor]);

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
    void loadInitial(initialCid);
  }, [initialCid, loadInitial]);

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
    const item = items[activeWork];
    if (!item) return;
    const page = pageByCid.current.get(item.cid) ?? 0;
    rememberActiveReader({ cid: item.cid, pageIndex: page, isCta: page >= item.images.length });
  }, [activeWork, items]);

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
    if (sheet) sheet.inert = !settingsOpen;
    if (feed) feed.inert = settingsOpen;
    if (!settingsOpen) return;

    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : settingsButtonRef.current;
    window.requestAnimationFrame(() => sheet?.querySelector<HTMLElement>("button,input")?.focus());
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
      if (event.key === "Tab" && sheet) {
        const focusable = [...sheet.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])')];
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
  }, [settingsOpen]);

  useEffect(() => () => {
    initialAbort.current?.abort();
    moreAbort.current?.abort();
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (feedScrollRaf.current !== null) cancelAnimationFrame(feedScrollRaf.current);
  }, []);

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
    if (event.target instanceof Element && event.target.closest("dialog[open]")) return;
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
            ref={settingsButtonRef}
            className="icon-btn"
            type="button"
            aria-label="ビューアー設定"
            title="設定"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <FocusModeToggle active={readerSettings.controlsHidden} onToggle={toggleReaderControls} />

      <main
        ref={feedRef}
        className="feed"
        id="feed"
        aria-label="おすすめ同人コミックフィード"
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
              <h2>おすすめを読み込んでいます</h2>
            </div>
          </section>
        ) : catalogError ? (
          <section className="empty-state">
            <div className="empty-card">
              <h2>コミックを取得できませんでした</h2>
              <p>{catalogError}</p>
              <button className="btn btn-primary" type="button" onClick={() => void loadInitial(initialCid)}>再試行</button>
            </div>
          </section>
        ) : items.length === 0 ? (
          <section className="empty-state">
            <div className="empty-card">
              <h2>表示できるコミックがありません</h2>
              <button className="btn btn-primary" type="button" onClick={() => void loadInitial(initialCid)}>再読み込み</button>
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
              if (index === activeWork) {
                rememberActiveReader({ cid: workCid, pageIndex: page, isCta });
              }
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
          <span className="mini-spinner" aria-hidden="true" /> 次のコミックを準備中
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
        className={`sheet-backdrop${settingsOpen ? " is-open" : ""}`}
        onClick={() => setSettingsOpen(false)}
        aria-hidden="true"
      />
      <aside
        ref={sheetRef}
        className={`sheet${settingsOpen ? " is-open" : ""}`}
        id="readerSettingsSheet"
        role="dialog"
        aria-modal="true"
        aria-label="ビューアー設定"
        aria-hidden={!settingsOpen}
      >
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-title">設定</div>
          <button className="close-btn" type="button" onClick={() => setSettingsOpen(false)} aria-label="閉じる">×</button>
        </div>

        <section className="reader-settings-panel" aria-labelledby="reader_settings_title">
          <h2 id="reader_settings_title">ビューアー設定</h2>
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
        </section>
      </aside>
    </>
  );
}
