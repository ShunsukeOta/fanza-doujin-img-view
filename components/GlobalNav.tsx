import { BookmarkIcon, FeedSwipeIcon, UserIcon } from "@/components/icons";

type NavKey = "saved" | "main" | "mypage";

type Props = {
  active?: NavKey;
  onMain?: () => void;
};

function currentNav(): NavKey {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/saved" || path === "/favorites") return "saved";
  if (path === "/mypage") return "mypage";
  return "main";
}

export function GlobalNav({ active = currentNav(), onMain }: Props) {
  const goSaved = () => {
    if (active !== "saved") window.location.assign("/saved");
  };
  const goMain = () => {
    if (active === "main") {
      onMain?.();
      return;
    }
    window.location.assign("/");
  };
  const goMyPage = () => {
    if (active !== "mypage") window.location.assign("/mypage");
  };

  return (
    <nav className="global-nav" aria-label="グローバルメニュー">
      <button className={`global-nav-item${active === "saved" ? " is-active" : ""}`} type="button" onClick={goSaved} aria-current={active === "saved" ? "page" : undefined}>
        <BookmarkIcon />
        <span>保存済み</span>
      </button>
      <button className="global-nav-main" type="button" onClick={goMain} aria-current={active === "main" ? "page" : undefined} aria-label="メインページ・上下にスワイプして作品を移動">
        <FeedSwipeIcon />
        <span className="sr-only">メインページ</span>
      </button>
      <button className={`global-nav-item${active === "mypage" ? " is-active" : ""}`} type="button" onClick={goMyPage} aria-current={active === "mypage" ? "page" : undefined}>
        <UserIcon />
        <span>マイページ</span>
      </button>
    </nav>
  );
}
