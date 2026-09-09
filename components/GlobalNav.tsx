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

  const goMain = () => {
    if (origin !== "main") resumeMainFromSubpage();
  };

  const goSubpage = (path: "/saved" | "/search") => {
    if (currentPath() === path) return;
    navigateToSubpage(path, origin);
  };

  return (
    <nav className="global-nav" aria-label="グローバルメニュー">
      <button
        className={`global-nav-item${active === "main" ? " is-active" : ""}`}
        type="button"
        onClick={goMain}
        aria-current={active === "main" ? "page" : undefined}
        aria-label="読む"
      >
        <FeedSwipeIcon />
        <span>読む</span>
      </button>
      <button
        className={`global-nav-item${active === "search" ? " is-active" : ""}`}
        type="button"
        onClick={() => goSubpage("/search")}
        aria-current={active === "search" ? "page" : undefined}
        aria-label="詳細検索"
      >
        <SearchIcon />
        <span>検索</span>
      </button>
      <button
        className={`global-nav-item${active === "saved" ? " is-active" : ""}`}
        type="button"
        onClick={() => goSubpage("/saved")}
        aria-current={active === "saved" ? "page" : undefined}
        aria-label="保存済み"
      >
        <BookmarkIcon />
        <span>保存</span>
      </button>
      <button
        className={`global-nav-item${active === "mypage" ? " is-active" : ""}`}
        type="button"
        onClick={() => {
          if (currentPath() === "/mypage") return;
          navigateToSubpage("/mypage", origin);
        }}
        aria-label="マイページ"
        aria-current={currentPath() === "/mypage" ? "page" : undefined}
      >
        <UserIcon />
        <span>マイページ</span>
      </button>
    </nav>
  );
}
