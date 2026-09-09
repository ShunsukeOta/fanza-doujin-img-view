export type ReaderDirection = "rtl" | "ltr";

const CTA_OVERLAY_STRIP_PX = 2;
const CTA_EDGE_TOLERANCE_PX = 0.75;
const CTA_LAYOUT_TOLERANCE_PX = 3;

function usesOverlayCtaStrip(maxScrollLeft: number, width: number, ctaPage: number): boolean {
  if (!Number.isFinite(width) || width <= 0 || ctaPage <= 0) return false;
  const expectedMax = Math.max(0, ctaPage - 1) * width + CTA_OVERLAY_STRIP_PX;
  return Math.abs(Math.max(0, maxScrollLeft) - expectedMax) <= CTA_LAYOUT_TOLERANCE_PX;
}

export function logicalPageFromScroll(maxScrollLeft: number, scrollLeft: number, width: number, ctaPage: number): number {
  return logicalPageFromDirectionalScroll(maxScrollLeft, scrollLeft, width, ctaPage, "rtl");
}

export function logicalPageFromDirectionalScroll(
  maxScrollLeft: number,
  scrollLeft: number,
  width: number,
  ctaPage: number,
  direction: ReaderDirection,
): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  const safeMax = Math.max(0, maxScrollLeft);
  const safeScroll = Math.max(0, Math.min(safeMax, scrollLeft));

  if (usesOverlayCtaStrip(safeMax, width, ctaPage)) {
    const distanceFromCtaEdge = direction === "rtl" ? safeScroll : safeMax - safeScroll;
    if (distanceFromCtaEdge <= CTA_EDGE_TOLERANCE_PX) return ctaPage;
  }

  const raw = direction === "rtl"
    ? Math.round((safeMax - safeScroll) / width)
    : Math.round(safeScroll / width);
  return Math.max(0, Math.min(Math.max(0, ctaPage), raw));
}

export function scrollLeftForLogicalPage(
  maxScrollLeft: number,
  width: number,
  page: number,
  ctaPage: number,
  direction: ReaderDirection,
): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  const safeMax = Math.max(0, maxScrollLeft);
  const safePage = Math.max(0, Math.min(Math.max(0, ctaPage), Math.trunc(page)));
  const raw = direction === "rtl" ? safeMax - safePage * width : safePage * width;
  return Math.max(0, Math.min(safeMax, raw));
}

export function tapNavigationDelta(xRatio: number, direction: ReaderDirection): -1 | 0 | 1 {
  const x = Math.max(0, Math.min(1, xRatio));
  if (x >= 0.3 && x <= 0.7) return 0;
  if (direction === "rtl") return x < 0.3 ? 1 : -1;
  return x > 0.7 ? 1 : -1;
}

export function sampleReadRatio(sampleCount: number, maxSamplePage: number): number {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) return 0;
  const page = Math.max(0, Math.min(sampleCount - 1, Math.trunc(maxSamplePage)));
  return Math.min(1, (page + 1) / sampleCount);
}

export function progressedSamplePages(startSamplePage: number, maxSamplePage: number): number {
  return Math.max(0, Math.trunc(maxSamplePage) - Math.max(0, Math.trunc(startSamplePage)));
}
