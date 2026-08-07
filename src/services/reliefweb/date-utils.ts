/**
 * @fileoverview Date-bound handling for ReliefWeb range filters — the accepted input
 * pattern, resolution of a caller's date to the single datetime form the API accepts,
 * and the current instant in that same shape.
 * @module services/reliefweb/date-utils
 */

/**
 * Accepted shapes for a date-range bound: a bare calendar date (`2026-07-01`) or a full
 * ISO 8601 datetime (`2026-07-01T00:00:00+00:00`, `2026-07-01T00:00:00Z`, any numeric
 * offset, optional fractional seconds). Used as the schema-level `pattern` on every date
 * parameter so a malformed value is named as such instead of travelling to ReliefWeb.
 */
export const DATE_BOUND_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Schema rejection message for a value that matches neither accepted date shape. */
export const DATE_BOUND_FORMAT_MESSAGE =
  'Expected a calendar date (2026-07-01) or a full ISO 8601 datetime (2026-07-01T00:00:00+00:00).';

const BARE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const OFFSET_SUFFIX_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * ReliefWeb accepts exactly one datetime shape on a range bound — `YYYY-MM-DDTHH:MM:SS`
 * followed by a zero UTC offset written `+00:00` or `+0000`. Every other ISO 8601 spelling
 * is answered with `Invalid range '<bound>' value for field '<field>'. It must be an ISO
 * 8601 date.`, including `Z`, fractional seconds, a missing seconds component, a missing
 * offset, and any non-zero offset. Callers are held to the wider pattern above and
 * converted here, so the natural spellings work instead of failing upstream.
 */
function utcOffsetForm(date: Date): string {
  return `${date.toISOString().slice(0, 19)}+00:00`;
}

/**
 * Resolves a caller-supplied range bound to the datetime form ReliefWeb requires.
 * A bare calendar date becomes start-of-day on a lower bound and end-of-day on an upper
 * bound, so an inclusive range covers both endpoints in full. A value carrying a time is
 * converted to UTC — a value with no offset is read as UTC, and sub-second precision is
 * dropped. Blank or whitespace-only resolves to `undefined` and is treated as omitted;
 * a value that matches the pattern but is not a real instant is passed through for
 * ReliefWeb to reject by name.
 *
 * Callers must use the resolved value for both the service call and the echoed
 * `appliedFilters`, so `structuredContent` and `content[]` report the query that ran.
 */
export function resolveDateBound(
  value: string | undefined,
  bound: 'from' | 'to',
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return;
  if (BARE_DATE_PATTERN.test(trimmed)) {
    return `${trimmed}T${bound === 'from' ? '00:00:00' : '23:59:59'}+00:00`;
  }
  const parsed = new Date(OFFSET_SUFFIX_PATTERN.test(trimmed) ? trimmed : `${trimmed}Z`);
  return Number.isNaN(parsed.getTime()) ? trimmed : utcOffsetForm(parsed);
}

/**
 * Current instant in the form ReliefWeb range filters accept. Built directly rather than
 * round-tripped through a tool's input schema, since it is a server-side bound applied
 * after input validation has run.
 */
export function currentDateBound(): string {
  return utcOffsetForm(new Date());
}
