import { FeedSwipeIcon, HeartIcon, UserIcon } from "@/components/icons";

type NavKey = "favorites" | "main" | "mypage";

type Props = {
  active?: NavKey;
  onFavorites?: () => void;
  onMain?: () => void;
  onMyPage?: () => void;
};

function currentNav(): NavKey {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/favorites") return "favorites";
  if (path === "/mypage") return "mypage";
  return "main";
}

export function GlobalNav({ active = currentNav(), onMain }: Props) {
  const goFavorites = () => {
    if (active !== "favorites") window.location.assign("/favorites");
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
      <button className={`global-nav-item${active === "favorites" ? " is-active" : ""}`} type="button" onClick={goFavorites} aria-current={active === "favorites" ? "page" : undefined}>
        <HeartIcon />
        <span>お気に入り</span>
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
