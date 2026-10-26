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

/** A date bound whose supplied calendar or time components cannot represent an instant. */
export class InvalidDateBoundError extends Error {
  readonly value: string;

  constructor(value: string) {
    super('Invalid calendar date or time components.');
    this.name = 'InvalidDateBoundError';
    this.value = value;
  }
}

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
 * impossible calendar or time components throw InvalidDateBoundError before conversion.
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
  if (!DATE_BOUND_PATTERN.test(trimmed)) throw new InvalidDateBoundError(trimmed);
  const year = Number(trimmed.slice(0, 4));
  const month = Number(trimmed.slice(5, 7));
  const day = Number(trimmed.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new InvalidDateBoundError(trimmed);
  }
  if (BARE_DATE_PATTERN.test(trimmed)) {
    return `${trimmed}T${bound === 'from' ? '00:00:00' : '23:59:59'}+00:00`;
  }
  const hour = Number(trimmed.slice(11, 13));
  const minute = Number(trimmed.slice(14, 16));
  const second = trimmed[16] === ':' ? Number(trimmed.slice(17, 19)) : 0;
  const offsetIndex = Math.max(trimmed.indexOf('+', 16), trimmed.indexOf('-', 16));
  const timeEnd =
    offsetIndex >= 0 ? offsetIndex : trimmed.endsWith('Z') ? trimmed.length - 1 : trimmed.length;
  const fraction = trimmed[19] === '.' ? trimmed.slice(20, timeEnd) : '';
  const nonzeroFraction = fraction.replaceAll('0', '').length > 0;
  if (
    hour > 24 ||
    minute > 59 ||
    second > 59 ||
    (hour === 24 && (minute !== 0 || second !== 0 || nonzeroFraction))
  ) {
    throw new InvalidDateBoundError(trimmed);
  }
  if (offsetIndex >= 0) {
    const offset = trimmed.slice(offsetIndex + 1).replace(':', '');
    if (Number(offset.slice(0, 2)) > 23 || Number(offset.slice(2)) > 59) {
      throw new InvalidDateBoundError(trimmed);
    }
  }
  const parsed = new Date(OFFSET_SUFFIX_PATTERN.test(trimmed) ? trimmed : `${trimmed}Z`);
  if (Number.isNaN(parsed.getTime())) throw new InvalidDateBoundError(trimmed);
  return utcOffsetForm(parsed);
}

/**
 * Current instant in the form ReliefWeb range filters accept. Built directly rather than
 * round-tripped through a tool's input schema, since it is a server-side bound applied
 * after input validation has run.
 */
export function currentDateBound(): string {
  return utcOffsetForm(new Date());
}
