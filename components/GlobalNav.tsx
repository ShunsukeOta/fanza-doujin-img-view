import { BookmarkIcon, FeedSwipeIcon, SearchIcon, UserIcon } from "@/components/icons";
import { floorContextPath, floorFromLocation } from "@/src/floors";
import { navigateToSubpage, resumeMainFromSubpage, type NavOrigin } from "@/src/navigationState";

type NavKey = "saved" | "main" | "search" | "mypage";
type Props = { active?: NavKey };

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function currentNav(): NavKey {
  const path = currentPath();
  if (path === "/saved" || path === "/favorites") return "saved";
  if (path === "/search") return "search";
  if (path === "/mypage" || path === "/history") return "mypage";
  return "main";
}

function currentOrigin(): NavOrigin {
  const path = currentPath();
  if (path === "/saved" || path === "/favorites") return "saved";
  if (path === "/search") return "search";
  if (path === "/mypage") return "mypage";
  if (path === "/history") return "history";
  return "main";
}

export function GlobalNav({ active = currentNav() }: Props) {
  const origin = currentOrigin();
  const floor = floorFromLocation();

  const goMain = () => {
    if (floor !== "comic") {
      window.location.assign(floorContextPath(floor, "feed"));
      return;
    }
    if (origin !== "main") resumeMainFromSubpage();
  };

  const goSubpage = (path: "/saved" | "/search") => {
    const context = path === "/saved" ? "saved" : "search";
    const target = floorContextPath(floor, context);
    const current = `${currentPath()}${window.location.search}`;
    if (current === target) return;

    if (floor === "comic") navigateToSubpage(path, origin);
    else window.location.assign(target);
  };

  return (
    <nav className="global-nav" aria-label="グローバルメニュー">
      <button
        className={`global-nav-item global-nav-main${active === "main" ? " is-active" : ""}`}
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
          if (floor === "comic") navigateToSubpage("/mypage", origin);
          else window.location.assign("/mypage");
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
