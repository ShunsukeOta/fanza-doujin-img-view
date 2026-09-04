import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { BookmarkIcon, DebugIcon, ExternalIcon, HeartIcon, ShareIcon } from "@/components/icons";
import type { FeedItem, ReactionSummary, WorkDebugSnapshot } from "@/lib/types";
import { trackEvent } from "@/src/analytics";
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
};

type Props = {
  item: FeedItem;
  index: number;
  isActive: boolean;
  onToast: (message: string) => void;
  onDebug: (snapshot: WorkDebugSnapshot) => void;
  onVerticalSwipe?: (direction: -1 | 1) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatPrice(price: string) {
  const digits = price.replace(/[^0-9]/g, "");
  if (!digits) return price;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? `¥${value.toLocaleString("ja-JP")}` : price;
}

function formatCount(value: number) {
  return Math.max(0, value).toLocaleString("ja-JP");
}

function initialDetails(item: FeedItem): WorkDetails {
  const fullPages = typeof item.fullPageCount === "number" ? item.fullPageCount : null;
  return {
    remainingPages: fullPages === null ? null : Math.max(0, fullPages - item.sampleCount),
    price: item.price,
  };
}

export function WorkCard({ item, index, isActive, onToast, onDebug, onVerticalSwipe }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pageSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const feedAnimationFrame = useRef<number | null>(null);
  const pageAnimationFrame = useRef<number | null>(null);
  const detailsRequested = useRef(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [loadStates, setLoadStates] = useState<LoadState[]>(() => item.images.map(() => "pending"));
  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const [likeCount, setLikeCount] = useState(item.likeCount);
  const [saveCount, setSaveCount] = useState(item.saveCount);
  const [reactionPending, setReactionPending] = useState<"like" | "save" | null>(null);
  const [details, setDetails] = useState<WorkDetails>(() => initialDetails(item));
  const [detailsLoading, setDetailsLoading] = useState(false);

  const ctaPage = item.images.length;

  const feedElement = useCallback(() => trackRef.current?.closest<HTMLElement>(".feed") ?? null, []);

  const cancelFeedAnimation = useCallback(() => {
    if (feedAnimationFrame.current !== null) {
      cancelAnimationFrame(feedAnimationFrame.current);
      feedAnimationFrame.current = null;
    }
  }, []);

  const cancelPageAnimation = useCallback(() => {
    if (pageAnimationFrame.current !== null) {
      cancelAnimationFrame(pageAnimationFrame.current);
      pageAnimationFrame.current = null;
    }
  }, []);

  const animateFeedToWork = useCallback((targetIndex: number) => {
    const feed = feedElement();
    if (!feed) return;
    const target = feed.querySelector<HTMLElement>(`.feed-item[data-work-index="${targetIndex}"]`);
    if (!target) return;

    cancelFeedAnimation();
    const start = feed.scrollTop;
    const end = target.offsetTop;
    const distance = end - start;
    if (Math.abs(distance) < 1) {
      feed.scrollTop = end;
      return;
    }

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      feed.scrollTop = end;
      return;
    }

    const duration = 210;
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      feed.scrollTop = start + distance * eased;
      if (progress < 1) {
        feedAnimationFrame.current = requestAnimationFrame(step);
      } else {
        feed.scrollTop = end;
        feedAnimationFrame.current = null;
      }
    };
    feedAnimationFrame.current = requestAnimationFrame(step);
  }, [cancelFeedAnimation, feedElement]);

  const maxScrollLeft = useCallback(() => {
    const track = trackRef.current;
    return track ? Math.max(0, track.scrollWidth - track.clientWidth) : 0;
  }, []);

  // DOMは左から「CTA, 最終サンプル, ... , 2P, 1P」。1Pは常に右端。
  const scrollLeftForPage = useCallback((page: number) => {
    const track = trackRef.current;
    if (!track || track.clientWidth <= 0) return 0;
    return clamp(maxScrollLeft() - clamp(page, 0, ctaPage) * track.clientWidth, 0, maxScrollLeft());
  }, [ctaPage, maxScrollLeft]);

  const pageIndexFromScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth <= 0) return 0;
    return clamp(Math.round((maxScrollLeft() - track.scrollLeft) / track.clientWidth), 0, ctaPage);
  }, [ctaPage, maxScrollLeft]);

  const commitCurrentPage = useCallback(() => {
    setCurrentPage(pageIndexFromScroll());
  }, [pageIndexFromScroll]);

  const loadDetails = useCallback(async () => {
    if (detailsRequested.current) return;
    detailsRequested.current = true;
    setDetailsLoading(true);
    try {
      const response = await fetch(`/api/work-details?cid=${encodeURIComponent(item.cid)}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => null) as {
        ok?: boolean;
        remainingPages?: number | null;
        price?: string;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "作品情報を取得できませんでした");
      setDetails({
        remainingPages: typeof data.remainingPages === "number" ? data.remainingPages : null,
        price: typeof data.price === "string" && data.price ? data.price : item.price,
      });
    } catch {
      detailsRequested.current = false;
      // 未確認のページ数は推測せず、価格はDB情報をそのまま使う。
    } finally {
      setDetailsLoading(false);
    }
  }, [item.cid, item.price]);

  const goToPage = useCallback((target: number, behavior: ScrollBehavior = "smooth") => {
    const track = trackRef.current;
    if (!track || item.images.length === 0) return;
    const next = clamp(target, 0, ctaPage);
    if (next >= Math.max(0, ctaPage - 1)) void loadDetails();

    cancelPageAnimation();
    if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current);

    const end = scrollLeftForPage(next);
    if (behavior === "auto" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      track.scrollLeft = end;
      setCurrentPage(next);
      return;
    }

    const start = track.scrollLeft;
    const distance = end - start;
    if (Math.abs(distance) < 1) {
      track.scrollLeft = end;
      setCurrentPage(next);
      return;
    }

    // 縦作品送りと同じイージングで、指を離した位置から次ページへ自然に吸着させる。
    const duration = 220;
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      track.scrollLeft = start + distance * eased;
      if (progress < 1) {
        pageAnimationFrame.current = requestAnimationFrame(step);
      } else {
        track.scrollLeft = end;
        pageAnimationFrame.current = null;
        setCurrentPage(next);
      }
    };
    pageAnimationFrame.current = requestAnimationFrame(step);
  }, [cancelPageAnimation, ctaPage, item.images.length, loadDetails, scrollLeftForPage]);

  useEffect(() => {
    setLoadStates(item.images.map(() => "pending"));
    setCurrentPage(0);
    setDetails(initialDetails(item));
    detailsRequested.current = false;
    const frame = requestAnimationFrame(() => goToPage(0, "auto"));
    return () => cancelAnimationFrame(frame);
  }, [goToPage, item.cid, item.images]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      cancelPageAnimation();
      track.scrollLeft = scrollLeftForPage(currentPage);
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [cancelPageAnimation, currentPage, scrollLeftForPage]);

  useEffect(() => {
    if (isActive && currentPage >= Math.max(0, item.images.length - 2)) void loadDetails();
  }, [currentPage, isActive, item.images.length, loadDetails]);

  useEffect(() => {
    setLiked(item.viewerLiked);
    setSaved(item.viewerSaved);
    setLikeCount(item.likeCount);
    setSaveCount(item.saveCount);
  }, [item.cid, item.likeCount, item.saveCount, item.viewerLiked, item.viewerSaved]);

  const applyReaction = useCallback((reaction: ReactionSummary) => {
    setLiked(reaction.viewerLiked);
    setSaved(reaction.viewerSaved);
    setLikeCount(reaction.likeCount);
    setSaveCount(reaction.saveCount);
  }, []);

  useEffect(() => {
    if (!isActive || reactionPending) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const reactions = await loadReactions([item.cid]);
        if (!cancelled && reactions[item.cid]) applyReaction(reactions[item.cid]);
      } catch {
        // 件数同期の失敗でフィード本体は止めない。
      }
    };
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [applyReaction, isActive, item.cid, reactionPending]);

  useEffect(() => () => {
    if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current);
    cancelFeedAnimation();
    cancelPageAnimation();
  }, [cancelFeedAnimation, cancelPageAnimation]);

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

  const scheduleCurrentPageCommit = () => {
    if (gestureRef.current?.axis === "x" || pageAnimationFrame.current !== null) return;
    if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current);
    pageSettleTimer.current = setTimeout(commitCurrentPage, 70);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || !isActive || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current);
    cancelFeedAnimation();
    cancelPageAnimation();
    const feed = feedElement();
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: trackRef.current?.scrollLeft ?? 0,
      startFeedScrollTop: feed?.scrollTop ?? 0,
      startPage: pageIndexFromScroll(),
      startedAt: performance.now(),
      axis: null,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const track = trackRef.current;
    if (!gesture || !track || gesture.pointerId !== event.pointerId) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (gesture.axis === null && Math.max(Math.abs(dx), Math.abs(dy)) >= 7) {
      if (Math.abs(dx) > Math.abs(dy) * 1.08) {
        gesture.axis = "x";
      } else if (Math.abs(dy) > Math.abs(dx) * 1.08) {
        gesture.axis = "y";
      } else {
        return;
      }
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
    }

    if (gesture.axis === "x") {
      event.preventDefault();
      const maxTravel = track.clientWidth * 0.92;
      const drag = clamp(dx, -maxTravel, maxTravel);
      track.scrollLeft = clamp(gesture.startScrollLeft - drag, 0, maxScrollLeft());
      return;
    }

    if (gesture.axis === "y") {
      event.preventDefault();
      const feed = feedElement();
      if (!feed) return;
      const maxTravel = feed.clientHeight * 0.92;
      const drag = clamp(dy, -maxTravel, maxTravel);
      feed.scrollTop = clamp(
        gesture.startFeedScrollTop - drag,
        0,
        Math.max(0, feed.scrollHeight - feed.clientHeight),
      );
    }
  };

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const elapsed = Math.max(1, performance.now() - gesture.startedAt);

    if (gesture.axis === "x") {
      const velocity = Math.abs(dx) / elapsed;
      const width = trackRef.current?.clientWidth ?? 0;
      const decisive = !cancelled && (Math.abs(dx) >= Math.max(28, width * 0.1) || velocity >= 0.4);
      const target = decisive
        ? gesture.startPage + (dx > 0 ? 1 : -1)
        : gesture.startPage;
      goToPage(target);
      return;
    }

    if (gesture.axis === "y") {
      const feed = feedElement();
      const height = feed?.clientHeight ?? window.innerHeight;
      const velocity = Math.abs(dy) / elapsed;
      const decisive = !cancelled && (Math.abs(dy) >= Math.max(48, height * 0.1) || velocity >= 0.42);
      const direction: -1 | 1 = dy < 0 ? 1 : -1;
      const requestedIndex = decisive ? index + direction : index;
      const target = feed?.querySelector<HTMLElement>(`.feed-item[data-work-index="${requestedIndex}"]`);

      if (decisive && !target) {
        onVerticalSwipe?.(direction);
        animateFeedToWork(index);
        return;
      }
      animateFeedToWork(decisive ? requestedIndex : index);
      return;
    }

    animateFeedToWork(index);
  };

  const toggleReaction = async (type: "like" | "save") => {
    if (reactionPending) return;
    const current = type === "like" ? liked : saved;
    const nextActive = !current;
    const previousLikeCount = likeCount;
    const previousSaveCount = saveCount;

    setReactionPending(type);
    if (type === "like") {
      setLiked(nextActive);
      setLikeCount((count) => Math.max(0, count + (nextActive ? 1 : -1)));
    } else {
      setSaved(nextActive);
      setSaveCount((count) => Math.max(0, count + (nextActive ? 1 : -1)));
    }

    try {
      const reaction = await updateReaction(type, item.cid, nextActive);
      applyReaction(reaction);
    } catch {
      setLiked(liked);
      setSaved(saved);
      setLikeCount(previousLikeCount);
      setSaveCount(previousSaveCount);
      onToast(type === "like" ? "いいねを保存できませんでした" : "保存状態を更新できませんでした");
    } finally {
      setReactionPending(null);
    }
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
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      // 共有UIのキャンセル・失敗はフィード上にトーストを出さない。
    }
  };

  const visiblePage = Math.min(currentPage + 1, Math.max(1, item.images.length));
  const ctaPrice = details.price || item.price;
  const ctaStyle = { order: 0 } satisfies CSSProperties;

  return (
    <article className="feed-item" data-work-index={index} data-cid={item.cid} aria-label={`${index + 1}件目 ${item.title || item.cid}`}>
      <div
        ref={trackRef}
        className="preview-track manga-reader-track"
        tabIndex={0}
        onScroll={scheduleCurrentPageCommit}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishGesture(event)}
        onPointerCancel={(event) => finishGesture(event, true)}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            goToPage(currentPage + (event.key === "ArrowLeft" ? 1 : -1));
          }
        }}
      >
        <div className="preview-page preview-cta-page" style={ctaStyle} aria-label="サンプル読了">
          <div className="reader-cta">
            <p className="reader-cta-kicker">サンプルはここまで</p>
            {detailsLoading ? (
              <p className="reader-cta-remaining is-loading">本編ページ数を確認中…</p>
            ) : details.remainingPages !== null ? (
              <p className="reader-cta-remaining">本編残りは <strong>{details.remainingPages.toLocaleString("ja-JP")}</strong> ページ</p>
            ) : (
              <p className="reader-cta-remaining">本編の続きがあります</p>
            )}
            {ctaPrice ? <p className="reader-cta-price">{formatPrice(ctaPrice)}</p> : null}
          </div>
        </div>

        {item.images.map((url, pageIndex) => {
          const shouldLoad = pageIndex === 0 || (isActive && pageIndex >= Math.max(0, currentPage - 1) && pageIndex <= currentPage + 2);
          const pageStyle = { order: ctaPage - pageIndex } satisfies CSSProperties;
          return (
            <div className={`preview-page${loadStates[pageIndex] === "error" ? " is-error" : ""}`} style={pageStyle} key={`${item.cid}-${pageIndex}`}>
              {shouldLoad ? (
                <img
                  src={url}
                  alt={`${item.title} サンプル ${pageIndex + 1}`}
                  loading={index === 0 && pageIndex === 0 ? "eager" : "lazy"}
                  fetchPriority={isActive && pageIndex <= currentPage + 1 ? "high" : "auto"}
                  decoding="async"
                  draggable={false}
                  onLoad={() => markLoad(pageIndex, "loaded")}
                  onError={() => markLoad(pageIndex, "error")}
                />
              ) : <div className="preview-page-placeholder" aria-hidden="true" />}
            </div>
          );
        })}
      </div>

      <div className="page-counter" aria-live="polite"><span>{visiblePage}</span>&nbsp;/&nbsp;{item.images.length}</div>
      {item.images.length > 1 && index === 0 ? <div className="swipe-hint">右へスワイプして読む →</div> : null}

      <div className="item-gradient" />
      <div className="item-info">
        <h2 className="item-title">{item.title || item.cid}</h2>
        <div className="item-stats">
          <span className="stat-chip">★<strong>{item.rating.toFixed(1)}</strong> <span>({item.reviews}件)</span></span>
          {item.price ? <span className="stat-chip"><strong>{formatPrice(item.price)}</strong></span> : null}
        </div>
        {/^(https?):\/\//i.test(item.affiliateUrl) ? (
          <a className="open-link" href={item.affiliateUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={() => trackEvent({ eventType: "affiliate_click", cid: item.cid })}>
            FANZAで続きを読む <ExternalIcon />
          </a>
        ) : null}
      </div>

      <div className="action-rail">
        <button className={`action-btn${liked ? " is-active" : ""}`} type="button" disabled={reactionPending !== null} onClick={() => void toggleReaction("like")}>
          <span className="action-icon"><HeartIcon /></span><span className="action-label">いいね</span><span className="action-count">{formatCount(likeCount)}</span>
        </button>
        <button className={`action-btn${saved ? " is-active" : ""}`} type="button" disabled={reactionPending !== null} onClick={() => void toggleReaction("save")}>
          <span className="action-icon"><BookmarkIcon /></span><span className="action-label">保存</span><span className="action-count">{formatCount(saveCount)}</span>
        </button>
        <button className="action-btn" type="button" onClick={share}><span className="action-icon"><ShareIcon /></span><span className="action-label">共有</span></button>
        <button
          className="action-btn debug-action"
          type="button"
          onClick={() => onDebug({ item, index, currentPage: Math.min(currentPage, Math.max(0, item.images.length - 1)), loadedImages: loaded, failedImages: failed, pendingImages: pending, liked, saved, likeCount, saveCount })}
        >
          <span className="action-icon"><DebugIcon /></span><span className="action-label">デバッグ</span>
        </button>
      </div>
    </article>
  );
}
