import { useEffect } from "react";

import { FLOORS, floorContextPath, type FloorContext, type FloorKey } from "@/src/floors";

type Props = {
  activeFloor: FloorKey;
  context: FloorContext;
  overlay?: boolean;
};

export function FloorTabs({ activeFloor, context, overlay = false }: Props) {
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
