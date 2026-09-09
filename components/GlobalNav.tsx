import { useEffect, useRef, useState } from "react";

import { BookmarkIcon, FeedSwipeIcon, SearchIcon, UserIcon } from "@/components/icons";
import { navigateToSubpage, resumeMainFromSubpage, type NavOrigin } from "@/src/navigationState";

type NavKey = "saved" | "main" | "search" | "mypage";
type Props = { active?: NavKey };

const NAVIGATION_SETTLE_MS = 320;

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function currentNav(): NavKey {
  const path = currentPath();
  if (path === "/saved") return "saved";
  if (path === "/search") return "search";
  if (path === "/mypage" || path === "/history") return "mypage";
  return "main";
}

function currentOrigin(): NavOrigin {
  const path = currentPath();
  if (path === "/saved") return "saved";
  if (path === "/search") return "search";
  if (path === "/mypage") return "mypage";
  if (path === "/history") return "history";
  return "main";
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function GlobalNav({ active = currentNav() }: Props) {
  const origin = currentOrigin();
  const [visualActive, setVisualActive] = useState<NavKey>(active);
  const visualActiveRef = useRef<NavKey>(active);
  const navigationTimerRef = useRef<number | null>(null);
  const pendingNavigationRef = useRef<(() => void) | null>(null);

  const clearPendingNavigation = () => {
    if (navigationTimerRef.current !== null) {
      window.clearTimeout(navigationTimerRef.current);
      navigationTimerRef.current = null;
    }
    pendingNavigationRef.current = null;
  };

  const syncVisualToLocation = () => {
    clearPendingNavigation();
    const locationActive = currentNav();
    visualActiveRef.current = locationActive;
    setVisualActive(locationActive);
  };

  useEffect(() => {
    if (pendingNavigationRef.current !== null) return;
    visualActiveRef.current = active;
    setVisualActive(active);
  }, [active]);

  useEffect(() => {
    const handlePageHide = () => {
      const locationActive = currentNav();
      visualActiveRef.current = locationActive;
      pendingNavigationRef.current = null;
      if (navigationTimerRef.current !== null) {
        window.clearTimeout(navigationTimerRef.current);
        navigationTimerRef.current = null;
      }
      setVisualActive(locationActive);
    };
    const handleLocationRestore = () => syncVisualToLocation();

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handleLocationRestore);
    window.addEventListener("popstate", handleLocationRestore);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handleLocationRestore);
      window.removeEventListener("popstate", handleLocationRestore);
      if (navigationTimerRef.current !== null) window.clearTimeout(navigationTimerRef.current);
      pendingNavigationRef.current = null;
    };
  }, []);

  const returnToCurrent = (target: NavKey) => {
    clearPendingNavigation();
    if (visualActiveRef.current === target) return;
    visualActiveRef.current = target;
    setVisualActive(target);
  };

  const moveThenNavigate = (target: NavKey, navigate: () => void) => {
    const previousTarget = visualActiveRef.current;
    const wasMoving = pendingNavigationRef.current !== null;

    if (navigationTimerRef.current !== null) {
      window.clearTimeout(navigationTimerRef.current);
      navigationTimerRef.current = null;
    }

    pendingNavigationRef.current = navigate;
    visualActiveRef.current = target;
    if (previousTarget !== target) setVisualActive(target);

    if (prefersReducedMotion() || (previousTarget === target && !wasMoving)) {
      const pending = pendingNavigationRef.current;
      pendingNavigationRef.current = null;
      pending?.();
      return;
    }

    navigationTimerRef.current = window.setTimeout(() => {
      navigationTimerRef.current = null;
      const pending = pendingNavigationRef.current;
      pendingNavigationRef.current = null;
      pending?.();
    }, NAVIGATION_SETTLE_MS);
  };

  const goMain = () => {
    if (origin === "main") {
      returnToCurrent("main");
      return;
    }
    moveThenNavigate("main", resumeMainFromSubpage);
  };

  const goSubpage = (path: "/saved" | "/search", target: "saved" | "search") => {
    if (currentPath() === path) {
      returnToCurrent(target);
      return;
    }
    moveThenNavigate(target, () => navigateToSubpage(path, origin));
  };

  const goMyPage = () => {
    if (currentPath() === "/mypage") {
      returnToCurrent("mypage");
      return;
    }
    moveThenNavigate("mypage", () => navigateToSubpage("/mypage", origin));
  };

  return (
    <nav className="global-nav" data-active={visualActive} aria-label="グローバルメニュー">
      <span className="global-nav-indicator" aria-hidden="true" />
      <button
        className={`global-nav-item${visualActive === "main" ? " is-active" : ""}`}
        type="button"
        onClick={goMain}
        aria-current={active === "main" ? "page" : undefined}
        aria-label="読む"
      >
        <FeedSwipeIcon />
        <span>読む</span>
      </button>
      <button
        className={`global-nav-item${visualActive === "search" ? " is-active" : ""}`}
        type="button"
        onClick={() => goSubpage("/search", "search")}
        aria-current={active === "search" ? "page" : undefined}
        aria-label="詳細検索"
      >
        <SearchIcon />
        <span>検索</span>
      </button>
      <button
        className={`global-nav-item${visualActive === "saved" ? " is-active" : ""}`}
        type="button"
        onClick={() => goSubpage("/saved", "saved")}
        aria-current={active === "saved" ? "page" : undefined}
        aria-label="保存済み"
      >
        <BookmarkIcon />
        <span>保存</span>
      </button>
      <button
        className={`global-nav-item${visualActive === "mypage" ? " is-active" : ""}`}
        type="button"
        onClick={goMyPage}
        aria-label="マイページ"
        aria-current={currentPath() === "/mypage" ? "page" : undefined}
      >
        <UserIcon />
        <span>マイページ</span>
      </button>
    </nav>
  );
}
