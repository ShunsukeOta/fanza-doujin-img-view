export type AnalyticsEventPayload = {
  eventType: "impression" | "view_end" | "sample_page" | "like_toggle" | "save_toggle" | "share" | "affiliate_click";
  cid: string;
  pageIndex?: number;
  maxPage?: number;
  readRatio?: number;
  dwellMs?: number;
  metadata?: {
    active?: boolean;
  };
};

type ActiveView = {
  cid: string;
  startedAt: number;
  maxPage: number;
  totalPages: number;
};

const observed = new WeakSet<Element>();
const pageByTrack = new WeakMap<Element, number>();
let activeView: ActiveView | null = null;
let observer: IntersectionObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let started = false;

export function trackEvent(payload: AnalyticsEventPayload) {
  const body = JSON.stringify(payload);
  if (document.visibilityState === "hidden" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => undefined);
}

function finishActiveView() {
  if (!activeView) return;
  const dwellMs = Math.max(0, Math.round(performance.now() - activeView.startedAt));
  const totalPages = Math.max(1, activeView.totalPages);
  trackEvent({
    eventType: "view_end",
    cid: activeView.cid,
    dwellMs,
    maxPage: activeView.maxPage,
    readRatio: Math.min(1, (activeView.maxPage + 1) / totalPages),
  });
  activeView = null;
}

function activate(item: HTMLElement) {
  const cid = item.dataset.cid ?? "";
  if (!cid || activeView?.cid === cid) return;
  finishActiveView();
  const totalPages = item.querySelectorAll(".preview-page").length || 1;
  activeView = { cid, startedAt: performance.now(), maxPage: 0, totalPages };
  trackEvent({ eventType: "impression", cid });
}

function resumeVisibleView() {
  if (document.visibilityState === "hidden") return;
  const feed = document.querySelector<HTMLElement>(".feed");
  if (!feed) return;

  const feedRect = feed.getBoundingClientRect();
  let bestItem: HTMLElement | null = null;
  let bestRatio = 0;
  feed.querySelectorAll<HTMLElement>(".feed-item").forEach((item) => {
    const rect = item.getBoundingClientRect();
    if (rect.height <= 0) return;
    const visibleTop = Math.max(feedRect.top, rect.top);
    const visibleBottom = Math.min(feedRect.bottom, rect.bottom);
    const ratio = Math.max(0, visibleBottom - visibleTop) / rect.height;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestItem = item;
    }
  });

  if (bestItem && bestRatio >= 0.6) activate(bestItem);
}

function observeItems() {
  const feed = document.querySelector<HTMLElement>(".feed");
  if (!feed) return;
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.6)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target instanceof HTMLElement) activate(visible.target);
      },
      { root: feed, threshold: [0.6, 0.75, 0.9] },
    );
  }
  feed.querySelectorAll<HTMLElement>(".feed-item").forEach((item) => {
    if (observed.has(item)) return;
    observed.add(item);
    observer?.observe(item);
  });
}

function handleScroll(event: Event) {
  const track = event.target;
  if (!(track instanceof HTMLElement) || !track.classList.contains("preview-track") || track.clientWidth <= 0) return;
  const item = track.closest<HTMLElement>(".feed-item");
  const cid = item?.dataset.cid ?? "";
  if (!cid) return;
  const pages = item?.querySelectorAll(".preview-page").length ?? 1;
  const page = Math.max(0, Math.min(pages - 1, Math.round(track.scrollLeft / track.clientWidth)));
  if (pageByTrack.get(track) === page) return;
  pageByTrack.set(track, page);
  if (activeView?.cid === cid) activeView.maxPage = Math.max(activeView.maxPage, page);
  trackEvent({ eventType: "sample_page", cid, pageIndex: page, maxPage: page, readRatio: Math.min(1, (page + 1) / Math.max(1, pages)) });
}

export function startAnalytics() {
  if (typeof window === "undefined" || started) return;
  started = true;

  const start = () => {
    observeItems();
    mutationObserver = new MutationObserver(observeItems);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        finishActiveView();
      } else {
        window.requestAnimationFrame(resumeVisibleView);
      }
    });
    window.addEventListener("pagehide", finishActiveView);
    window.addEventListener("pageshow", () => window.requestAnimationFrame(resumeVisibleView));
    window.requestAnimationFrame(resumeVisibleView);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
