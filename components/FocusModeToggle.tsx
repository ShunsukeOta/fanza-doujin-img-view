import { useEffect, useState } from "react";

import { EyeIcon } from "@/components/icons";

export function FocusModeToggle() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("reader-focus", active);
    return () => document.body.classList.remove("reader-focus");
  }, [active]);

  return (
    <button
      className={`focus-mode-toggle${active ? " is-active" : ""}`}
      type="button"
      aria-label={active ? "漫画集中モードを終了" : "漫画集中モード"}
      aria-pressed={active}
      title={active ? "集中モードを終了" : "漫画集中モード"}
      onClick={() => setActive((current) => !current)}
    >
      <EyeIcon />
    </button>
  );
}
