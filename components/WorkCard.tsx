import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { BookmarkIcon, ExternalIcon, HeartIcon, ShareIcon } from "@/components/icons";
import type { FeedItem, ReactionSummary } from "@/lib/types";
import { createViewId, trackEvent } from "@/src/analytics";
import { formatPrice } from "@/src/price";
import { loadReactions, updateReaction } from "@/src/reactions";

type LoadState = "pending" | "loaded" | "error";
type GestureAxis = "x" | "y" | null;
type GestureState = {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startFeedScrollTop: number;
  startPage: number;
  startedAt: number;
  axis: GestureAxis;
};
type WorkDetails = {
  remainingPages: number | null;
  price: string;
  priceValue: number | null;
  affiliateUrl: string;
  available: boolean;
};
type ViewState = {
  id: string;
  startedAt: number;
  startSamplePage: number;
  maxSamplePage: number;
  sampleLoaded: boolean;
  completed: boolean;
  ctaViewed: boolean;
};

type Props = {
  item: FeedItem;
  index: number;
  isActive: boolean;
  initialPage?: number;
  onPageChange?: (cid: string, page: number, isCta: boolean) => void;
  onToast: (message: string) => void;
  onVerticalSwipe?: (direction: -1 | 1) => void;
};

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function formatCount(value: number) { return Math.max(0, value).toLocaleString("ja-JP"); }
function validExternalUrl(value: string) { return /^https?:\/\//i.test(value); }

function initialDetails(item: FeedItem): WorkDetails {
  const fullPages = typeof item.fullPageCount === "number" ? item.fullPageCount : null;
  return {
    remainingPages: fullPages === null ? null : Math.max(0, fullPages - item.sampleCount),
    price: item.price,
    priceValue: item.priceValue ?? null,
    affiliateUrl: item.affiliateUrl,
    available: item.available !== false,
  };
}

export function WorkCard({ item, index, isActive, initialPage = 0, onPageChange, onToast, onVerticalSwipe }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pageSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const feedAnimationFrame = useRef<number | null>(null);
  const pageAnimationFrame = useRef<number | null>(null);
  const detailsRequested = useRef(false);
  const viewRef = useRef<ViewState | null>(null);
  const [currentPage, setCurrentPage] = useState(Math.max(0, initialPage));
  const [loadStates, setLoadStates] = useState<LoadState[]>(() => item.images.map(() => "pending"));
  const [retryNonce, setRetryNonce] = useState<Record<number, number>>({});
  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const [likeCount, setLikeCount] = useState(item.likeCount);
  const [saveCount, setSaveCount] = useState(item.saveCount);
  const [reactionPending, setReactionPending] = useState<"like" | "save" | null>(null);
  const [details, setDetails] = useState<WorkDetails>(() => initialDetails(item));
  const [detailsLoading, setDetailsLoading] = useState(false);

  const ctaPage = item.images.length;
  const feedElement = useCallback(() => trackRef.current?.closest<HTMLElement>(".feed") ?? null, []);
  const eventContext = useCallback(() => ({ viewId: viewRef.current?.id, feedId: item.feedId ?? null, rank: item.rank ?? index + 1 }), [index, item.feedId, item.rank]);

  const finishView = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    viewRef.current = null;
    const samples = Math.max(1, item.images.length);
    const dwellMs = Math.max(0, Math.round(performance.now() - view.startedAt));
    const maxSamplePage = clamp(view.maxSamplePage, 0, samples - 1);
    trackEvent({
      eventType: "view_end",
      cid: item.cid,
      viewId: view.id,
      feedId: item.feedId ?? null,
      rank: item.rank ?? index + 1,
      dwellMs,
      maxPage: maxSamplePage,
      readRatio: Math.min(1, (maxSamplePage + 1) / samples),
      metadata: {
        sampleLoaded: view.sampleLoaded,
        progressedPages: Math.max(0, maxSamplePage - view.startSamplePage),
        sampleCount: item.images.length,
        completed: view.completed,
      },
    });
  }, [index, item.cid, item.feedId, item.images.length, item.rank]);

  useEffect(() => {
    if (!isActive) { finishView(); return; }
    if (viewRef.current) return;
    const initialSample = clamp(Math.min(currentPage, Math.max(0, item.images.length - 1)), 0, Math.max(0, item.images.length - 1));
    const view: ViewState = {
      id: createViewId(),
      startedAt: performance.now(),
      startSamplePage: initialSample,
      maxSamplePage: initialSample,
      sampleLoaded: loadStates.some((state) => state === "loaded"),
      completed: false,
      ctaViewed: false,
    };
    viewRef.current = view;
    trackEvent({ eventType: "work_impression", cid: item.cid, viewId: view.id, feedId: item.feedId ?? null, rank: item.rank ?? index + 1, metadata: { recommendationSource: item.recommendationSource ?? "" } });
    return finishView;
  }, [currentPage, finishView, index, isActive, item.cid, item.feedId, item.images.length, item.rank, item.recommendationSource, loadStates]);

  const cancelFeedAnimation = useCallback(() => { if (feedAnimationFrame.current !== null) { cancelAnimationFrame(feedAnimationFrame.current); feedAnimationFrame.current = null; } }, []);
  const cancelPageAnimation = useCallback(() => { if (pageAnimationFrame.current !== null) { cancelAnimationFrame(pageAnimationFrame.current); pageAnimationFrame.current = null; } }, []);

  const animateFeedToWork = useCallback((targetIndex: number) => {
    const feed = feedElement(); if (!feed) return;
    const target = feed.querySelector<HTMLElement>(`.feed-item[data-work-index="${targetIndex}"]`); if (!target) return;
    cancelFeedAnimation(); const start = feed.scrollTop; const end = target.offsetTop; const distance = end - start;
    if (Math.abs(distance) < 1 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { feed.scrollTop = end; return; }
    const startedAt = performance.now(); const duration = 210;
    const step = (now: number) => { const p = clamp((now - startedAt) / duration, 0, 1); feed.scrollTop = start + distance * (1 - Math.pow(1 - p, 4)); if (p < 1) feedAnimationFrame.current = requestAnimationFrame(step); else { feed.scrollTop = end; feedAnimationFrame.current = null; } };
    feedAnimationFrame.current = requestAnimationFrame(step);
  }, [cancelFeedAnimation, feedElement]);

  const maxScrollLeft = useCallback(() => { const track = trackRef.current; return track ? Math.max(0, track.scrollWidth - track.clientWidth) : 0; }, []);
  const scrollLeftForPage = useCallback((page: number) => { const track = trackRef.current; if (!track || track.clientWidth <= 0) return 0; return clamp(maxScrollLeft() - clamp(page, 0, ctaPage) * track.clientWidth, 0, maxScrollLeft()); }, [ctaPage, maxScrollLeft]);
  const pageIndexFromScroll = useCallback(() => { const track = trackRef.current; if (!track || track.clientWidth <= 0) return 0; return clamp(Math.round((maxScrollLeft() - track.scrollLeft) / track.clientWidth), 0, ctaPage); }, [ctaPage, maxScrollLeft]);

  const commitCurrentPage = useCallback(() => {
    const page = pageIndexFromScroll(); setCurrentPage(page); onPageChange?.(item.cid, page, page === ctaPage);
  }, [ctaPage, item.cid, onPageChange, pageIndexFromScroll]);

  const loadDetails = useCallback(async () => {
    if (!isActive || detailsRequested.current) return;
    detailsRequested.current = true; setDetailsLoading(true);
    try {
      const response = await fetch(`/api/work-details?cid=${encodeURIComponent(item.cid)}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const data = await response.json().catch(() => null) as { ok?: boolean; remainingPages?: number | null; price?: string; priceValue?: number | null; affiliateUrl?: string; available?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "作品情報を取得できませんでした");
      setDetails({
        remainingPages: typeof data.remainingPages === "number" ? data.remainingPages : null,
        price: typeof data.price === "string" && data.price ? data.price : item.price,
        priceValue: typeof data.priceValue === "number" ? data.priceValue : item.priceValue ?? null,
        affiliateUrl: typeof data.affiliateUrl === "string" && data.affiliateUrl ? data.affiliateUrl : item.affiliateUrl,
        available: data.available !== false,
      });
    } catch { detailsRequested.current = false; }
    finally { setDetailsLoading(false); }
  }, [isActive, item.affiliateUrl, item.cid, item.price, item.priceValue]);

  const goToPage = useCallback((target: number, behavior: ScrollBehavior = "smooth") => {
    const track = trackRef.current; if (!track || item.images.length === 0) return;
    const next = clamp(target, 0, ctaPage); cancelPageAnimation(); if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current);
    const end = scrollLeftForPage(next);
    const commit = () => { track.scrollLeft = end; setCurrentPage(next); onPageChange?.(item.cid, next, next === ctaPage); };
    if (behavior === "auto" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || Math.abs(end - track.scrollLeft) < 1) { commit(); return; }
    const start = track.scrollLeft; const distance = end - start; const startedAt = performance.now();
    const step = (now: number) => { const p = clamp((now - startedAt) / 220, 0, 1); track.scrollLeft = start + distance * (1 - Math.pow(1 - p, 4)); if (p < 1) pageAnimationFrame.current = requestAnimationFrame(step); else { pageAnimationFrame.current = null; commit(); } };
    pageAnimationFrame.current = requestAnimationFrame(step);
  }, [cancelPageAnimation, ctaPage, item.cid, item.images.length, onPageChange, scrollLeftForPage]);

  useEffect(() => {
    setLoadStates(item.images.map(() => "pending")); setRetryNonce({}); setDetails(initialDetails(item)); detailsRequested.current = false;
    const page = clamp(initialPage, 0, item.images.length); setCurrentPage(page);
    const frame = requestAnimationFrame(() => goToPage(page, "auto")); return () => cancelAnimationFrame(frame);
  }, [goToPage, initialPage, item.cid, item.images]);

  useEffect(() => {
    const track = trackRef.current; if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { cancelPageAnimation(); track.scrollLeft = scrollLeftForPage(currentPage); }); observer.observe(track); return () => observer.disconnect();
  }, [cancelPageAnimation, currentPage, scrollLeftForPage]);

  useEffect(() => {
    if (!isActive) return;
    if (currentPage >= Math.max(0, ctaPage - 1)) void loadDetails();
    const view = viewRef.current; if (!view) return;
    if (currentPage === ctaPage) {
      if (!view.completed) { view.completed = true; trackEvent({ eventType: "sample_complete", cid: item.cid, viewId: view.id, feedId: item.feedId ?? null, rank: item.rank ?? index + 1, readRatio: 1 }); }
      if (!view.ctaViewed) { view.ctaViewed = true; trackEvent({ eventType: "cta_view", cid: item.cid, viewId: view.id, feedId: item.feedId ?? null, rank: item.rank ?? index + 1, placement: "reader_end", metadata: { focusMode: document.body.classList.contains("reader-focus") } }); }
      return;
    }
    if (loadStates[currentPage] !== "loaded") return;
    const page = currentPage;
    const timer = window.setTimeout(() => {
      const active = viewRef.current; if (!active || currentPage !== page) return;
      active.sampleLoaded = true; active.maxSamplePage = Math.max(active.maxSamplePage, page);
      const samples = Math.max(1, item.images.length);
      trackEvent({ eventType: "sample_page_view", cid: item.cid, viewId: active.id, feedId: item.feedId ?? null, rank: item.rank ?? index + 1, pageIndex: page, maxPage: active.maxSamplePage, readRatio: (active.maxSamplePage + 1) / samples });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [ctaPage, currentPage, index, isActive, item.cid, item.feedId, item.images.length, item.rank, loadDetails, loadStates]);

  useEffect(() => { setLiked(item.viewerLiked); setSaved(item.viewerSaved); setLikeCount(item.likeCount); setSaveCount(item.saveCount); }, [item.cid, item.likeCount, item.saveCount, item.viewerLiked, item.viewerSaved]);
  const applyReaction = useCallback((reaction: ReactionSummary) => { setLiked(reaction.viewerLiked); setSaved(reaction.viewerSaved); setLikeCount(reaction.likeCount); setSaveCount(reaction.saveCount); }, []);
  useEffect(() => {
    if (!isActive || reactionPending) return; let cancelled = false;
    void loadReactions([item.cid]).then((rows) => { if (!cancelled && rows[item.cid]) applyReaction(rows[item.cid]); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [applyReaction, isActive, item.cid, reactionPending]);

  useEffect(() => () => { if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current); cancelFeedAnimation(); cancelPageAnimation(); finishView(); }, [cancelFeedAnimation, cancelPageAnimation, finishView]);

  const markLoad = useCallback((pageIndex: number, state: LoadState) => {
    setLoadStates((previous) => { if (previous[pageIndex] === state) return previous; const next = [...previous]; next[pageIndex] = state; return next; });
    if (state === "loaded" && isActive && viewRef.current) {
      const view = viewRef.current; view.sampleLoaded = true;
      if (pageIndex === 0) trackEvent({ eventType: "first_sample_loaded", cid: item.cid, viewId: view.id, feedId: item.feedId ?? null, rank: item.rank ?? index + 1 });
    }
  }, [index, isActive, item.cid, item.feedId, item.rank]);

  const loaded = loadStates.filter((state) => state === "loaded").length;
  const scheduleCurrentPageCommit = () => { if (gestureRef.current?.axis === "x" || pageAnimationFrame.current !== null) return; if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current); pageSettleTimer.current = setTimeout(commitCurrentPage, 70); };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || !isActive || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current); cancelFeedAnimation(); cancelPageAnimation(); const feed = feedElement();
    gestureRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startScrollLeft: trackRef.current?.scrollLeft ?? 0, startFeedScrollTop: feed?.scrollTop ?? 0, startPage: pageIndexFromScroll(), startedAt: performance.now(), axis: null };
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current; const track = trackRef.current; if (!gesture || !track || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX; const dy = event.clientY - gesture.startY;
    if (gesture.axis === null && Math.max(Math.abs(dx), Math.abs(dy)) >= 7) { if (Math.abs(dx) > Math.abs(dy) * 1.08) gesture.axis = "x"; else if (Math.abs(dy) > Math.abs(dx) * 1.08) gesture.axis = "y"; else return; try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ } }
    if (gesture.axis === "x") { event.preventDefault(); track.scrollLeft = clamp(gesture.startScrollLeft - clamp(dx, -track.clientWidth * .92, track.clientWidth * .92), 0, maxScrollLeft()); return; }
    if (gesture.axis === "y") { event.preventDefault(); const feed = feedElement(); if (!feed) return; feed.scrollTop = clamp(gesture.startFeedScrollTop - clamp(dy, -feed.clientHeight * .92, feed.clientHeight * .92), 0, Math.max(0, feed.scrollHeight - feed.clientHeight)); }
  };
  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const gesture = gestureRef.current; gestureRef.current = null; if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX; const dy = event.clientY - gesture.startY; const elapsed = Math.max(1, performance.now() - gesture.startedAt);
    if (gesture.axis === "x") { const width = trackRef.current?.clientWidth ?? 0; const decisive = !cancelled && (Math.abs(dx) >= Math.max(28, width * .1) || Math.abs(dx) / elapsed >= .4); goToPage(decisive ? gesture.startPage + (dx > 0 ? 1 : -1) : gesture.startPage); return; }
    if (gesture.axis === "y") { const feed = feedElement(); const height = feed?.clientHeight ?? window.innerHeight; const decisive = !cancelled && (Math.abs(dy) >= Math.max(48, height * .1) || Math.abs(dy) / elapsed >= .42); const direction: -1 | 1 = dy < 0 ? 1 : -1; const requested = decisive ? index + direction : index; const target = feed?.querySelector<HTMLElement>(`.feed-item[data-work-index="${requested}"]`); if (decisive && !target) { onVerticalSwipe?.(direction); animateFeedToWork(index); return; } animateFeedToWork(requested); return; }
    animateFeedToWork(index);
  };

  const toggleReaction = async (type: "like" | "save") => {
    if (reactionPending) return; const current = type === "like" ? liked : saved; const nextActive = !current; const oldLike = likeCount; const oldSave = saveCount;
    setReactionPending(type); if (type === "like") { setLiked(nextActive); setLikeCount((n) => Math.max(0, n + (nextActive ? 1 : -1))); } else { setSaved(nextActive); setSaveCount((n) => Math.max(0, n + (nextActive ? 1 : -1))); }
    try { applyReaction(await updateReaction(type, item.cid, nextActive, eventContext())); }
    catch { setLiked(liked); setSaved(saved); setLikeCount(oldLike); setSaveCount(oldSave); onToast(type === "like" ? "いいねを保存できませんでした" : "保存状態を更新できませんでした"); }
    finally { setReactionPending(null); }
  };

  const share = async () => {
    const url = new URL("/", window.location.origin); url.searchParams.set("cid", item.cid); const shareUrl = url.toString();
    try { if (navigator.share) await navigator.share({ title: item.title || "FANZA同人作品", url: shareUrl }); else if (navigator.clipboard) await navigator.clipboard.writeText(shareUrl); else return; trackEvent({ eventType: "share", cid: item.cid, ...eventContext(), placement: "reader" }, true); }
    catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
  };

  const affiliateUrl = details.affiliateUrl || item.affiliateUrl;
  const ctaPrice = formatPrice(details.price || item.price, details.priceValue ?? item.priceValue ?? null);
  const ctaStyle = { order: 0 } satisfies CSSProperties;

  return (
    <article className="feed-item" data-work-index={index} data-cid={item.cid} data-reader-page={currentPage} data-reader-cta={currentPage === ctaPage ? "1" : "0"} aria-label={`${index + 1}件目 ${item.title || item.cid}`}>
      <div ref={trackRef} className="preview-track manga-reader-track" tabIndex={0} onScroll={scheduleCurrentPageCommit} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={(event) => finishGesture(event)} onPointerCancel={(event) => finishGesture(event, true)} onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); goToPage(currentPage + (event.key === "ArrowLeft" ? 1 : -1)); } }}>
        <div className="preview-page preview-cta-page" style={ctaStyle} aria-label="サンプル読了">
          <div className="reader-cta">
            <p className="reader-cta-kicker">サンプルはここまで</p>
            {detailsLoading ? <p className="reader-cta-remaining is-loading">本編ページ数を確認中…</p> : details.remainingPages !== null ? <p className="reader-cta-remaining">本編残りは <strong>{details.remainingPages.toLocaleString("ja-JP")}</strong> ページ</p> : <p className="reader-cta-remaining">本編の続きがあります</p>}
            {ctaPrice ? <p className="reader-cta-price">{ctaPrice}</p> : null}
            {details.available && validExternalUrl(affiliateUrl) ? <a className="reader-cta-link" href={affiliateUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={() => trackEvent({ eventType: "affiliate_click", cid: item.cid, ...eventContext(), placement: "reader_end" }, true)}>FANZAで続きを読む <ExternalIcon /></a> : <p className="reader-cta-unavailable">現在販売状況を確認中です</p>}
          </div>
        </div>
        {item.images.map((url, pageIndex) => {
          const shouldLoad = pageIndex === 0 || (isActive && pageIndex >= Math.max(0, currentPage - 1) && pageIndex <= currentPage + 2);
          const pageStyle = { order: ctaPage - pageIndex } satisfies CSSProperties;
          return <div className={`preview-page${loadStates[pageIndex] === "error" ? " is-error" : ""}`} style={pageStyle} key={`${item.cid}-${pageIndex}`}>
            {shouldLoad ? <><img key={`${item.cid}-${pageIndex}-${retryNonce[pageIndex] ?? 0}`} src={url} alt={`${item.title} サンプル ${pageIndex + 1}`} loading={index === 0 && pageIndex === 0 ? "eager" : "lazy"} fetchPriority={isActive && pageIndex <= currentPage + 1 ? "high" : "auto"} decoding="async" draggable={false} onLoad={() => markLoad(pageIndex, "loaded")} onError={() => markLoad(pageIndex, "error")} />{loadStates[pageIndex] === "error" ? <button className="reader-image-retry" type="button" onClick={() => { markLoad(pageIndex, "pending"); setRetryNonce((old) => ({ ...old, [pageIndex]: (old[pageIndex] ?? 0) + 1 })); }}>画像を再読込</button> : null}</> : <div className="preview-page-placeholder" aria-hidden="true" />}
          </div>;
        })}
      </div>
      <div className="page-counter" aria-live="polite"><span>{Math.min(currentPage + 1, Math.max(1, item.images.length))}</span>&nbsp;/&nbsp;{item.images.length}</div>
      {item.images.length > 1 && index === 0 ? <div className="swipe-hint">右へスワイプして読む →</div> : null}
      <div className="item-gradient" />
      <div className="item-info">
        <h2 className="item-title">{item.title || item.cid}</h2>
        <div className="item-stats"><span className="stat-chip">★<strong>{item.rating.toFixed(1)}</strong> <span>({item.reviews}件)</span></span>{ctaPrice ? <span className="stat-chip"><strong>{ctaPrice}</strong></span> : null}</div>
        {details.available && validExternalUrl(affiliateUrl) ? <a className="open-link" href={affiliateUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={() => trackEvent({ eventType: "affiliate_click", cid: item.cid, ...eventContext(), placement: "overlay" }, true)}>FANZAで続きを読む <ExternalIcon /></a> : null}
      </div>
      <div className="action-rail">
        <button className={`action-btn${liked ? " is-active" : ""}`} type="button" disabled={reactionPending !== null} onClick={() => void toggleReaction("like")}><span className="action-icon"><HeartIcon /></span><span className="action-label">いいね</span><span className="action-count">{formatCount(likeCount)}</span></button>
        <button className={`action-btn${saved ? " is-active" : ""}`} type="button" disabled={reactionPending !== null} onClick={() => void toggleReaction("save")}><span className="action-icon"><BookmarkIcon /></span><span className="action-label">保存</span><span className="action-count">{formatCount(saveCount)}</span></button>
        <button className="action-btn" type="button" onClick={share}><span className="action-icon"><ShareIcon /></span><span className="action-label">共有</span></button>
      </div>
      <span className="sr-only" aria-live="polite">画像読み込み {loaded}/{item.images.length}</span>
    </article>
  );
}
