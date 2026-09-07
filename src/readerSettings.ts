export type ReaderFitMode = "contain" | "width";
export type ReaderDirection = "rtl" | "ltr";

export type ReaderSettings = {
  fitMode: ReaderFitMode;
  readingDirection: ReaderDirection;
  tapNavigation: boolean;
  controlsHidden: boolean;
};

const STORAGE_KEY = "swipe-preview:reader-settings-v1";

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fitMode: "contain",
  readingDirection: "rtl",
  tapNavigation: true,
  controlsHidden: false,
};

export function loadReaderSettings(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_READER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      fitMode: parsed.fitMode === "width" ? "width" : "contain",
      readingDirection: parsed.readingDirection === "ltr" ? "ltr" : "rtl",
      tapNavigation: parsed.tapNavigation !== false,
      controlsHidden: parsed.controlsHidden === true,
    };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode等でlocalStorageが利用できなくてもビューアー自体は継続する。
  }
}

export function applyReaderControlsVisibility(hidden: boolean): void {
  if (typeof document === "undefined") return;
  document.body.classList.toggle("reader-focus", hidden);
}
