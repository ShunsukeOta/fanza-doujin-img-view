import { BookmarkIcon, FeedSwipeIcon, UserIcon } from "@/components/icons";
import { navigateToSubpage, resumeMainFromSubpage } from "@/src/navigationState";

type NavKey = "saved" | "main" | "mypage";
type Props = { active?: NavKey };

function currentNav(): NavKey {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/saved" || path === "/favorites") return "saved";
  if (path === "/mypage") return "mypage";
  return "main";
}

export function GlobalNav({ active = currentNav() }: Props) {
  const goMain = () => { if (active !== "main") resumeMainFromSubpage(); };
  return <nav className="global-nav" aria-label="グローバルメニュー">
    <button className={`global-nav-item${active === "saved" ? " is-active" : ""}`} type="button" onClick={() => { if (active !== "saved") navigateToSubpage("/saved", active); }} aria-label="保存済み" aria-current={active === "saved" ? "page" : undefined}><BookmarkIcon /><span>保存済み</span></button>
    <button className="global-nav-main" type="button" onClick={goMain} aria-current={active === "main" ? "page" : undefined} aria-label="メインページ・上下にスワイプして作品を移動"><FeedSwipeIcon /><span className="sr-only">メインページ</span></button>
    <button className={`global-nav-item${active === "mypage" ? " is-active" : ""}`} type="button" onClick={() => { if (active !== "mypage") navigateToSubpage("/mypage", active); }} aria-label="マイページ" aria-current={active === "mypage" ? "page" : undefined}><UserIcon /><span>マイページ</span></button>
  </nav>;
}
