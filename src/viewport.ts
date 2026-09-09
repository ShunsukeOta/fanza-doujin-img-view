const APP_HEIGHT_PROPERTY = "--app-height";

function isStandalone(): boolean {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches
    || navigatorWithStandalone.standalone === true;
}

function applyViewportHeight(): void {
  if (!isStandalone()) {
    document.documentElement.style.removeProperty(APP_HEIGHT_PROPERTY);
    return;
  }

  const height = Math.max(1, Math.round(window.innerHeight));
  document.documentElement.style.setProperty(APP_HEIGHT_PROPERTY, `${height}px`);
}

export function installViewportSizing(): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      applyViewportHeight();
    });
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") schedule();
  };

  applyViewportHeight();
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  window.addEventListener("pageshow", schedule, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    if (frame !== 0) cancelAnimationFrame(frame);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    window.removeEventListener("pageshow", schedule);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
