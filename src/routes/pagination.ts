export const ALLOWED_PAGE_SIZES = [5, 10, 20, 50] as const;

export function parsePageSize(raw: unknown): number | { error: string } {
  if (raw === undefined) return 10;
  const n = Number(raw);
  if (!ALLOWED_PAGE_SIZES.includes(n as (typeof ALLOWED_PAGE_SIZES)[number])) {
    return { error: `"pageSize" must be one of ${ALLOWED_PAGE_SIZES.join(', ')}` };
  }
  return n;
}

export function parseLimit(raw: unknown, max: number): number | { error: string } {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > max) {
    return { error: `"limit" must be a number between 1 and ${max}` };
  }
  return Math.floor(n);
}

export function parsePage(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function queryString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseSortDir(raw: unknown): 'asc' | 'desc' {
  return raw === 'asc' ? 'asc' : 'desc';
}

export function parseSortBy<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}
