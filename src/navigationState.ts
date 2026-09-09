import { scrollLeftForLogicalPage } from "@/src/readerMath";
import { loadReaderSettings } from "@/src/readerSettings";
import {
  clearResumeRequested,
  markResumeRequested,
  readActiveReader,
  readMainReturnState,
  resumeRequested,
  writeMainReturnState,
} from "@/src/readerResumeState";
import type { NavOrigin, SubpagePath } from "@/src/routes";

function rememberMainBeforeSubpage(subpage: SubpagePath): void {
  const snapshot = readActiveReader();
  if (!snapshot) return;

  const resumeUrl = `/work/${encodeURIComponent(snapshot.cid)}`;
  writeMainReturnState({
    ...snapshot,
    resumeUrl,
    subpage,
    historySteps: 1,
    savedAt: Date.now(),
  });
  clearResumeRequested();
}

function continueSubpageNavigation(subpage: SubpagePath): void {
  const state = readMainReturnState();
  if (!state) return;
  writeMainReturnState({
    ...state,
    subpage,
    historySteps: state.historySteps + 1,
    savedAt: Date.now(),
  });
}

export function navigateToSubpage(subpage: SubpagePath, origin: NavOrigin): void {
  if (origin === "main") rememberMainBeforeSubpage(subpage);
  else continueSubpageNavigation(subpage);
  window.location.assign(subpage);
}

export function resumeMainFromSubpage(): void {
  const state = readMainReturnState();
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (!state || state.subpage !== path) {
    window.location.assign("/");
    return;
  }

  markResumeRequested();
  if (window.history.length > state.historySteps) {
    window.history.go(-state.historySteps);
    return;
  }
  window.location.assign(state.resumeUrl);
}

export function openWorkInMain(cid: string): void {
  const normalized = cid.trim();
  if (!normalized) return;
  clearResumeRequested();
  window.location.assign(`/work/${encodeURIComponent(normalized)}`);
}

export function prepareMainResumeFallback(): void {
  if (!resumeRequested()) return;
  const state = readMainReturnState();
  if (!state) {
    clearResumeRequested();
    return;
  }

  const current = `${location.pathname}${location.search}`;
  if (current !== state.resumeUrl) history.replaceState(history.state, "", state.resumeUrl);
}

function restoreSavedPosition(): void {
  if (!resumeRequested()) return;
  const state = readMainReturnState();
  if (!state) {
    clearResumeRequested();
    return;
  }

  const started = performance.now();
  const attempt = () => {
    const feed = document.getElementById("feed");
    const item = [...document.querySelectorAll<HTMLElement>(".feed-item[data-cid]")]
      .find((work) => work.dataset.cid === state.cid);
    const track = item?.querySelector<HTMLElement>(".preview-track");

    if (feed instanceof HTMLElement && item && track && track.clientWidth > 0) {
      feed.scrollTop = item.offsetTop;
      const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth);
      const ctaPage = item.querySelectorAll("[data-sample-page]").length;
      const direction = loadReaderSettings().readingDirection;
      track.scrollLeft = scrollLeftForLogicalPage(
        maxScrollLeft,
        track.clientWidth,
        state.pageIndex,
        ctaPage,
        direction,
      );
      item.dataset.readerPage = String(state.pageIndex);
      item.dataset.readerCta = state.isCta ? "1" : "0";
      track.dispatchEvent(new Event("scroll", { bubbles: true }));
      clearResumeRequested();
      return;
    }

    if (performance.now() - started < 6000) requestAnimationFrame(attempt);
    else clearResumeRequested();
  };

  requestAnimationFrame(attempt);
}

export function installMainResumeLifecycle(): () => void {
  window.addEventListener("pageshow", restoreSavedPosition);
  restoreSavedPosition();
  return () => window.removeEventListener("pageshow", restoreSavedPosition);
}
