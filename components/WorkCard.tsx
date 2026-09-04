import {
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

type Props = {
  item: FeedItem;
  index: number;
  isActive: boolean;
  onToast: (message: string) => void;
  onDebug: (snapshot: WorkDebugSnapshot) => void;
  onVerticalSwipe: (direction: -1 | 1) => void;
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

export function WorkCard({ item, index, isActive, onToast, onDebug, onVerticalSwipe }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pageSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureRef = useRef<{ pointerId: number; x: number; y: number; startedAt: number } | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [loadStates, setLoadStates] = useState<LoadState[]>(() => item.images.map(() => "pending"));
  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const [likeCount, setLikeCount] = useState(item.likeCount);
  const [saveCount, setSaveCount] = useState(item.saveCount);
  const [reactionPending, setReactionPending] = useState<"like" | "save" | null>(null);

  useEffect(() => {
    setLoadStates(item.images.map(() => "pending"));
    setCurrentPage(0);
  }, [item.cid, item.images]);

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
        // リアルタイム更新は補助機能なので、フィード表示自体は止めない。
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

  useEffect(() => {
    return () => {
      if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current);
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

  const commitCurrentPage = useCallback(() => {
    setCurrentPage(pageIndexFromScroll());
  }, [pageIndexFromScroll]);

  const scheduleCurrentPageCommit = () => {
    if (gestureRef.current) return;
    if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current);
    pageSettleTimer.current = setTimeout(commitCurrentPage, 120);
  };

  const goToPage = (target: number) => {
    const track = trackRef.current;
    if (!track || item.images.length === 0) return;
    const next = clamp(target, 0, item.images.length - 1);
    setCurrentPage(next);
    track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
    if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current);
    pageSettleTimer.current = setTimeout(commitCurrentPage, 360);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.pointerType === "mouse") return;
    if (pageSettleTimer.current) clearTimeout(pageSettleTimer.current);
    gestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedAt: performance.now(),
    };
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gestureRef.current;
    gestureRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const elapsed = performance.now() - start.startedAt;
    if (elapsed <= 1000 && Math.abs(dy) >= 46 && Math.abs(dy) > Math.abs(dx) * 1.12) {
      onVerticalSwipe(dy < 0 ? 1 : -1);
      return;
    }
    pageSettleTimer.current = setTimeout(commitCurrentPage, 140);
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
      onToast(type === "like" ? (nextActive ? "いいねしました" : "いいねを解除しました") : (nextActive ? "保存しました" : "保存を解除しました"));
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
    <article className="feed-item" data-work-index={index} data-cid={item.cid} aria-label={`${index + 1}件目 ${item.title || item.cid}`}>
      <div
        ref={trackRef}
        className="preview-track"
        tabIndex={0}
        onScroll={scheduleCurrentPageCommit}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { gestureRef.current = null; pageSettleTimer.current = setTimeout(commitCurrentPage, 140); }}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            goToPage(currentPage + (event.key === "ArrowRight" ? 1 : -1));
          }
        }}
      >
        {item.images.map((url, pageIndex) => (
          <div className={`preview-page${loadStates[pageIndex] === "error" ? " is-error" : ""}`} key={`${item.cid}-${pageIndex}`}>
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

      <div className="page-counter" aria-live="polite">
        <span>{currentPage + 1}</span>&nbsp;/&nbsp;{item.images.length}
      </div>
      {item.images.length > 1 && index === 0 ? <div className="swipe-hint">← 横にスワイプして読む →</div> : null}

      <div className="item-gradient" />
      <div className="item-info">
        <div className="item-type">{item.assetLabel}</div>
        <h2 className="item-title">{item.title || item.cid}</h2>
        <div className="item-stats">
          <span className="stat-chip">★<strong>{item.rating.toFixed(1)}</strong> <span>({item.reviews}件)</span></span>
          {item.price ? <span className="stat-chip"><strong>{formatPrice(item.price)}</strong></span> : null}
        </div>
        {item.genres.length > 0 ? <div className="genre-line">{item.genres.slice(0, 6).join(" / ")}</div> : null}
        {/^(https?):\/\//i.test(item.affiliateUrl) ? (
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
        <button className={`action-btn${liked ? " is-active" : ""}`} type="button" disabled={reactionPending !== null} onClick={() => void toggleReaction("like")}>
          <span className="action-icon"><HeartIcon /></span>
          <span className="action-label">いいね</span>
          <span className="action-count">{formatCount(likeCount)}</span>
        </button>
        <button className={`action-btn${saved ? " is-active" : ""}`} type="button" disabled={reactionPending !== null} onClick={() => void toggleReaction("save")}>
          <span className="action-icon"><BookmarkIcon /></span>
          <span className="action-label">保存</span>
          <span className="action-count">{formatCount(saveCount)}</span>
        </button>
        <button className="action-btn" type="button" onClick={share}>
          <span className="action-icon"><ShareIcon /></span>
          <span className="action-label">共有</span>
        </button>
        <button
          className="action-btn debug-action"
          type="button"
          onClick={() => onDebug({
            item,
            index,
            currentPage,
            loadedImages: loaded,
            failedImages: failed,
            pendingImages: pending,
            liked,
            saved,
            likeCount,
            saveCount,
          })}
        >
          <span className="action-icon"><DebugIcon /></span>
          <span className="action-label">デバッグ</span>
        </button>
      </div>
    </article>
  );
}
