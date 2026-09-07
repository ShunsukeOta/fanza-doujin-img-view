import { EyeIcon } from "@/components/icons";

type Props = {
  active: boolean;
  onToggle: () => void;
};

export function FocusModeToggle({ active, onToggle }: Props) {
  return (
    <button
      className={`focus-mode-toggle${active ? " is-active" : ""}`}
      type="button"
      aria-label={active ? "ビューアーUIを表示" : "ビューアーUIを隠す"}
      aria-pressed={active}
      title={active ? "UIを表示" : "UIを隠す"}
      onClick={onToggle}
    >
      <EyeIcon />
    </button>
  );
}
