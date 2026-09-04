import { FeedSwipeIcon, HeartIcon, UserIcon } from "@/components/icons";

type Props = {
  onFavorites: () => void;
  onMain: () => void;
  onMyPage: () => void;
};

export function GlobalNav({ onFavorites, onMain, onMyPage }: Props) {
  return (
    <nav className="global-nav" aria-label="グローバルメニュー">
      <button className="global-nav-item" type="button" onClick={onFavorites}>
        <HeartIcon />
        <span>お気に入り</span>
      </button>
      <button className="global-nav-main" type="button" onClick={onMain} aria-label="メインページ・上下にスワイプして作品を移動">
        <FeedSwipeIcon />
        <span className="sr-only">メインページ</span>
      </button>
      <button className="global-nav-item" type="button" onClick={onMyPage}>
        <UserIcon />
        <span>マイページ</span>
      </button>
    </nav>
  );
}
