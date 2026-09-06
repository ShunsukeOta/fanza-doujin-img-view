export function formatPrice(raw: string, numericValue: number | null = null): string {
  if (numericValue !== null && Number.isFinite(numericValue) && numericValue >= 0) {
    return `¥${Math.trunc(numericValue).toLocaleString("ja-JP")}`;
  }
  const value = raw.trim();
  if (!value) return "";
  if (/[〜～~\-–—]|以上|以下|から|より|\+/.test(value)) return value;
  const matches = [...value.matchAll(/(?:^|[^0-9])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?![0-9])/g)];
  if (matches.length !== 1) return value;
  const digits = matches[0]?.[1]?.replaceAll(",", "") ?? "";
  const number = Number.parseInt(digits, 10);
  return Number.isFinite(number) ? `¥${number.toLocaleString("ja-JP")}` : value;
}
