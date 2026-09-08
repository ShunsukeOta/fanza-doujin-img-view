export async function fetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  fallback = "通信に失敗しました",
): Promise<T> {
  const response = await fetch(input, init);
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data
      && typeof data === "object"
      && "error" in data
      && typeof data.error === "string"
      ? data.error
      : `${fallback} (${response.status})`;
    throw new Error(message);
  }

  return data as T;
}
