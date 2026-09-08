type ImagePriority = "high" | "low" | "auto";

const MAX_DECODE_CACHE = 256;
const decoded = new Map<string, Promise<void>>();

function remember(url: string, promise: Promise<void>): void {
  decoded.delete(url);
  decoded.set(url, promise);
  while (decoded.size > MAX_DECODE_CACHE) {
    const oldest = decoded.keys().next().value as string | undefined;
    if (!oldest) break;
    decoded.delete(oldest);
  }
}

export function preloadAndDecodeImage(url: string, priority: ImagePriority = "auto"): Promise<void> {
  const normalized = url.trim();
  if (!normalized || typeof Image === "undefined") return Promise.resolve();

  const existing = decoded.get(normalized);
  if (existing) {
    remember(normalized, existing);
    return existing;
  }

  const promise = new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    let settled = false;

    try {
      (image as HTMLImageElement & { fetchPriority?: ImagePriority }).fetchPriority = priority;
    } catch {
      // fetchPriority未対応ブラウザでは通常の画像読み込みへフォールバックする。
    }

    const complete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const finish = async () => {
      if (settled) return;
      try {
        if (typeof image.decode === "function") await image.decode();
      } catch {
        // decodeが失敗してもonload済みならブラウザキャッシュは利用できる。
      }
      complete();
    };

    image.onload = () => { void finish(); };
    image.onerror = () => {
      decoded.delete(normalized);
      complete();
    };
    image.src = normalized;

    if (image.complete && image.naturalWidth > 0) void finish();
  });

  remember(normalized, promise);
  return promise;
}

export function preloadAndDecodeImages(urls: string[], priority: ImagePriority = "auto"): void {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  for (const url of unique) void preloadAndDecodeImage(url, priority);
}
