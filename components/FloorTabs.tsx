import { useEffect } from "react";

import { FLOORS, floorContextPath, floorLabel, type FloorContext, type FloorKey } from "@/src/floors";

type FloorTabsProps = {
  activeFloor: FloorKey;
  context: FloorContext;
  overlay?: boolean;
};

export function FloorTabs({ activeFloor, context, overlay = false }: FloorTabsProps) {
  useEffect(() => {
    if (!overlay) return;
    document.body.classList.add("has-feed-floor-tabs");
    return () => document.body.classList.remove("has-feed-floor-tabs");
  }, [overlay]);

  return (
    <nav
      className={`floor-tabs${overlay ? " floor-tabs--overlay" : ""}`}
      aria-label="フロア切り替え"
    >
      {FLOORS.map((floor) => (
        <a
          className={`floor-tab${activeFloor === floor.key ? " is-active" : ""}${floor.available ? "" : " is-coming"}`}
          href={floorContextPath(floor.key, context)}
          aria-current={activeFloor === floor.key ? "page" : undefined}
          key={floor.key}
        >
          <span>{floor.label}</span>
          {!floor.available ? <small>準備中</small> : null}
        </a>
      ))}
    </nav>
  );
}

export function FloorComingSoon({ floor }: { floor: FloorKey }) {
  return (
    <section className="floor-coming-card">
      <span>COMING SOON</span>
      <h2>{floorLabel(floor)}は準備中です</h2>
      <p>初回リリースでは同人漫画のみ提供します。動画フロアは、Video Viewer・検索条件・横断レコメンドを整備した段階で順次公開します。</p>
    </section>
  );
}
