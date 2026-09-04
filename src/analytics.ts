type EventPayload = {
  eventType: "impression" | "view_end" | "sample_page" | "like_toggle" | "save_toggle" | "share" | "affiliate_click";
  cid: string;
  pageIndex?: number;
  maxPage?: number;
  readRatio?: number;
  dwellMs?: number;
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

function send(payload: EventPayload) {
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
  send({
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
  send({ eventType: "impression", cid });
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
  send({ eventType: "sample_page", cid, pageIndex: page, maxPage: page, readRatio: Math.min(1, (page + 1) / Math.max(1, pages)) });
}

function handleClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const item = target?.closest<HTMLElement>(".feed-item");
  const cid = item?.dataset.cid ?? "";
  if (!cid) return;

  if (target?.closest(".open-link")) {
    send({ eventType: "affiliate_click", cid });
    return;
  }
  const button = target?.closest<HTMLButtonElement>(".action-btn");
  if (!button) return;
  const label = button.querySelector(".action-label")?.textContent?.trim() ?? "";
  if (label === "いいね") send({ eventType: "like_toggle", cid });
  else if (label === "保存") send({ eventType: "save_toggle", cid });
  else if (label === "共有") send({ eventType: "share", cid });
}

export function startAnalytics() {
  if (typeof window === "undefined") return;
  const start = () => {
    observeItems();
    mutationObserver = new MutationObserver(observeItems);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") finishActiveView();
    });
    window.addEventListener("pagehide", finishActiveView);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
