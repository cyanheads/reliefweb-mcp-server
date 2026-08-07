/**
 * @fileoverview Tests for the shared pagination arithmetic and empty-page notice.
 * @module tests/tools/pagination.test
 */

import { describe, expect, it } from 'vitest';
import { lastPageOffset, pagedPastEndNotice } from '@/mcp-server/tools/pagination.js';

describe('lastPageOffset', () => {
  it.each([
    ['result set smaller than one page', 5, 10, 0],
    ['result set exactly one page', 10, 10, 0],
    ['one record into the second page', 11, 10, 10],
    ['result set an exact multiple of the page size', 100, 10, 90],
    ['one short of an exact multiple', 99, 10, 90],
    ['limit of 1', 1779, 1, 1778],
    ['the TUV reports case', 1779, 2, 1778],
    ['empty result set', 0, 10, 0],
  ])('%s: totalCount=%i limit=%i -> %i', (_label, totalCount, limit, expected) => {
    expect(lastPageOffset(totalCount, limit)).toBe(expected);
  });

  it('always returns an offset the same limit can actually page to', () => {
    for (const totalCount of [1, 2, 7, 10, 33, 248, 1779]) {
      for (const limit of [1, 2, 10, 100, 1000]) {
        const offset = lastPageOffset(totalCount, limit);
        expect(offset % limit).toBe(0);
        expect(offset).toBeLessThan(Math.max(totalCount, 1));
      }
    }
  });
});

describe('pagedPastEndNotice', () => {
  it('names the supplied offset, the match count, and the reachable offset', () => {
    expect(
      pagedPastEndNotice({ subject: 'reports', offset: 99999, totalCount: 1779, limit: 2 }),
    ).toBe(
      'Offset 99999 is past the end of this result set — 1779 reports matched, ' +
        'so the last page starts at offset 1778. ' +
        'The filters are fine; re-run with an offset inside that range.',
    );
  });

  it('does not tell the caller their filters are wrong', () => {
    const notice = pagedPastEndNotice({
      subject: 'countries',
      offset: 5000,
      totalCount: 248,
      limit: 100,
    });

    expect(notice).toContain('248 countries matched');
    expect(notice).not.toMatch(/no (countries|results|matches)/i);
    expect(notice).not.toMatch(/broaden|remove (the )?filter/i);
  });
});
