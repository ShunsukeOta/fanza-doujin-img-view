export type ReaderFitMode = "contain" | "width";
export type ReaderDirection = "rtl" | "ltr";

export type ReaderSettings = {
  fitMode: ReaderFitMode;
  readingDirection: ReaderDirection;
  tapNavigation: boolean;
  controlsHidden: boolean;
};

const STORAGE_KEY = "swipe-preview:reader-settings-v1";
const SETTINGS_EVENT = "swipe-preview:reader-settings-change";

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fitMode: "contain",
  readingDirection: "rtl",
  tapNavigation: true,
  controlsHidden: false,
};

function normalizeReaderSettings(value: Partial<ReaderSettings> | null | undefined): ReaderSettings {
  return {
    fitMode: value?.fitMode === "width" ? "width" : "contain",
    readingDirection: value?.readingDirection === "ltr" ? "ltr" : "rtl",
    tapNavigation: value?.tapNavigation !== false,
    controlsHidden: value?.controlsHidden === true,
  };
}

export function readerSettingsEqual(a: ReaderSettings, b: ReaderSettings): boolean {
  return a.fitMode === b.fitMode
    && a.readingDirection === b.readingDirection
    && a.tapNavigation === b.tapNavigation
    && a.controlsHidden === b.controlsHidden;
}

export function loadReaderSettings(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_READER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    return normalizeReaderSettings(JSON.parse(raw) as Partial<ReaderSettings>);
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeReaderSettings(settings);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Private mode等でlocalStorageが利用できなくてもビューアー自体は継続する。
  }
  window.dispatchEvent(new CustomEvent<ReaderSettings>(SETTINGS_EVENT, { detail: normalized }));
}

export function subscribeReaderSettings(listener: (settings: ReaderSettings) => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const syncFromStorage = () => listener(loadReaderSettings());
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) syncFromStorage();
  };
  const handleCustom = (event: Event) => {
    const detail = (event as CustomEvent<ReaderSettings>).detail;
    listener(normalizeReaderSettings(detail));
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(SETTINGS_EVENT, handleCustom);
  window.addEventListener("pageshow", syncFromStorage);
  window.addEventListener("focus", syncFromStorage);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(SETTINGS_EVENT, handleCustom);
    window.removeEventListener("pageshow", syncFromStorage);
    window.removeEventListener("focus", syncFromStorage);
  };
}

export function applyReaderControlsVisibility(hidden: boolean): void {
  if (typeof document === "undefined") return;
  document.body.classList.toggle("reader-focus", hidden);
}
