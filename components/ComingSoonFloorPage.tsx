import { FloorTabs } from "@/components/FloorTabs";
import { GlobalNav } from "@/components/GlobalNav";
import { floorLabel, type FloorKey } from "@/src/floors";

type Props = { floor: Exclude<FloorKey, "comic"> };

export function ComingSoonFloorPage({ floor }: Props) {
  return (
    <div className="subpage-shell floor-coming-shell">
      <header className="subpage-header floor-coming-header">
        <div>
          <p className="floor-coming-kicker">SWIPE PREVIEW</p>
          <h1>{floorLabel(floor)}</h1>
        </div>
      </header>

      <main className="subpage-content floor-coming-content">
        <FloorTabs activeFloor={floor} context="feed" />
        <section className="floor-coming-card">
          <span>COMING SOON</span>
          <h2>{floorLabel(floor)}フロアは準備中です</h2>
          <p>初回リリースでは同人漫画フロアのみ提供します。共通の保存・検索・嗜好学習基盤を維持したまま、動画フロアを順次追加できる構成です。</p>
          <a href="/">同人漫画を見る</a>
        </section>
      </main>

      <GlobalNav active="main" />
    </div>
  );
}
