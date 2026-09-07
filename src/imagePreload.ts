type ImagePriority = "high" | "low" | "auto";

const decoded = new Map<string, Promise<void>>();

export function preloadAndDecodeImage(url: string, priority: ImagePriority = "auto"): Promise<void> {
  const normalized = url.trim();
  if (!normalized || typeof Image === "undefined") return Promise.resolve();
  const existing = decoded.get(normalized);
  if (existing) return existing;

  const promise = new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    try {
      (image as HTMLImageElement & { fetchPriority?: ImagePriority }).fetchPriority = priority;
    } catch {
      // fetchPriority未対応ブラウザでは通常の画像読み込みへフォールバックする。
    }

    const finish = async () => {
      try {
        if (typeof image.decode === "function") await image.decode();
      } catch {
        // Safari等でdecodeが失敗してもonload済みならブラウザキャッシュは利用できる。
      }
      resolve();
    };

    image.onload = () => { void finish(); };
    image.onerror = () => resolve();
    image.src = normalized;

    if (image.complete && image.naturalWidth > 0) void finish();
  });

  decoded.set(normalized, promise);
  return promise;
}

export function preloadAndDecodeImages(urls: string[], priority: ImagePriority = "auto"): void {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  for (const url of unique) void preloadAndDecodeImage(url, priority);
}
