const MAIN_RETURN_KEY = "swipe-preview:main-return-v2";
const RESUME_REQUEST_KEY = "swipe-preview:resume-request-v2";
const MAX_STATE_AGE_MS = 12 * 60 * 60 * 1000;

type SubpagePath = "/saved" | "/mypage";

type MainReturnState = {
  resumeUrl: string;
  cid: string;
  page: number;
  subpage: SubpagePath;
  historySteps: number;
  savedAt: number;
};

function safeSessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage が利用不可でも通常遷移は継続する。
  }
}

function safeSessionRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // noop
  }
}

function readState(): MainReturnState | null {
  const raw = safeSessionGet(MAIN_RETURN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MainReturnState>;
    if (
      typeof parsed.resumeUrl !== "string"
      || typeof parsed.cid !== "string"
      || typeof parsed.page !== "number"
      || (parsed.subpage !== "/saved" && parsed.subpage !== "/mypage")
      || typeof parsed.historySteps !== "number"
      || parsed.historySteps < 1
      || typeof parsed.savedAt !== "number"
      || Date.now() - parsed.savedAt > MAX_STATE_AGE_MS
    ) {
      safeSessionRemove(MAIN_RETURN_KEY);
      return null;
    }
    return parsed as MainReturnState;
  } catch {
    safeSessionRemove(MAIN_RETURN_KEY);
    return null;
  }
}

function activeWorkSnapshot(): { cid: string; page: number } | null {
  const feed = document.getElementById("feed");
  if (!(feed instanceof HTMLElement) || feed.clientHeight <= 0) return null;

  const index = Math.max(0, Math.round(feed.scrollTop / feed.clientHeight));
  const item = feed.querySelector<HTMLElement>(`.feed-item[data-work-index="${index}"]`)
    ?? feed.querySelector<HTMLElement>(".feed-item");
  const cid = item?.dataset.cid?.trim() ?? "";
  if (!cid) return null;

  const pageText = item?.querySelector<HTMLElement>(".page-counter span")?.textContent ?? "1";
  const parsedPage = Number.parseInt(pageText, 10);
  return {
    cid,
    page: Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1,
  };
}

export function rememberMainBeforeSubpage(subpage: SubpagePath): void {
  const snapshot = activeWorkSnapshot();
  if (!snapshot) return;

  const url = new URL(window.location.href);
  url.pathname = "/";
  url.hash = "";
  url.searchParams.set("cid", snapshot.cid);

  const state: MainReturnState = {
    resumeUrl: `${url.pathname}${url.search}`,
    cid: snapshot.cid,
    page: snapshot.page,
    subpage,
    historySteps: 1,
    savedAt: Date.now(),
  };
  safeSessionSet(MAIN_RETURN_KEY, JSON.stringify(state));
  safeSessionRemove(RESUME_REQUEST_KEY);
}

export function continueSubpageNavigation(subpage: SubpagePath): void {
  const state = readState();
  if (!state) return;
  safeSessionSet(MAIN_RETURN_KEY, JSON.stringify({
    ...state,
    subpage,
    historySteps: state.historySteps + 1,
    savedAt: Date.now(),
  } satisfies MainReturnState));
}

export function resumeMainFromSubpage(): void {
  const state = readState();
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (!state || state.subpage !== path) {
    window.location.assign("/");
    return;
  }

  safeSessionSet(RESUME_REQUEST_KEY, "1");

  // 同一タブ内では、経由したサブページ数だけ履歴を戻してBFCache上のReact状態を丸ごと復元する。
  if (window.history.length > state.historySteps) {
    window.history.go(-state.historySteps);
    return;
  }

  // 履歴がないPWA起動などではCID指定URLを使って見ていた作品を先頭に復元する。
  window.location.assign(state.resumeUrl);
}

export function openWorkInMain(cid: string): void {
  const normalized = cid.trim();
  if (!normalized) return;
  safeSessionRemove(RESUME_REQUEST_KEY);
  const url = new URL("/", window.location.origin);
  url.searchParams.set("cid", normalized);
  window.location.assign(`${url.pathname}${url.search}`);
}

export function prepareMainResumeFallback(): void {
  if (safeSessionGet(RESUME_REQUEST_KEY) !== "1") return;
  const state = readState();
  if (!state) {
    safeSessionRemove(RESUME_REQUEST_KEY);
    return;
  }

  const current = `${window.location.pathname}${window.location.search}`;
  if (current !== state.resumeUrl) {
    window.history.replaceState(window.history.state, "", state.resumeUrl);
  }
}

function findWorkByCid(cid: string): HTMLElement | null {
  const works = document.querySelectorAll<HTMLElement>(".feed-item[data-cid]");
  for (const work of works) {
    if (work.dataset.cid === cid) return work;
  }
  return null;
}

function restoreSavedPosition(): void {
  if (safeSessionGet(RESUME_REQUEST_KEY) !== "1") return;
  const state = readState();
  if (!state) {
    safeSessionRemove(RESUME_REQUEST_KEY);
    return;
  }

  const startedAt = performance.now();
  const attempt = () => {
    const feed = document.getElementById("feed");
    const item = findWorkByCid(state.cid);
    const track = item?.querySelector<HTMLElement>(".preview-track");

    if (feed instanceof HTMLElement && item && track) {
      feed.scrollTop = item.offsetTop;
      const pageIndex = Math.max(0, state.page - 1);
      const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth);
      track.scrollLeft = Math.max(0, maxScrollLeft - pageIndex * track.clientWidth);
      safeSessionRemove(RESUME_REQUEST_KEY);
      return;
    }

    if (performance.now() - startedAt < 6000) {
      window.requestAnimationFrame(attempt);
    } else {
      safeSessionRemove(RESUME_REQUEST_KEY);
    }
  };

  window.requestAnimationFrame(attempt);
}

export function installMainResumeLifecycle(): void {
  window.addEventListener("pageshow", restoreSavedPosition);
  restoreSavedPosition();
}
