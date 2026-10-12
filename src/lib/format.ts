/**
 * Formatting helpers shared by the shell and studio surfaces.
 * All output is deterministic given an explicit locale, so tests never depend on the runtime locale.
 */

const DEFAULT_LOCALE = 'en-GB';

export function formatDate(value: string | Date, locale = DEFAULT_LOCALE): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | Date, locale = DEFAULT_LOCALE): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** "3 minutes ago", "yesterday", "12 Mar 2026" — short and unambiguous. */
export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return 'unknown';
  const deltaMs = now.getTime() - date.getTime();
  const seconds = Math.round(deltaMs / 1000);

  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(date);
}

export function formatBytes(bytes: number, locale = DEFAULT_LOCALE): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unitIndex] ?? 'KB'}`;
}

/** "2.1 MP" style labels are produced by geometry helpers; this handles plain counts. */
export function formatCount(value: number, locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/** Turns "Design Studio" into "design-studio" for anchors and filenames. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
}

/** Truncates on a word boundary where possible. */
export function truncate(value: string, max = 120): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
