export function logicalPageFromScroll(maxScrollLeft: number, scrollLeft: number, width: number, ctaPage: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  const raw = Math.round((Math.max(0, maxScrollLeft) - Math.max(0, scrollLeft)) / width);
  return Math.max(0, Math.min(Math.max(0, ctaPage), raw));
}

export function sampleReadRatio(sampleCount: number, maxSamplePage: number): number {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) return 0;
  const page = Math.max(0, Math.min(sampleCount - 1, Math.trunc(maxSamplePage)));
  return Math.min(1, (page + 1) / sampleCount);
}

export function progressedSamplePages(startSamplePage: number, maxSamplePage: number): number {
  return Math.max(0, Math.trunc(maxSamplePage) - Math.max(0, Math.trunc(startSamplePage)));
}
