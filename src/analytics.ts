export type AnalyticsEventType =
  | "session_start"
  | "work_impression"
  | "first_sample_loaded"
  | "sample_page_view"
  | "sample_complete"
  | "cta_view"
  | "view_end"
  | "like_toggle"
  | "save_toggle"
  | "share"
  | "affiliate_click";

export type AnalyticsEventPayload = {
  eventType: AnalyticsEventType;
  cid?: string;
  viewId?: string;
  feedId?: string | null;
  rank?: number;
  pageIndex?: number;
  maxPage?: number;
  readRatio?: number;
  dwellMs?: number;
  placement?: string;
  landingPath?: string;
  sourceDomain?: string;
  campaign?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

type QueuedEvent = AnalyticsEventPayload & { eventId: string; eventVersion: 3 };
const queue: QueuedEvent[] = [];
let timer: number | null = null;
let started = false;
let flushing = false;

export function createEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export function createViewId(): string { return createEventId(); }

export function trackEvent(payload: AnalyticsEventPayload, flushSoon = false): void {
  queue.push({ ...payload, eventId: createEventId(), eventVersion: 3 });
  if (queue.length >= 10 || flushSoon) {
    void flushAnalytics();
    return;
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    void flushAnalytics();
  }, 5_000);
}

export async function flushAnalytics(useBeacon = false): Promise<void> {
  if (flushing || queue.length === 0) return;
  const events = queue.splice(0, 25);
  const body = JSON.stringify({ events });
  if (useBeacon && navigator.sendBeacon) {
    const accepted = navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
    if (!accepted) queue.unshift(...events);
    return;
  }
  flushing = true;
  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    });
    if (!response.ok && response.status >= 500) queue.unshift(...events);
  } catch {
    queue.unshift(...events);
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush();
  }
}

function attribution(): Pick<AnalyticsEventPayload, "landingPath" | "sourceDomain" | "campaign"> {
  let sourceDomain = "";
  try { sourceDomain = document.referrer ? new URL(document.referrer).hostname : ""; } catch { sourceDomain = ""; }
  const params = new URLSearchParams(window.location.search);
  return {
    landingPath: `${window.location.pathname}${window.location.search}`.slice(0, 512),
    sourceDomain: sourceDomain.slice(0, 255),
    campaign: (params.get("utm_campaign") ?? "").slice(0, 128),
  };
}

export function startAnalytics(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  let sent = false;
  try {
    sent = sessionStorage.getItem("swipe-preview:session-start-v3") === "1";
    if (!sent) sessionStorage.setItem("swipe-preview:session-start-v3", "1");
  } catch { /* sessionStorageが使えなくても1回送る */ }
  if (!sent) trackEvent({ eventType: "session_start", ...attribution() }, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAnalytics(true);
  });
  window.addEventListener("pagehide", () => { void flushAnalytics(true); });
}
