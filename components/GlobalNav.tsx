import { BookmarkIcon, FeedSwipeIcon, UserIcon } from "@/components/icons";
import { navigateToSubpage, resumeMainFromSubpage, type NavOrigin } from "@/src/navigationState";

type NavKey = "saved" | "main" | "mypage";
type Props = { active?: NavKey };

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function currentNav(): NavKey {
  const path = currentPath();
  if (path === "/saved" || path === "/favorites") return "saved";
  if (path === "/mypage" || path === "/history") return "mypage";
  return "main";
}

function currentOrigin(): NavOrigin {
  const path = currentPath();
  if (path === "/saved" || path === "/favorites") return "saved";
  if (path === "/mypage") return "mypage";
  if (path === "/history") return "history";
  return "main";
}

export function GlobalNav({ active = currentNav() }: Props) {
  const origin = currentOrigin();
  const goMain = () => { if (origin !== "main") resumeMainFromSubpage(); };
  return <nav className="global-nav" aria-label="グローバルメニュー">
    <button className={`global-nav-item${active === "saved" ? " is-active" : ""}`} type="button" onClick={() => { if (currentPath() !== "/saved") navigateToSubpage("/saved", origin); }} aria-label="保存済み" aria-current={currentPath() === "/saved" ? "page" : undefined}><BookmarkIcon /><span>保存済み</span></button>
    <button className="global-nav-main" type="button" onClick={goMain} aria-current={origin === "main" ? "page" : undefined} aria-label="メインページ・上下にスワイプして作品を移動"><FeedSwipeIcon /><span className="sr-only">メインページ</span></button>
    <button className={`global-nav-item${active === "mypage" ? " is-active" : ""}`} type="button" onClick={() => { if (currentPath() !== "/mypage") navigateToSubpage("/mypage", origin); }} aria-label="マイページ" aria-current={currentPath() === "/mypage" ? "page" : undefined}><UserIcon /><span>マイページ</span></button>
  </nav>;
}
