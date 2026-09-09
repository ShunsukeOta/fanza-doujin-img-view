import { useEffect, useRef, useState } from "react";

import { BookmarkIcon, FeedSwipeIcon, SearchIcon, UserIcon } from "@/components/icons";
import { navigateToSubpage, resumeMainFromSubpage, type NavOrigin } from "@/src/navigationState";

type NavKey = "saved" | "main" | "search" | "mypage";
type Props = { active?: NavKey };

const NAVIGATION_MOTION_MS = 240;

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
  const navigationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setVisualActive(active);
  }, [active]);

  useEffect(() => () => {
    if (navigationTimerRef.current !== null) window.clearTimeout(navigationTimerRef.current);
  }, []);

  const moveThenNavigate = (target: NavKey, navigate: () => void) => {
    if (navigationTimerRef.current !== null) window.clearTimeout(navigationTimerRef.current);
    const shouldAnimate = visualActive !== target && !prefersReducedMotion();
    setVisualActive(target);
    if (!shouldAnimate) {
      navigate();
      return;
    }
    navigationTimerRef.current = window.setTimeout(() => {
      navigationTimerRef.current = null;
      navigate();
    }, NAVIGATION_MOTION_MS);
  };

  const goMain = () => {
    if (origin === "main") return;
    moveThenNavigate("main", resumeMainFromSubpage);
  };

  const goSubpage = (path: "/saved" | "/search", target: "saved" | "search") => {
    if (currentPath() === path) return;
    moveThenNavigate(target, () => navigateToSubpage(path, origin));
  };

  const goMyPage = () => {
    if (currentPath() === "/mypage") return;
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
