import { useEffect, useId, useRef, useState } from "react";

import { ChevronDownIcon, ViewSwitchIcon } from "@/components/icons";
import { FLOORS, floorContextPath, floorLabel, type FloorContext, type FloorKey } from "@/src/floors";

type Props = {
  activeFloor: FloorKey;
  context: FloorContext;
  overlay?: boolean;
};

export function FloorSwitcher({ activeFloor, context, overlay = false }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const activeLabel = floorLabel(activeFloor);

  useEffect(() => {
    if (!open) return;

    const closeFromOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`floor-switcher floor-switcher--${overlay ? "overlay" : "inline"}`}
    >
      <button
        ref={triggerRef}
        className={`floor-switcher-trigger${open ? " is-open" : ""}`}
        type="button"
        aria-label={overlay ? `表示切替。現在は${activeLabel}` : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={overlay ? `表示切替: ${activeLabel}` : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="floor-switcher-trigger-icon"><ViewSwitchIcon /></span>
        {!overlay ? (
          <>
            <span className="floor-switcher-trigger-copy">
              <small>表示</small>
              <strong>{activeLabel}</strong>
            </span>
            <span className="floor-switcher-chevron"><ChevronDownIcon /></span>
          </>
        ) : null}
      </button>

      <div
        className={`floor-switcher-menu${open ? " is-open" : ""}`}
        id={menuId}
        role="menu"
        aria-label="表示するコンテンツ"
        aria-hidden={!open}
      >
        <div className="floor-switcher-menu-head">
          <span>表示するコンテンツ</span>
          <small>VIEW</small>
        </div>
        <div className="floor-switcher-options">
          {FLOORS.map((floor) => {
            const active = floor.key === activeFloor;
            return (
              <a
                className={`floor-switcher-option${active ? " is-active" : ""}`}
                href={floorContextPath(floor.key, context)}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onClick={(event) => {
                  if (active) event.preventDefault();
                  setOpen(false);
                }}
                key={floor.key}
              >
                <span className="floor-switcher-option-mark" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="floor-switcher-option-copy">
                  <strong>{floor.label}</strong>
                  <small>{floor.available ? "表示できます" : "近日対応予定"}</small>
                </span>
                {floor.available ? (
                  <span className="floor-switcher-option-state" aria-hidden="true">{active ? "✓" : ""}</span>
                ) : (
                  <span className="floor-switcher-coming">準備中</span>
                )}
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
