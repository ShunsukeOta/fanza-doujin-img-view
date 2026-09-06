export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfterMs = 0) {
    super(message);
  }
}

export async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}, fallback = "通信に失敗しました"): Promise<T> {
  const response = await fetch(input, init);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : `${fallback} (${response.status})`;
    const retrySeconds = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
    throw new ApiError(message, response.status, Number.isFinite(retrySeconds) ? Math.max(0, retrySeconds * 1000) : 0);
  }
  return data as T;
}

export function retryDelay(attempt: number, serverDelay = 0): number {
  if (serverDelay > 0) return Math.min(30_000, serverDelay);
  return Math.min(15_000, 750 * 2 ** Math.max(0, attempt));
}
