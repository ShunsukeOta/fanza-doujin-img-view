type StandaloneNavigator = Navigator & { standalone?: boolean };

const MAX_BOTTOM_EXTENSION = 160;

function isStandaloneDisplay(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches === true
    || (navigator as StandaloneNavigator).standalone === true;
}

function measureBottomExtension(): number {
  if (!isStandaloneDisplay()) return 0;

  const viewport = window.visualViewport;
  const visibleBottom = viewport
    ? viewport.offsetTop + viewport.height
    : window.innerHeight;
  const screenHeight = window.screen.height;

  if (!Number.isFinite(screenHeight) || !Number.isFinite(visibleBottom)) return 0;
  return Math.max(0, Math.min(MAX_BOTTOM_EXTENSION, Math.round(screenHeight - visibleBottom)));
}

export function installPwaViewportFix(): void {
  const root = document.documentElement;
  const sync = () => {
    const standalone = isStandaloneDisplay();
    root.dataset.pwaStandalone = standalone ? "true" : "false";
    root.style.setProperty("--pwa-bottom-extension", `${measureBottomExtension()}px`);
  };

  sync();
  window.addEventListener("resize", sync, { passive: true });
  window.addEventListener("orientationchange", sync, { passive: true });
  window.addEventListener("pageshow", sync, { passive: true });
  window.visualViewport?.addEventListener("resize", sync, { passive: true });
  window.visualViewport?.addEventListener("scroll", sync, { passive: true });
}
