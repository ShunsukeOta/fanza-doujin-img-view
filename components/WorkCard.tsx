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
import { preloadAndDecodeImages } from "@/src/imagePreload";
import { formatPrice } from "@/src/price";
import {
  logicalPageFromDirectionalScroll,
  progressedSamplePages,
  sampleReadRatio,
  scrollLeftForLogicalPage,
  tapNavigationDelta,
} from "@/src/readerMath";
import type { ReaderSettings } from "@/src/readerSettings";
import { loadReactions, updateReaction } from "@/src/reactions";

type LoadState = "pending" | "loaded" | "error";
type GestureAxis = "x" | "y" | "pan" | null;
type Point = { x: number; y: number };
type ZoomState = { scale: number; x: number; y: number };
type GestureState = {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startFeedScrollTop: number;
  startPage: number;
  startPanX: number;
  startPanY: number;
  startedAt: number;
  axis: GestureAxis;
  maxDistance: number;
};
type PinchState = {
  startDistance: number;
  startScale: number;
  startMidX: number;
  startMidY: number;
  startPanX: number;
  startPanY: number;
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
  firstLoadTracked: boolean;
  completed: boolean;
  ctaViewed: boolean;
  viewedPages: Set<number>;
};
type Props = {
  item: FeedItem;
  index: number;
  isActive: boolean;
  initialPage?: number;
  readerSettings: ReaderSettings;
  onToggleControls: () => void;
  onPageChange?: (cid: string, page: number, isCta: boolean) => void;
  onToast: (message: string) => void;
  onVerticalSwipe?: (direction: -1 | 1) => void;
};

const DEFAULT_ZOOM: ZoomState = { scale: 1, x: 0, y: 0 };
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 280;
const SINGLE_TAP_DELAY_MS = 300;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function formatCount(value: number) {
  return Math.max(0, value).toLocaleString("ja-JP");
}

function validExternalUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a,button,input,select,textarea,label"));
}

function initialDetails(item: FeedItem): WorkDetails {
  const full = typeof item.fullPageCount === "number" ? item.fullPageCount : null;
  return {
    remainingPages: full === null ? null : Math.max(0, full - item.sampleCount),
    price: item.price,
    priceValue: item.priceValue ?? null,
    affiliateUrl: item.affiliateUrl,
    available: item.available !== false,
  };
}

export function WorkCard({
  item,
  index,
  isActive,
  initialPage = 0,
  readerSettings,
  onToggleControls,
  onPageChange,
  onToast,
  onVerticalSwipe,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number; page: number } | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<PinchState | null>(null);
  const feedFrame = useRef<number | null>(null);
  const pageFrame = useRef<number | null>(null);
  const detailsRequested = useRef(false);
  const viewRef = useRef<ViewState | null>(null);
  const currentPageRef = useRef(Math.max(0, initialPage));
  const loadStatesRef = useRef<LoadState[]>(item.images.map(() => "pending"));
  const stageRefs = useRef(new Map<number, HTMLDivElement>());
  const imageRefs = useRef(new Map<number, HTMLImageElement>());
  const zoomRef = useRef<ZoomState>(DEFAULT_ZOOM);

  const [currentPage, setCurrentPage] = useState(currentPageRef.current);
  const [loadStates, setLoadStates] = useState<LoadState[]>(loadStatesRef.current);
  const [retryNonce, setRetryNonce] = useState<Record<number, number>>({});
  const [zoom, setZoom] = useState<ZoomState>(DEFAULT_ZOOM);
  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const [likeCount, setLikeCount] = useState(item.likeCount);
  const [saveCount, setSaveCount] = useState(item.saveCount);
  const [reactionPending, setReactionPending] = useState<"like" | "save" | null>(null);
  const [details, setDetails] = useState<WorkDetails>(() => initialDetails(item));
  const [detailsLoading, setDetailsLoading] = useState(false);

  const ctaPage = item.images.length;
  const isRtl = readerSettings.readingDirection === "rtl";
  const feedElement = useCallback(() => trackRef.current?.closest<HTMLElement>(".feed") ?? null, []);
  const eventContext = useCallback(
    () => ({ viewId: viewRef.current?.id, feedId: item.feedId ?? null, rank: item.rank ?? index + 1 }),
    [index, item.feedId, item.rank],
  );

  const applyZoom = useCallback((next: ZoomState) => {
    zoomRef.current = next;
    setZoom(next);
  }, []);

  const resetZoom = useCallback(() => {
    pinchRef.current = null;
    pointersRef.current.clear();
    applyZoom(DEFAULT_ZOOM);
  }, [applyZoom]);

  const clampPan = useCallback((page: number, scale: number, x: number, y: number): ZoomState => {
    const stage = stageRefs.current.get(page);
    const image = imageRefs.current.get(page);
    if (!stage || !image) return { scale, x: 0, y: 0 };

    const baseWidth = image.offsetWidth;
    const baseHeight = image.offsetHeight;
    const maxX = Math.max(0, (baseWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (baseHeight * scale - stage.clientHeight) / 2);
    return {
      scale,
      x: clamp(x, -maxX, maxX),
      y: clamp(y, -maxY, maxY),
    };
  }, []);

  const hasBaseVerticalOverflow = useCallback((page: number) => {
    if (readerSettings.fitMode !== "width") return false;
    const stage = stageRefs.current.get(page);
    const image = imageRefs.current.get(page);
    return Boolean(stage && image && image.offsetHeight > stage.clientHeight + 2);
  }, [readerSettings.fitMode]);

  const setLogicalPage = useCallback((page: number) => {
    const next = clamp(page, 0, ctaPage);
    if (next !== currentPageRef.current) resetZoom();
    currentPageRef.current = next;
    setCurrentPage(next);
    onPageChange?.(item.cid, next, next === ctaPage);
  }, [ctaPage, item.cid, onPageChange, resetZoom]);

  const finishView = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    viewRef.current = null;
    const maxSample = clamp(view.maxSamplePage, 0, Math.max(0, item.images.length - 1));
    trackEvent({
      eventType: "view_end",
      cid: item.cid,
      viewId: view.id,
      feedId: item.feedId ?? null,
      rank: item.rank ?? index + 1,
      dwellMs: Math.max(0, Math.round(performance.now() - view.startedAt)),
      maxPage: maxSample,
      readRatio: sampleReadRatio(item.images.length, maxSample),
      metadata: {
        sampleLoaded: view.sampleLoaded,
        progressedPages: progressedSamplePages(view.startSamplePage, maxSample),
        sampleCount: item.images.length,
        completed: view.completed,
      },
    });
  }, [index, item.cid, item.feedId, item.images.length, item.rank]);

  useEffect(() => {
    if (!isActive) {
      finishView();
      return;
    }
    if (viewRef.current) return;
    const samplePage = clamp(
      Math.min(currentPageRef.current, Math.max(0, item.images.length - 1)),
      0,
      Math.max(0, item.images.length - 1),
    );
    const view: ViewState = {
      id: createViewId(),
      startedAt: performance.now(),
      startSamplePage: samplePage,
      maxSamplePage: samplePage,
      sampleLoaded: loadStatesRef.current.some((state) => state === "loaded"),
      firstLoadTracked: false,
      completed: false,
      ctaViewed: false,
      viewedPages: new Set(),
    };
    viewRef.current = view;
    trackEvent({
      eventType: "work_impression",
      cid: item.cid,
      viewId: view.id,
      feedId: item.feedId ?? null,
      rank: item.rank ?? index + 1,
      metadata: { recommendationSource: item.recommendationSource ?? "" },
    });
    return finishView;
  }, [finishView, index, isActive, item.cid, item.feedId, item.images.length, item.rank, item.recommendationSource]);

  const cancelFeedAnimation = useCallback(() => {
    if (feedFrame.current !== null) {
      cancelAnimationFrame(feedFrame.current);
      feedFrame.current = null;
    }
  }, []);

  const cancelPageAnimation = useCallback(() => {
    if (pageFrame.current !== null) {
      cancelAnimationFrame(pageFrame.current);
      pageFrame.current = null;
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
    const delta = end - start;
    if (Math.abs(delta) < 1 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      feed.scrollTop = end;
      return;
    }
    const started = performance.now();
    const step = (now: number) => {
      const progress = clamp((now - started) / 210, 0, 1);
      feed.scrollTop = start + delta * (1 - Math.pow(1 - progress, 4));
      if (progress < 1) feedFrame.current = requestAnimationFrame(step);
      else {
        feed.scrollTop = end;
        feedFrame.current = null;
      }
    };
    feedFrame.current = requestAnimationFrame(step);
  }, [cancelFeedAnimation, feedElement]);

  const maxScrollLeft = useCallback(() => {
    const track = trackRef.current;
    return track ? Math.max(0, track.scrollWidth - track.clientWidth) : 0;
  }, []);

  const scrollLeftForPage = useCallback((page: number) => {
    const track = trackRef.current;
    if (!track || track.clientWidth <= 0) return 0;
    return scrollLeftForLogicalPage(
      maxScrollLeft(),
      track.clientWidth,
      page,
      ctaPage,
      readerSettings.readingDirection,
    );
  }, [ctaPage, maxScrollLeft, readerSettings.readingDirection]);

  const pageIndexFromScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth <= 0) return 0;
    return logicalPageFromDirectionalScroll(
      maxScrollLeft(),
      track.scrollLeft,
      track.clientWidth,
      ctaPage,
      readerSettings.readingDirection,
    );
  }, [ctaPage, maxScrollLeft, readerSettings.readingDirection]);

  const commitCurrentPage = useCallback(() => setLogicalPage(pageIndexFromScroll()), [pageIndexFromScroll, setLogicalPage]);

  const loadDetails = useCallback(async () => {
    if (!isActive || detailsRequested.current) return;
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
        priceValue?: number | null;
        affiliateUrl?: string;
        available?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "作品情報を取得できませんでした");
      setDetails({
        remainingPages: typeof data.remainingPages === "number" ? data.remainingPages : null,
        price: typeof data.price === "string" && data.price ? data.price : item.price,
        priceValue: typeof data.priceValue === "number" ? data.priceValue : item.priceValue ?? null,
        affiliateUrl: typeof data.affiliateUrl === "string" && data.affiliateUrl ? data.affiliateUrl : item.affiliateUrl,
        available: data.available !== false,
      });
    } catch {
      detailsRequested.current = false;
    } finally {
      setDetailsLoading(false);
    }
  }, [isActive, item.affiliateUrl, item.cid, item.price, item.priceValue]);

  const goToPage = useCallback((target: number, behavior: ScrollBehavior = "smooth") => {
    const track = trackRef.current;
    if (!track || item.images.length === 0) return;
    const next = clamp(target, 0, ctaPage);
    cancelPageAnimation();
    if (pageTimer.current) clearTimeout(pageTimer.current);
    const end = scrollLeftForPage(next);
    const commit = () => {
      track.scrollLeft = end;
      setLogicalPage(next);
    };
    if (
      behavior === "auto"
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      || Math.abs(end - track.scrollLeft) < 1
    ) {
      commit();
      return;
    }
    const start = track.scrollLeft;
    const delta = end - start;
    const started = performance.now();
    const step = (now: number) => {
      const progress = clamp((now - started) / 220, 0, 1);
      track.scrollLeft = start + delta * (1 - Math.pow(1 - progress, 4));
      if (progress < 1) pageFrame.current = requestAnimationFrame(step);
      else {
        pageFrame.current = null;
        commit();
      }
    };
    pageFrame.current = requestAnimationFrame(step);
  }, [cancelPageAnimation, ctaPage, item.images.length, scrollLeftForPage, setLogicalPage]);

  useEffect(() => {
    const states = item.images.map(() => "pending" as LoadState);
    loadStatesRef.current = states;
    setLoadStates(states);
    setRetryNonce({});
    setDetails(initialDetails(item));
    detailsRequested.current = false;
    resetZoom();
    const page = clamp(initialPage, 0, item.images.length);
    currentPageRef.current = page;
    setCurrentPage(page);
    const frame = requestAnimationFrame(() => goToPage(page, "auto"));
    return () => cancelAnimationFrame(frame);
  }, [goToPage, initialPage, item.cid, item.images, resetZoom]);

  useEffect(() => {
    resetZoom();
    const frame = requestAnimationFrame(() => {
      const track = trackRef.current;
      if (track) track.scrollLeft = scrollLeftForPage(currentPageRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [readerSettings.fitMode, readerSettings.readingDirection, resetZoom, scrollLeftForPage]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      cancelPageAnimation();
      track.scrollLeft = scrollLeftForPage(currentPageRef.current);
      const current = zoomRef.current;
      if (currentPageRef.current < ctaPage) {
        applyZoom(clampPan(currentPageRef.current, current.scale, current.x, current.y));
      }
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [applyZoom, cancelPageAnimation, clampPan, ctaPage, scrollLeftForPage]);

  useEffect(() => {
    if (!isActive || item.images.length === 0) return;
    const page = Math.min(currentPage, item.images.length - 1);
    const high = [item.images[page], item.images[page + 1]].filter((url): url is string => Boolean(url));
    const warm = [item.images[page - 1], item.images[page + 2]].filter((url): url is string => Boolean(url));
    preloadAndDecodeImages(high, "high");
    preloadAndDecodeImages(warm, "auto");
  }, [currentPage, isActive, item.images]);

  useEffect(() => {
    if (!isActive) return;
    if (currentPage >= Math.max(0, ctaPage - 1)) void loadDetails();
    const view = viewRef.current;
    if (!view) return;

    if (currentPage === ctaPage) {
      if (!view.completed) {
        view.completed = true;
        trackEvent({
          eventType: "sample_complete",
          cid: item.cid,
          viewId: view.id,
          feedId: item.feedId ?? null,
          rank: item.rank ?? index + 1,
          readRatio: 1,
        });
      }
      if (!view.ctaViewed) {
        view.ctaViewed = true;
        trackEvent({
          eventType: "cta_view",
          cid: item.cid,
          viewId: view.id,
          feedId: item.feedId ?? null,
          rank: item.rank ?? index + 1,
          placement: "reader_end",
          metadata: { focusMode: document.body.classList.contains("reader-focus") },
        });
      }
      return;
    }

    if (loadStates[currentPage] !== "loaded" || view.viewedPages.has(currentPage)) return;
    const page = currentPage;
    const timer = window.setTimeout(() => {
      const active = viewRef.current;
      if (!active || currentPageRef.current !== page || active.viewedPages.has(page)) return;
      active.viewedPages.add(page);
      active.sampleLoaded = true;
      active.maxSamplePage = Math.max(active.maxSamplePage, page);
      trackEvent({
        eventType: "sample_page_view",
        cid: item.cid,
        viewId: active.id,
        feedId: item.feedId ?? null,
        rank: item.rank ?? index + 1,
        pageIndex: page,
        maxPage: active.maxSamplePage,
        readRatio: sampleReadRatio(item.images.length, active.maxSamplePage),
      });
    }, 450);
    return () => clearTimeout(timer);
  }, [ctaPage, currentPage, index, isActive, item.cid, item.feedId, item.images.length, item.rank, loadDetails, loadStates]);

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
    void loadReactions([item.cid])
      .then((rows) => {
        if (!cancelled && rows[item.cid]) applyReaction(rows[item.cid]);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [applyReaction, isActive, item.cid, reactionPending]);

  useEffect(() => () => {
    if (pageTimer.current) clearTimeout(pageTimer.current);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    cancelFeedAnimation();
    cancelPageAnimation();
    finishView();
  }, [cancelFeedAnimation, cancelPageAnimation, finishView]);

  const markLoad = useCallback((pageIndex: number, state: LoadState) => {
    setLoadStates((previous) => {
      if (previous[pageIndex] === state) return previous;
      const next = [...previous];
      next[pageIndex] = state;
      loadStatesRef.current = next;
      return next;
    });
    if (state === "loaded" && isActive && viewRef.current) {
      const view = viewRef.current;
      view.sampleLoaded = true;
      if (pageIndex === 0 && !view.firstLoadTracked) {
        view.firstLoadTracked = true;
        trackEvent({
          eventType: "first_sample_loaded",
          cid: item.cid,
          viewId: view.id,
          feedId: item.feedId ?? null,
          rank: item.rank ?? index + 1,
        });
      }
    }
  }, [index, isActive, item.cid, item.feedId, item.rank]);

  const scheduleCommit = () => {
    if (gestureRef.current?.axis === "x" || pageFrame.current !== null) return;
    if (pageTimer.current) clearTimeout(pageTimer.current);
    pageTimer.current = setTimeout(commitCurrentPage, 70);
  };

  const zoomAtPoint = useCallback((clientX: number, clientY: number) => {
    const page = currentPageRef.current;
    if (page >= ctaPage) return;
    const current = zoomRef.current;
    if (current.scale > 1.02) {
      applyZoom(DEFAULT_ZOOM);
      return;
    }
    const stage = stageRefs.current.get(page);
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const focalX = clientX - (rect.left + rect.width / 2);
    const focalY = clientY - (rect.top + rect.height / 2);
    const scale = DOUBLE_TAP_ZOOM;
    applyZoom(clampPan(page, scale, (1 - scale) * focalX, (1 - scale) * focalY));
  }, [applyZoom, clampPan, ctaPage]);

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const page = currentPageRef.current;
    const now = performance.now();
    const previous = lastTap.current;
    if (
      previous
      && previous.page === page
      && now - previous.time <= DOUBLE_TAP_MS
      && Math.hypot(previous.x - clientX, previous.y - clientY) <= 36
    ) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      lastTap.current = null;
      zoomAtPoint(clientX, clientY);
      return;
    }

    lastTap.current = { time: now, x: clientX, y: clientY, page };
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      lastTap.current = null;
      const rect = track.getBoundingClientRect();
      const xRatio = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0.5;
      const delta = tapNavigationDelta(xRatio, readerSettings.readingDirection);
      if (delta === 0) {
        onToggleControls();
        return;
      }
      if (!readerSettings.tapNavigation || zoomRef.current.scale > 1.02) return;
      goToPage(currentPageRef.current + delta);
    }, SINGLE_TAP_DELAY_MS);
  }, [goToPage, onToggleControls, readerSettings.readingDirection, readerSettings.tapNavigation, zoomAtPoint]);

  const beginPinch = useCallback(() => {
    const points = [...pointersRef.current.values()];
    if (points.length < 2 || currentPageRef.current >= ctaPage) return;
    const first = points[0];
    const second = points[1];
    const mid = midpoint(first, second);
    const current = zoomRef.current;
    pinchRef.current = {
      startDistance: Math.max(1, distance(first, second)),
      startScale: current.scale,
      startMidX: mid.x,
      startMidY: mid.y,
      startPanX: current.x,
      startPanY: current.y,
    };
    gestureRef.current = null;
    cancelFeedAnimation();
    cancelPageAnimation();
  }, [cancelFeedAnimation, cancelPageAnimation, ctaPage]);

  const updatePinch = useCallback(() => {
    const pinch = pinchRef.current;
    const points = [...pointersRef.current.values()];
    const page = currentPageRef.current;
    const stage = stageRefs.current.get(page);
    if (!pinch || points.length < 2 || !stage) return;
    const first = points[0];
    const second = points[1];
    const mid = midpoint(first, second);
    const nextScale = clamp(
      pinch.startScale * (distance(first, second) / pinch.startDistance),
      1,
      MAX_ZOOM,
    );
    const rect = stage.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const startFocalX = pinch.startMidX - centerX;
    const startFocalY = pinch.startMidY - centerY;
    const ratio = nextScale / Math.max(0.001, pinch.startScale);
    const nextX = pinch.startPanX
      + (mid.x - pinch.startMidX)
      + (1 - ratio) * (startFocalX - pinch.startPanX);
    const nextY = pinch.startPanY
      + (mid.y - pinch.startMidY)
      + (1 - ratio) * (startFocalY - pinch.startPanY);
    const clamped = clampPan(page, nextScale, nextX, nextY);
    applyZoom(nextScale <= 1.01 ? DEFAULT_ZOOM : clamped);
  }, [applyZoom, clampPan]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isActive || isInteractiveTarget(event.target) || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (pageTimer.current) clearTimeout(pageTimer.current);
    cancelFeedAnimation();
    cancelPageAnimation();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }

    if (pointersRef.current.size >= 2) {
      beginPinch();
      return;
    }

    const feed = feedElement();
    const currentZoom = zoomRef.current;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: trackRef.current?.scrollLeft ?? 0,
      startFeedScrollTop: feed?.scrollTop ?? 0,
      startPage: pageIndexFromScroll(),
      startPanX: currentZoom.x,
      startPanY: currentZoom.y,
      startedAt: performance.now(),
      axis: null,
      maxDistance: 0,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2 || pinchRef.current) {
      event.preventDefault();
      if (!pinchRef.current) beginPinch();
      updatePinch();
      return;
    }

    const gesture = gestureRef.current;
    const track = trackRef.current;
    if (!gesture || !track || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    gesture.maxDistance = Math.max(gesture.maxDistance, Math.hypot(dx, dy));

    if (zoomRef.current.scale > 1.02) {
      gesture.axis = "pan";
    } else if (gesture.axis === null && Math.max(Math.abs(dx), Math.abs(dy)) >= 7) {
      if (Math.abs(dx) > Math.abs(dy) * 1.08) gesture.axis = "x";
      else if (Math.abs(dy) > Math.abs(dx) * 1.08) {
        gesture.axis = hasBaseVerticalOverflow(currentPageRef.current) ? "pan" : "y";
      } else return;
    }

    if (gesture.axis === "pan") {
      event.preventDefault();
      applyZoom(clampPan(
        currentPageRef.current,
        zoomRef.current.scale,
        gesture.startPanX + dx,
        gesture.startPanY + dy,
      ));
      return;
    }

    if (gesture.axis === "x") {
      event.preventDefault();
      track.scrollLeft = clamp(
        gesture.startScrollLeft - clamp(dx, -track.clientWidth * 0.92, track.clientWidth * 0.92),
        0,
        maxScrollLeft(),
      );
      return;
    }

    if (gesture.axis === "y") {
      event.preventDefault();
      const feed = feedElement();
      if (feed) {
        feed.scrollTop = clamp(
          gesture.startFeedScrollTop - clamp(dy, -feed.clientHeight * 0.92, feed.clientHeight * 0.92),
          0,
          Math.max(0, feed.scrollHeight - feed.clientHeight),
        );
      }
    }
  };

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const wasPinching = pinchRef.current !== null || pointersRef.current.size >= 2;
    pointersRef.current.delete(event.pointerId);
    if (wasPinching) {
      if (pointersRef.current.size < 2) pinchRef.current = null;
      gestureRef.current = null;
      if (zoomRef.current.scale <= 1.01) {
        applyZoom(DEFAULT_ZOOM);
      } else if (pointersRef.current.size === 1) {
        const [remaining] = [...pointersRef.current.entries()];
        if (remaining) {
          const [pointerId, point] = remaining;
          const feed = feedElement();
          const currentZoom = zoomRef.current;
          gestureRef.current = {
            pointerId,
            startX: point.x,
            startY: point.y,
            startScrollLeft: trackRef.current?.scrollLeft ?? 0,
            startFeedScrollTop: feed?.scrollTop ?? 0,
            startPage: currentPageRef.current,
            startPanX: currentZoom.x,
            startPanY: currentZoom.y,
            startedAt: performance.now(),
            axis: "pan",
            maxDistance: 0,
          };
        }
      }
      return;
    }

    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const elapsed = Math.max(1, performance.now() - gesture.startedAt);

    if (gesture.axis === "pan") return;

    if (gesture.axis === "x") {
      const width = trackRef.current?.clientWidth ?? 0;
      const decisive = !cancelled && (
        Math.abs(dx) >= Math.max(28, width * 0.1)
        || Math.abs(dx) / elapsed >= 0.4
      );
      const forward = isRtl ? dx > 0 : dx < 0;
      goToPage(decisive ? gesture.startPage + (forward ? 1 : -1) : gesture.startPage);
      return;
    }

    if (gesture.axis === "y") {
      const feed = feedElement();
      const height = feed?.clientHeight ?? innerHeight;
      const decisive = !cancelled && (
        Math.abs(dy) >= Math.max(48, height * 0.1)
        || Math.abs(dy) / elapsed >= 0.42
      );
      const direction: -1 | 1 = dy < 0 ? 1 : -1;
      const requested = decisive ? index + direction : index;
      const target = feed?.querySelector<HTMLElement>(`.feed-item[data-work-index="${requested}"]`);
      if (decisive && !target) {
        onVerticalSwipe?.(direction);
        animateFeedToWork(index);
        return;
      }
      animateFeedToWork(requested);
      return;
    }

    if (!cancelled && gesture.maxDistance < 8 && elapsed < 350 && !isInteractiveTarget(event.target)) {
      handleTap(event.clientX, event.clientY);
      return;
    }
    animateFeedToWork(index);
  };

  const toggleReaction = async (type: "like" | "save") => {
    if (reactionPending) return;
    const current = type === "like" ? liked : saved;
    const next = !current;
    const oldLike = likeCount;
    const oldSave = saveCount;
    setReactionPending(type);
    if (type === "like") {
      setLiked(next);
      setLikeCount((count) => Math.max(0, count + (next ? 1 : -1)));
    } else {
      setSaved(next);
      setSaveCount((count) => Math.max(0, count + (next ? 1 : -1)));
    }
    try {
      applyReaction(await updateReaction(type, item.cid, next, eventContext()));
    } catch {
      setLiked(liked);
      setSaved(saved);
      setLikeCount(oldLike);
      setSaveCount(oldSave);
      onToast(type === "like" ? "いいねを保存できませんでした" : "保存状態を更新できませんでした");
    } finally {
      setReactionPending(null);
    }
  };

  const share = async () => {
    const url = new URL("/", location.origin);
    url.searchParams.set("cid", item.cid);
    try {
      if (navigator.share) await navigator.share({ title: item.title || "FANZA同人作品", url: url.toString() });
      else if (navigator.clipboard) await navigator.clipboard.writeText(url.toString());
      else return;
      trackEvent({ eventType: "share", cid: item.cid, ...eventContext(), placement: "reader" }, true);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  };

  const loaded = loadStates.filter((state) => state === "loaded").length;
  const affiliateUrl = details.affiliateUrl || item.affiliateUrl;
  const ctaPrice = formatPrice(details.price || item.price, details.priceValue ?? item.priceValue ?? null);
  const totalPages = details.remainingPages !== null
    ? item.sampleCount + details.remainingPages
    : typeof item.fullPageCount === "number"
      ? item.fullPageCount
      : null;
  const ctaStyle = {
    order: isRtl ? 0 : ctaPage,
  } satisfies CSSProperties;
  const isTransformingImage = zoom.scale > 1.02 || Math.abs(zoom.x) > 0.5 || Math.abs(zoom.y) > 0.5;

  return (
    <article
      className={`feed-item${isTransformingImage ? " is-reader-zoomed" : ""}`}
      data-work-index={index}
      data-cid={item.cid}
      data-reader-page={currentPage}
      data-reader-cta={currentPage === ctaPage ? "1" : "0"}
      data-reader-fit={readerSettings.fitMode}
      aria-label={`${index + 1}件目 ${item.title || item.cid}`}
    >
      <div
        ref={trackRef}
        className="preview-track manga-reader-track"
        tabIndex={0}
        onScroll={scheduleCommit}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishGesture(event)}
        onPointerCancel={(event) => finishGesture(event, true)}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const forwardKey = isRtl ? "ArrowLeft" : "ArrowRight";
          goToPage(currentPage + (event.key === forwardKey ? 1 : -1));
        }}
      >
        <div className="preview-page preview-cta-page" style={ctaStyle} aria-label="サンプル読了">
          <div className="reader-cta">
            <p className="reader-cta-kicker">サンプルはここまで</p>
            {detailsLoading ? (
              <p className="reader-cta-meta is-loading">本編情報を確認中…</p>
            ) : totalPages !== null && details.remainingPages !== null ? (
              <p className="reader-cta-meta">
                全 <strong>{totalPages.toLocaleString("ja-JP")}</strong> ページ
                <span aria-hidden="true"> / </span>
                残り <strong>{details.remainingPages.toLocaleString("ja-JP")}</strong> ページ
              </p>
            ) : (
              <p className="reader-cta-meta">本編の続きがあります</p>
            )}
            {ctaPrice ? <p className="reader-cta-price">{ctaPrice}</p> : null}
            {details.available && validExternalUrl(affiliateUrl) ? (
              <a
                className="reader-cta-link"
                href={affiliateUrl}
                target="_blank"
                rel="noopener noreferrer sponsored"
                onClick={() => trackEvent({
                  eventType: "affiliate_click",
                  cid: item.cid,
                  ...eventContext(),
                  placement: "reader_end",
                }, true)}
              >
                FANZAで続きを読む <ExternalIcon />
              </a>
            ) : (
              <p className="reader-cta-unavailable">現在販売状況を確認中です</p>
            )}
            <button
              className={`reader-cta-save${saved ? " is-active" : ""}`}
              type="button"
              disabled={reactionPending !== null}
              onClick={() => void toggleReaction("save")}
            >
              <BookmarkIcon /> {saved ? "保存済み" : "あとで読む"}
            </button>
          </div>
        </div>

        {item.images.map((url, pageIndex) => {
          const shouldLoad = pageIndex === 0 || (
            isActive
            && pageIndex >= Math.max(0, currentPage - 1)
            && pageIndex <= currentPage + 2
          );
          const pageStyle = {
            order: isRtl ? ctaPage - pageIndex : pageIndex,
          } satisfies CSSProperties;
          const imageStyle = pageIndex === currentPage
            ? { transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` }
            : undefined;

          return (
            <div
              className={`preview-page${loadStates[pageIndex] === "error" ? " is-error" : ""}`}
              style={pageStyle}
              key={`${item.cid}-${pageIndex}`}
              data-sample-page={pageIndex}
            >
              {shouldLoad ? (
                <div
                  className={`reader-image-stage reader-fit-${readerSettings.fitMode}`}
                  ref={(node) => {
                    if (node) stageRefs.current.set(pageIndex, node);
                    else stageRefs.current.delete(pageIndex);
                  }}
                >
                  <img
                    key={`${item.cid}-${pageIndex}-${retryNonce[pageIndex] ?? 0}`}
                    ref={(node) => {
                      if (node) imageRefs.current.set(pageIndex, node);
                      else imageRefs.current.delete(pageIndex);
                    }}
                    src={url}
                    alt={`${item.title} サンプル ${pageIndex + 1}`}
                    loading={isActive && pageIndex <= currentPage + 1 ? "eager" : "lazy"}
                    fetchPriority={isActive && (pageIndex === currentPage || pageIndex === currentPage + 1) ? "high" : "auto"}
                    decoding="async"
                    draggable={false}
                    style={imageStyle}
                    onLoad={() => markLoad(pageIndex, "loaded")}
                    onError={() => markLoad(pageIndex, "error")}
                  />
                  {loadStates[pageIndex] === "error" ? (
                    <button
                      className="reader-image-retry"
                      type="button"
                      onClick={() => {
                        markLoad(pageIndex, "pending");
                        setRetryNonce((old) => ({ ...old, [pageIndex]: (old[pageIndex] ?? 0) + 1 }));
                      }}
                    >
                      画像を再読込
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="preview-page-placeholder" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>

      <div className="page-counter" aria-live="polite">
        <span>{Math.min(currentPage + 1, Math.max(1, item.images.length))}</span>&nbsp;/&nbsp;{item.images.length}
      </div>
      {item.images.length > 1 && index === 0 ? (
        <div className="swipe-hint">スワイプまたは画面端タップで読む</div>
      ) : null}
      <div className="item-gradient" />

      <div className="item-info">
        <h2 className="item-title">{item.title || item.cid}</h2>
        <div className="item-stats">
          <span className="stat-chip">★<strong>{item.rating.toFixed(1)}</strong> <span>({item.reviews}件)</span></span>
          {ctaPrice ? <span className="stat-chip"><strong>{ctaPrice}</strong></span> : null}
        </div>
        {details.available && validExternalUrl(affiliateUrl) ? (
          <a
            className="open-link"
            href={affiliateUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={() => trackEvent({
              eventType: "affiliate_click",
              cid: item.cid,
              ...eventContext(),
              placement: "overlay",
            }, true)}
          >
            FANZAで続きを読む <ExternalIcon />
          </a>
        ) : null}
      </div>

      <div className="action-rail">
        <button
          className={`action-btn${liked ? " is-active" : ""}`}
          type="button"
          disabled={reactionPending !== null}
          onClick={() => void toggleReaction("like")}
        >
          <span className="action-icon"><HeartIcon /></span>
          <span className="action-label">いいね</span>
          <span className="action-count">{formatCount(likeCount)}</span>
        </button>
        <button
          className={`action-btn${saved ? " is-active" : ""}`}
          type="button"
          disabled={reactionPending !== null}
          onClick={() => void toggleReaction("save")}
        >
          <span className="action-icon"><BookmarkIcon /></span>
          <span className="action-label">保存</span>
          <span className="action-count">{formatCount(saveCount)}</span>
        </button>
        <button className="action-btn" type="button" onClick={share}>
          <span className="action-icon"><ShareIcon /></span>
          <span className="action-label">共有</span>
        </button>
      </div>
      <span className="sr-only" aria-live="polite">画像読み込み {loaded}/{item.images.length}</span>
    </article>
  );
}
