import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { BookmarkIcon, ExternalIcon, HeartIcon, ShareIcon } from "@/components/icons";
import type { FeedItem } from "@/lib/types";
import { createViewId, trackEvent } from "@/src/analytics";
import { formatPrice } from "@/src/price";
import { updateReaction } from "@/src/reactions";

type Props = {
  item: FeedItem;
  index: number;
  isActive: boolean;
  onToast: (message: string) => void;
  onVerticalSwipe: (direction: -1 | 1) => void;
};

type PointerStart = { id: number; x: number; y: number; startedAt: number };
type PlayerMode = "direct" | "embed" | "none";

function formatCount(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}千`;
  return value.toLocaleString("ja-JP");
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const value = Math.floor(seconds);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, "0")}`;
}

function validExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function playerMode(url: string): PlayerMode {
  if (!validExternalUrl(url)) return "none";
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /\.(?:mp4|webm|ogv|ogg)$/.test(pathname) ? "direct" : "embed";
  } catch {
    return "none";
  }
}

export function VideoWorkCard({ item, index, isActive, onToast, onVerticalSwipe }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pointerStart = useRef<PointerStart | null>(null);
  const pointerMoved = useRef(false);
  const viewIdRef = useRef(createViewId());
  const activeStartedAt = useRef<number | null>(null);
  const loadedRef = useRef(false);
  const loadedViewIdRef = useRef("");
  const endedTracked = useRef(false);
  const lastProgress = useRef(0);

  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [ended, setEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [liked, setLiked] = useState(Boolean(item.viewerLiked));
  const [saved, setSaved] = useState(Boolean(item.viewerSaved));
  const [likeCount, setLikeCount] = useState(item.likeCount ?? 0);
  const [saveCount, setSaveCount] = useState(item.saveCount ?? 0);
  const [reactionBusy, setReactionBusy] = useState<"like" | "save" | "">("");

  const sampleMovieUrl = item.sampleMovieUrl ?? "";
  const mode = playerMode(sampleMovieUrl);
  const poster = item.images[0] ?? "";
  const progress = mode === "direct" && duration > 0
    ? Math.max(0, Math.min(1, currentTime / duration))
    : 0;
  lastProgress.current = progress;

  const eventContext = useCallback(() => ({
    cid: item.cid,
    viewId: viewIdRef.current,
    feedId: item.feedId ?? null,
    rank: item.rank ?? index + 1,
  }), [index, item.cid, item.feedId, item.rank]);

  const endView = useCallback(() => {
    if (activeStartedAt.current === null) return;
    const dwellMs = Math.max(0, Math.round(performance.now() - activeStartedAt.current));
    activeStartedAt.current = null;
    const ratio = mode === "direct" ? lastProgress.current : 0;
    trackEvent({
      eventType: "view_end",
      ...eventContext(),
      dwellMs,
      readRatio: ratio,
      metadata: {
        mediaType: "video",
        floor: "amateur",
        sampleLoaded: loadedRef.current,
        progressedPages: mode === "direct" && ratio > 0 ? Math.max(1, Math.floor(ratio * 10)) : 0,
        playedSeconds: mode === "direct" ? Math.round((videoRef.current?.currentTime ?? 0) * 10) / 10 : 0,
        embedPlayer: mode === "embed",
      },
    }, true);
  }, [eventContext, mode]);

  const markLoaded = useCallback(() => {
    loadedRef.current = true;
    setLoaded(true);
    if (!isActive || loadedViewIdRef.current === viewIdRef.current) return;
    loadedViewIdRef.current = viewIdRef.current;
    trackEvent({
      eventType: "first_sample_loaded",
      ...eventContext(),
      metadata: { mediaType: "video", floor: "amateur", embedPlayer: mode === "embed" },
    });
  }, [eventContext, isActive, mode]);

  useEffect(() => {
    setLiked(Boolean(item.viewerLiked));
    setSaved(Boolean(item.viewerSaved));
    setLikeCount(item.likeCount ?? 0);
    setSaveCount(item.saveCount ?? 0);
  }, [item.cid, item.likeCount, item.saveCount, item.viewerLiked, item.viewerSaved]);

  useEffect(() => {
    const video = videoRef.current;
    if (!isActive) {
      video?.pause();
      setPlaying(false);
      endView();
      return;
    }

    viewIdRef.current = createViewId();
    activeStartedAt.current = performance.now();
    endedTracked.current = false;
    loadedViewIdRef.current = "";
    trackEvent({
      eventType: "work_impression",
      ...eventContext(),
      metadata: { mediaType: "video", floor: "amateur", embedPlayer: mode === "embed" },
    });
    if (loadedRef.current) markLoaded();

    if (mode === "direct" && video) {
      if (video.ended) {
        video.currentTime = 0;
        setCurrentTime(0);
        setEnded(false);
      }
      video.muted = muted;
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }

    return () => {
      video?.pause();
      endView();
    };
  }, [endView, eventContext, isActive, markLoaded, mode, muted]);

  useEffect(() => () => endView(), [endView]);

  const onLoadedData = () => {
    const video = videoRef.current;
    setDuration(Number.isFinite(video?.duration) ? video?.duration ?? 0 : 0);
    markLoaded();
  };

  const onEnded = () => {
    setPlaying(false);
    setEnded(true);
    setCurrentTime(duration);
    if (endedTracked.current) return;
    endedTracked.current = true;
    trackEvent({
      eventType: "sample_complete",
      ...eventContext(),
      readRatio: 1,
      metadata: { mediaType: "video", floor: "amateur" },
    });
    trackEvent({
      eventType: "cta_view",
      ...eventContext(),
      placement: "video_end",
      metadata: { mediaType: "video", floor: "amateur" },
    });
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || mode !== "direct") return;
    if (video.paused) {
      if (video.ended) {
        video.currentTime = 0;
        setCurrentTime(0);
        setEnded(false);
        endedTracked.current = false;
      }
      void video.play().then(() => setPlaying(true)).catch(() => onToast("動画を再生できませんでした"));
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const toggleMuted = () => {
    const video = videoRef.current;
    if (!video || mode !== "direct") return;
    const next = !muted;
    video.muted = next;
    setMuted(next);
  };

  const toggleReaction = async (type: "like" | "save") => {
    if (reactionBusy) return;
    const next = type === "like" ? !liked : !saved;
    setReactionBusy(type);
    try {
      const reaction = await updateReaction(type, item.cid, next, {
        viewId: viewIdRef.current,
        feedId: item.feedId ?? null,
        rank: item.rank ?? index + 1,
      });
      setLiked(reaction.viewerLiked);
      setSaved(reaction.viewerSaved);
      setLikeCount(reaction.likeCount);
      setSaveCount(reaction.saveCount);
    } catch {
      onToast(type === "like" ? "いいねを保存できませんでした" : "保存状態を更新できませんでした");
    } finally {
      setReactionBusy("");
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/amateur?cid=${encodeURIComponent(item.cid)}`;
    try {
      if (navigator.share) await navigator.share({ title: item.title, url });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        onToast("共有リンクをコピーしました");
      } else return;
      trackEvent({
        eventType: "share",
        ...eventContext(),
        placement: "video_feed",
        metadata: { floor: "amateur" },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      onToast("共有できませんでした");
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointerStart.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedAt: performance.now(),
    };
    pointerMoved.current = false;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    if (Math.abs(event.clientY - start.y) > 10 || Math.abs(event.clientX - start.x) > 10) {
      pointerMoved.current = true;
    }
  };

  const finishPointer = (event: ReactPointerEvent<HTMLElement>, allowTapPlayback: boolean) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const elapsed = Math.max(1, performance.now() - start.startedAt);
    const decisive = Math.abs(dy) >= 48 || Math.abs(dy) / elapsed >= 0.42;
    if (decisive && Math.abs(dy) > Math.abs(dx) * 1.08) {
      onVerticalSwipe(dy < 0 ? 1 : -1);
      return;
    }
    if (allowTapPlayback && !pointerMoved.current && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      togglePlayback();
    }
  };

  const canBuy = item.available !== false && validExternalUrl(item.affiliateUrl);

  return (
    <article
      className={`feed-item video-feed-item video-feed-item--${mode}`}
      data-work-index={index}
      data-cid={item.cid}
      data-floor="amateur"
      aria-label={`${index + 1}件目 ${item.title}`}
    >
      <section
        className="video-stage"
        onPointerDown={mode === "direct" ? handlePointerDown : undefined}
        onPointerMove={mode === "direct" ? handlePointerMove : undefined}
        onPointerUp={mode === "direct" ? (event) => finishPointer(event, true) : undefined}
        onPointerCancel={() => { pointerStart.current = null; }}
      >
        {mode === "direct" ? (
          <video
            ref={videoRef}
            className="video-player"
            src={sampleMovieUrl}
            poster={poster || undefined}
            playsInline
            muted={muted}
            preload={isActive ? "auto" : "metadata"}
            onLoadedData={onLoadedData}
            onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={onEnded}
          />
        ) : mode === "embed" ? (
          <iframe
            className="video-embed-player"
            src={sampleMovieUrl}
            title={`${item.title} サンプル動画`}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            loading={isActive ? "eager" : "lazy"}
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={markLoaded}
          />
        ) : poster ? (
          <img className="video-poster-fallback" src={poster} alt="" />
        ) : (
          <div className="video-unavailable">動画サンプルを表示できません</div>
        )}

        {!loaded && mode !== "none" ? <div className="video-loading"><span className="spinner" /></div> : null}

        {mode === "direct" ? (
          <>
            <button
              className={`video-play-toggle${playing ? " is-playing" : ""}`}
              type="button"
              onClick={(event) => { event.stopPropagation(); togglePlayback(); }}
              aria-label={playing ? "一時停止" : "再生"}
            >
              <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
            </button>
            <button
              className="video-audio-toggle"
              type="button"
              onClick={(event) => { event.stopPropagation(); toggleMuted(); }}
              aria-label={muted ? "音声をオン" : "ミュート"}
            >
              <span aria-hidden="true">{muted ? "MUTE" : "SOUND"}</span>
            </button>
            <div className="video-timeline" aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></div>
            <div className="video-time" aria-hidden="true">{formatTime(currentTime)} / {formatTime(duration)}</div>
          </>
        ) : mode === "embed" ? (
          <>
            <span className="video-embed-badge">FANZA SAMPLE</span>
            <div
              className="video-swipe-zone video-swipe-zone--left"
              aria-hidden="true"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => finishPointer(event, false)}
              onPointerCancel={() => { pointerStart.current = null; }}
            />
            <div
              className="video-swipe-zone video-swipe-zone--right"
              aria-hidden="true"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => finishPointer(event, false)}
              onPointerCancel={() => { pointerStart.current = null; }}
            />
          </>
        ) : null}
      </section>

      <div className="item-gradient" />
      <div className="item-info">
        <h2 className="item-title">{item.title}</h2>
        {item.maker ? <p className="video-maker">{item.maker}</p> : null}
        <div className="item-stats">
          <span className="stat-chip">★ <strong>{item.rating.toFixed(1)}</strong> ({item.reviews}件)</span>
          {item.price ? <span className="stat-chip">{formatPrice(item.price, item.priceValue ?? null)}</span> : null}
        </div>
        {canBuy ? (
          <a
            className="open-link"
            href={item.affiliateUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={() => trackEvent({
              eventType: "affiliate_click",
              ...eventContext(),
              placement: "video_feed",
            }, true)}
          >
            FANZAで見る <ExternalIcon />
          </a>
        ) : null}
      </div>

      <aside className="action-rail" aria-label="作品アクション">
        <button className={`action-btn${liked ? " is-active" : ""}`} type="button" disabled={Boolean(reactionBusy)} onClick={() => void toggleReaction("like")}>
          <span className="action-icon"><HeartIcon /></span><span className="action-label">いいね</span><span className="action-count">{formatCount(likeCount)}</span>
        </button>
        <button className={`action-btn${saved ? " is-active" : ""}`} type="button" disabled={Boolean(reactionBusy)} onClick={() => void toggleReaction("save")}>
          <span className="action-icon"><BookmarkIcon /></span><span className="action-label">保存</span><span className="action-count">{formatCount(saveCount)}</span>
        </button>
        <button className="action-btn" type="button" onClick={() => void share()}>
          <span className="action-icon"><ShareIcon /></span><span className="action-label">共有</span>
        </button>
      </aside>

      {mode === "direct" && ended ? (
        <div className="video-end-card">
          <strong>サンプルはここまで</strong>
          <button type="button" onClick={togglePlayback}>もう一度見る</button>
          {canBuy ? <a href={item.affiliateUrl} target="_blank" rel="noopener noreferrer sponsored">FANZAで本編を見る</a> : null}
        </div>
      ) : null}
    </article>
  );
}
