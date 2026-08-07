/**
 * @fileoverview Tests for the shared date-bound helpers — bare-date resolution, full
 * datetime passthrough, and the accepted-format pattern the tool schemas enforce.
 * @module tests/services/date-utils.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentDateBound,
  DATE_BOUND_PATTERN,
  resolveDateBound,
} from '@/services/reliefweb/date-utils.js';

describe('resolveDateBound', () => {
  it('resolves a bare calendar date to start of day on a lower bound', () => {
    expect(resolveDateBound('2026-07-01', 'from')).toBe('2026-07-01T00:00:00+00:00');
  });

  it('resolves a bare calendar date to end of day on an upper bound', () => {
    expect(resolveDateBound('2026-07-31', 'to')).toBe('2026-07-31T23:59:59+00:00');
  });

  it('leaves a datetime already in the accepted UTC form byte-identical on both bounds', () => {
    const value = '2026-07-01T09:30:00+00:00';
    expect(resolveDateBound(value, 'from')).toBe(value);
    expect(resolveDateBound(value, 'to')).toBe(value);
  });

  /**
   * ReliefWeb accepts only `YYYY-MM-DDTHH:MM:SS` with a zero offset written `+00:00` or
   * `+0000`; every other ISO 8601 spelling below comes back as
   * `Invalid range 'from' value for field '<field>'. It must be an ISO 8601 date.`
   * Resolution rewrites them rather than letting them fail upstream.
   */
  it.each([
    ['Z suffix', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00+00:00'],
    ['fractional seconds', '2026-07-01T00:00:00.500Z', '2026-07-01T00:00:00+00:00'],
    ['positive offset', '2026-07-01T09:30:00+02:00', '2026-07-01T07:30:00+00:00'],
    ['negative offset', '2026-07-01T00:00:00-05:00', '2026-07-01T05:00:00+00:00'],
    ['compact offset', '2026-07-01T00:00:00+0000', '2026-07-01T00:00:00+00:00'],
    ['no seconds', '2026-07-01T06:15', '2026-07-01T06:15:00+00:00'],
    ['no offset, read as UTC', '2026-07-01T06:15:00', '2026-07-01T06:15:00+00:00'],
  ])('rewrites a datetime with %s to the accepted form', (_label, input, expected) => {
    expect(resolveDateBound(input, 'from')).toBe(expected);
  });

  it('passes a pattern-shaped value that is not a real instant through for ReliefWeb to name', () => {
    expect(resolveDateBound('2026-13-45T99:99:99Z', 'from')).toBe('2026-13-45T99:99:99Z');
  });

  it('trims surrounding whitespace before resolving', () => {
    expect(resolveDateBound('  2026-07-01  ', 'from')).toBe('2026-07-01T00:00:00+00:00');
  });

  it('treats undefined, empty, and whitespace-only values as omitted', () => {
    expect(resolveDateBound(undefined, 'from')).toBeUndefined();
    expect(resolveDateBound('', 'from')).toBeUndefined();
    expect(resolveDateBound('   ', 'to')).toBeUndefined();
  });
});

describe('DATE_BOUND_PATTERN', () => {
  it.each([
    '2026-07-01',
    '2026-07-01T00:00:00+00:00',
    '2026-07-01T00:00:00Z',
    '2026-07-01T00:00',
    '2026-07-01T00:00:00.123Z',
    '2026-07-01T00:00:00-0500',
  ])('accepts %s', (value) => {
    expect(DATE_BOUND_PATTERN.test(value)).toBe(true);
  });

  it.each([
    'last week',
    '07/01/2026',
    '2026-07-01 00:00:00',
    "'; DROP TABLE reports; --",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: injection-test payload; must stay a literal string
    '${process.env.SECRET_KEY}',
    '',
  ])('rejects %s', (value) => {
    expect(DATE_BOUND_PATTERN.test(value)).toBe(false);
  });
});

describe('currentDateBound', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the current instant as a UTC ISO 8601 datetime without milliseconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T12:34:56.789Z'));

    expect(currentDateBound()).toBe('2026-08-06T12:34:56+00:00');
  });

  it('produces the one datetime shape ReliefWeb accepts on a range bound', () => {
    expect(currentDateBound()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
    expect(DATE_BOUND_PATTERN.test(currentDateBound())).toBe(true);
  });
});
