import { useEffect, useRef, useState } from "react";

import { BookmarkIcon, FeedSwipeIcon, SearchIcon, UserIcon } from "@/components/icons";
import { navigateToSubpage, resumeMainFromSubpage, type NavOrigin } from "@/src/navigationState";

type NavKey = "saved" | "main" | "search" | "mypage";
type Props = { active?: NavKey };

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

export function GlobalNav({ active = currentNav() }: Props) {
  const origin = currentOrigin();
  const navRef = useRef<HTMLElement | null>(null);
  const [visualActive, setVisualActive] = useState<NavKey>(active);
  const visualActiveRef = useRef<NavKey>(active);
  const navigationFrameRef = useRef<number | null>(null);
  const pendingNavigationRef = useRef<(() => void) | null>(null);

  const clearPendingNavigation = () => {
    if (navigationFrameRef.current !== null) {
      window.cancelAnimationFrame(navigationFrameRef.current);
      navigationFrameRef.current = null;
    }
    pendingNavigationRef.current = null;
  };

  const syncSnapshotDom = (target: NavKey) => {
    const nav = navRef.current;
    if (!nav) return;
    nav.dataset.active = target;
    nav.querySelectorAll<HTMLElement>("[data-nav-key]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.navKey === target);
    });
  };

  const syncVisualToLocation = () => {
    clearPendingNavigation();
    const locationActive = currentNav();
    visualActiveRef.current = locationActive;
    syncSnapshotDom(locationActive);
    setVisualActive(locationActive);
  };

  useEffect(() => {
    if (pendingNavigationRef.current !== null) return;
    visualActiveRef.current = active;
    setVisualActive(active);
  }, [active]);

  useEffect(() => {
    const handlePageHide = () => {
      clearPendingNavigation();
      const locationActive = currentNav();
      visualActiveRef.current = locationActive;
      syncSnapshotDom(locationActive);
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
      clearPendingNavigation();
    };
  }, []);

  const returnToCurrent = (target: NavKey) => {
    clearPendingNavigation();
    if (visualActiveRef.current === target) return;
    visualActiveRef.current = target;
    syncSnapshotDom(target);
    setVisualActive(target);
  };

  const moveThenNavigate = (target: NavKey, navigate: () => void) => {
    clearPendingNavigation();
    const previousTarget = visualActiveRef.current;

    pendingNavigationRef.current = navigate;
    visualActiveRef.current = target;
    syncSnapshotDom(target);
    if (previousTarget !== target) setVisualActive(target);

    navigationFrameRef.current = window.requestAnimationFrame(() => {
      navigationFrameRef.current = null;
      const pending = pendingNavigationRef.current;
      pendingNavigationRef.current = null;
      pending?.();
    });
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
    <nav ref={navRef} className="global-nav" data-active={visualActive} aria-label="グローバルメニュー">
      <span className="global-nav-indicator" aria-hidden="true" />
      <button
        className={`global-nav-item${visualActive === "main" ? " is-active" : ""}`}
        data-nav-key="main"
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
        data-nav-key="search"
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
        data-nav-key="saved"
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
        data-nav-key="mypage"
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
