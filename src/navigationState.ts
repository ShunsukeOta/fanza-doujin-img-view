import { scrollLeftForLogicalPage } from "@/src/readerMath";
import { loadReaderSettings } from "@/src/readerSettings";

const MAIN_RETURN_KEY = "swipe-preview:main-return-v5";
const RESUME_REQUEST_KEY = "swipe-preview:resume-request-v5";
const MAX_STATE_AGE_MS = 12 * 60 * 60 * 1000;

type SubpagePath = "/saved" | "/search" | "/mypage" | "/history";
export type NavOrigin = "main" | "saved" | "search" | "mypage" | "history";
type MainFloor = "comic" | "amateur";

type MainReturnState = {
  resumeUrl: string;
  cid: string;
  floor: MainFloor;
  pageIndex: number;
  isCta: boolean;
  subpage: SubpagePath;
  historySteps: number;
  savedAt: number;
};

function safeGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* noop */ }
}
function safeRemove(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* noop */ }
}
function isSubpagePath(value: unknown): value is SubpagePath {
  return value === "/saved" || value === "/search" || value === "/mypage" || value === "/history";
}

function readState(): MainReturnState | null {
  const raw = safeGet(MAIN_RETURN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MainReturnState>;
    const valid = typeof parsed.resumeUrl === "string"
      && typeof parsed.cid === "string"
      && (parsed.floor === "comic" || parsed.floor === "amateur")
      && typeof parsed.pageIndex === "number"
      && typeof parsed.isCta === "boolean"
      && isSubpagePath(parsed.subpage)
      && typeof parsed.historySteps === "number" && parsed.historySteps >= 1
      && typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt <= MAX_STATE_AGE_MS;
    if (!valid) {
      safeRemove(MAIN_RETURN_KEY);
      return null;
    }
    return parsed as MainReturnState;
  } catch {
    safeRemove(MAIN_RETURN_KEY);
    return null;
  }
}

function activeWorkSnapshot(): { cid: string; floor: MainFloor; pageIndex: number; isCta: boolean } | null {
  const feed = document.getElementById("feed");
  if (!(feed instanceof HTMLElement) || feed.clientHeight <= 0) return null;
  const index = Math.max(0, Math.round(feed.scrollTop / feed.clientHeight));
  const item = feed.querySelector<HTMLElement>(`.feed-item[data-work-index="${index}"]`)
    ?? feed.querySelector<HTMLElement>(".feed-item[data-cid]");
  const cid = item?.dataset.cid?.trim() ?? "";
  if (!cid) return null;
  const parsedPage = Number.parseInt(item?.dataset.readerPage ?? "0", 10);
  return {
    cid,
    floor: item?.dataset.floor === "amateur" ? "amateur" : "comic",
    pageIndex: Number.isFinite(parsedPage) ? Math.max(0, parsedPage) : 0,
    isCta: item?.dataset.readerCta === "1",
  };
}

function rememberMainBeforeSubpage(subpage: SubpagePath): void {
  const snapshot = activeWorkSnapshot();
  if (!snapshot) return;
  const resumeUrl = snapshot.floor === "amateur"
    ? `/amateur?cid=${encodeURIComponent(snapshot.cid)}`
    : `/work/${encodeURIComponent(snapshot.cid)}`;
  const state: MainReturnState = {
    resumeUrl,
    cid: snapshot.cid,
    floor: snapshot.floor,
    pageIndex: snapshot.pageIndex,
    isCta: snapshot.isCta,
    subpage,
    historySteps: 1,
    savedAt: Date.now(),
  };
  safeSet(MAIN_RETURN_KEY, JSON.stringify(state));
  safeRemove(RESUME_REQUEST_KEY);
}

function continueSubpageNavigation(subpage: SubpagePath): void {
  const state = readState();
  if (!state) return;
  safeSet(MAIN_RETURN_KEY, JSON.stringify({ ...state, subpage, historySteps: state.historySteps + 1, savedAt: Date.now() }));
}

export function navigateToSubpage(subpage: SubpagePath, origin: NavOrigin): void {
  if (origin === "main") rememberMainBeforeSubpage(subpage);
  else continueSubpageNavigation(subpage);
  window.location.assign(subpage);
}

export function resumeMainFromSubpage(): void {
  const state = readState();
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (!state || state.subpage !== path) {
    window.location.assign("/");
    return;
  }
  safeSet(RESUME_REQUEST_KEY, "1");
  if (window.history.length > state.historySteps) {
    window.history.go(-state.historySteps);
    return;
  }
  window.location.assign(state.resumeUrl);
}

export function openWorkInMain(cid: string, floor: MainFloor = "comic"): void {
  const normalized = cid.trim();
  if (!normalized) return;
  safeRemove(RESUME_REQUEST_KEY);
  window.location.assign(floor === "amateur"
    ? `/amateur?cid=${encodeURIComponent(normalized)}`
    : `/work/${encodeURIComponent(normalized)}`);
}

export function prepareMainResumeFallback(): void {
  if (safeGet(RESUME_REQUEST_KEY) !== "1") return;
  const state = readState();
  if (!state) {
    safeRemove(RESUME_REQUEST_KEY);
    return;
  }
  const current = `${location.pathname}${location.search}`;
  if (current !== state.resumeUrl) history.replaceState(history.state, "", state.resumeUrl);
}

function restoreSavedPosition(): void {
  if (safeGet(RESUME_REQUEST_KEY) !== "1") return;
  const state = readState();
  if (!state) {
    safeRemove(RESUME_REQUEST_KEY);
    return;
  }
  const started = performance.now();
  const attempt = () => {
    const feed = document.getElementById("feed");
    const item = [...document.querySelectorAll<HTMLElement>(".feed-item[data-cid]")]
      .find((work) => work.dataset.cid === state.cid);
    if (feed instanceof HTMLElement && item) {
      feed.scrollTop = item.offsetTop;
      if (state.floor === "amateur") {
        safeRemove(RESUME_REQUEST_KEY);
        return;
      }
      const track = item.querySelector<HTMLElement>(".preview-track");
      if (track && track.clientWidth > 0) {
        const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth);
        const ctaPage = item.querySelectorAll("[data-sample-page]").length;
        const direction = loadReaderSettings().readingDirection;
        track.scrollLeft = scrollLeftForLogicalPage(maxScrollLeft, track.clientWidth, state.pageIndex, ctaPage, direction);
        item.dataset.readerPage = String(state.pageIndex);
        item.dataset.readerCta = state.isCta ? "1" : "0";
        track.dispatchEvent(new Event("scroll", { bubbles: true }));
        safeRemove(RESUME_REQUEST_KEY);
        return;
      }
    }
    if (performance.now() - started < 6000) requestAnimationFrame(attempt);
    else safeRemove(RESUME_REQUEST_KEY);
  };
  requestAnimationFrame(attempt);
}

export function installMainResumeLifecycle(): void {
  window.addEventListener("pageshow", restoreSavedPosition);
  restoreSavedPosition();
}
