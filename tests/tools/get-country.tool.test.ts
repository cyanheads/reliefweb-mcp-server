/**
 * @fileoverview Tests for the reliefweb_get_country tool.
 * @module tests/tools/get-country.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebGetCountry } from '@/mcp-server/tools/definitions/get-country.tool.js';

const mockGetCountry = vi.fn();
const mockGetCountryArchive = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({
    getCountry: mockGetCountry,
    getCountryArchive: mockGetCountryArchive,
  }),
}));

/** A profile whose overview alone clears the 24KB outline budget. */
function oversizedCountry() {
  return {
    id: 10001,
    name: 'Syrian Arab Republic',
    iso3: 'SYR',
    status: 'current',
    urlAlias: 'https://reliefweb.int/country/syr',
    profileOverview: 'o'.repeat(40_000),
    keyContent: [{ title: 'Syria Response', url: 'https://reliefweb.int/key' }],
  };
}

/** An archive at SYR's real key_content depth — thousands of entries, each identifiable by index. */
function archivedEntries(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    title: `Archived ${i}`,
    url: `https://reliefweb.int/archive/${i}`,
  }));
}

function countryArchive(count: number) {
  return {
    id: 10001,
    name: 'Syrian Arab Republic',
    iso3: 'SYR',
    urlAlias: 'https://reliefweb.int/country/syr',
    entries: archivedEntries(count),
  };
}

function textOf(blocks: ReturnType<NonNullable<typeof reliefwebGetCountry.format>>): string {
  return blocks.map((b) => (b as { text?: string }).text ?? '').join('\n');
}

describe('reliefwebGetCountry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns country profile on success', async () => {
    const country = {
      id: 10001,
      name: 'Syrian Arab Republic',
      iso3: 'SYR',
      status: 'current',
      urlAlias: 'https://reliefweb.int/country/syr',
      profileOverview: 'Overview of the Syria crisis.',
      keyContent: [{ title: 'Syria Response', url: 'https://reliefweb.int/key' }],
      appealsResponsePlans: [
        { title: 'Humanitarian Response', url: 'https://reliefweb.int/appeal', date: '2024-01-01' },
      ],
      usefulLinks: [{ title: 'OCHA Syria', url: 'https://www.unocha.org/syria' }],
    };
    mockGetCountry.mockResolvedValue(country);

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'SYR' });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(result).toMatchObject({
      kind: 'full',
      id: 10001,
      name: 'Syrian Arab Republic',
      iso3: 'SYR',
    });
    expect(result.sections).toBeUndefined();
    expect(result.archive).toBeUndefined();
  });

  it('surfaces the active-scoped profile links the service returns (active/archive selection lives in the service)', async () => {
    const country = {
      id: 10001,
      name: 'Syrian Arab Republic',
      iso3: 'SYR',
      keyContent: [
        { title: 'Active Key 1', url: 'https://reliefweb.int/k1' },
        { title: 'Active Key 2', url: 'https://reliefweb.int/k2' },
      ],
      appealsResponsePlans: [
        { title: 'HRP 2024', url: 'https://reliefweb.int/hrp', date: '2024-01-01' },
      ],
      usefulLinks: [{ title: 'OCHA Syria', url: 'https://ocha.org/syria' }],
    };
    mockGetCountry.mockResolvedValue(country);

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'SYR' });
    const result = await reliefwebGetCountry.handler(input, ctx);

    // Tool passes the service's active-only payload through unchanged — no re-expansion, no capping.
    expect(result.keyContent).toEqual(country.keyContent);
    expect(result.appealsResponsePlans).toEqual(country.appealsResponsePlans);
    expect(result.usefulLinks).toEqual(country.usefulLinks);
  });

  it('normalizes ISO3 code to uppercase before lookup', async () => {
    mockGetCountry.mockResolvedValue({ id: 10001, name: 'Syrian Arab Republic', iso3: 'SYR' });

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'syr' });
    await reliefwebGetCountry.handler(input, ctx);

    expect(mockGetCountry).toHaveBeenCalledWith('SYR', ctx);
  });

  it('throws not_found when country does not exist', async () => {
    mockGetCountry.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'ZZZ' });

    await expect(reliefwebGetCountry.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('handles sparse country without profile data', async () => {
    const country = { id: 999, name: 'Minimal Country' };
    mockGetCountry.mockResolvedValue(country);

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'MIN' });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(result.id).toBe(999);
    expect(result.kind).toBe('full');
    expect(result.keyContent).toBeUndefined();
    expect(result.appealsResponsePlans).toBeUndefined();
  });

  // ─── Outline on overflow ───────────────────────────────────────────────────

  it('outlines every section with its real byte size when the profile is over budget', async () => {
    const country = oversizedCountry();
    mockGetCountry.mockResolvedValue(country);

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'SYR' });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(result.kind).toBe('outline');
    expect(result.profileOverview).toBeUndefined();

    const names = result.sections?.map((s) => s.name);
    expect(names?.slice().sort()).toEqual(Object.keys(country).sort());
    expect(names?.[0]).toBe('profileOverview');
    for (const section of result.sections ?? []) {
      const value = country[section.name as keyof typeof country];
      expect(section.bytes).toBe(JSON.stringify(value).length);
    }
    expect(result.outlineNotice).toMatch(/sections:\[\.\.\.\]/);
  });

  it('returns exactly the sections asked for plus identity metadata, untruncated', async () => {
    mockGetCountry.mockResolvedValue(oversizedCountry());

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'SYR', sections: ['profileOverview'] });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(Object.keys(result).sort()).toEqual(
      ['id', 'iso3', 'kind', 'name', 'profileOverview', 'urlAlias'].sort(),
    );
    expect(result.profileOverview).toHaveLength(40_000);
    expect(result.keyContent).toBeUndefined();
  });

  // ─── Archive retrieval ─────────────────────────────────────────────────────

  it('returns the first archive page with the real total and the next offset', async () => {
    mockGetCountryArchive.mockResolvedValue(countryArchive(2317));

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({
      iso3: 'SYR',
      archive: { list: 'keyContent' },
    });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(mockGetCountryArchive).toHaveBeenCalledWith('SYR', 'keyContent', ctx);
    expect(result.kind).toBe('archive');
    expect(result.archive).toMatchObject({
      list: 'keyContent',
      total: 2317,
      shown: 25,
      offset: 0,
      nextOffset: 25,
    });
    expect(result.archive?.entries).toHaveLength(25);
    expect(result.archive?.entries[0]?.title).toBe('Archived 0');
    expect(result.archive?.entries.at(-1)?.title).toBe('Archived 24');
    // Identity travels with the page so it is attributable to its record.
    expect(result).toMatchObject({ id: 10001, iso3: 'SYR', name: 'Syrian Arab Republic' });
  });

  it('advances to the entries at a middle offset and hands back the offset after them', async () => {
    mockGetCountryArchive.mockResolvedValue(countryArchive(2317));

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({
      iso3: 'SYR',
      archive: { list: 'keyContent', offset: 1000, limit: 10 },
    });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(result.archive?.offset).toBe(1000);
    expect(result.archive?.shown).toBe(10);
    expect(result.archive?.nextOffset).toBe(1010);
    expect(result.archive?.entries.map((e) => e.title)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Archived ${1000 + i}`),
    );
  });

  it('reports no next offset on the last page and returns the short remainder', async () => {
    mockGetCountryArchive.mockResolvedValue(countryArchive(2317));

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({
      iso3: 'SYR',
      archive: { list: 'keyContent', offset: 2310, limit: 25 },
    });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(result.archive?.shown).toBe(7);
    expect(result.archive?.total).toBe(2317);
    expect(result.archive?.nextOffset).toBeUndefined();
    expect(result.archive?.entries.at(-1)?.title).toBe('Archived 2316');
  });

  it('walks the whole archive with the offsets it hands back, without repeats or gaps', async () => {
    mockGetCountryArchive.mockResolvedValue(countryArchive(57));

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const seen: string[] = [];
    let offset: number | undefined = 0;
    let pages = 0;

    while (offset !== undefined) {
      const input = reliefwebGetCountry.input.parse({
        iso3: 'SYR',
        archive: { list: 'keyContent', offset, limit: 20 },
      });
      const result = await reliefwebGetCountry.handler(input, ctx);
      seen.push(...(result.archive?.entries.map((e) => e.title) ?? []));
      offset = result.archive?.nextOffset;
      pages += 1;
      expect(pages).toBeLessThan(10); // paging must terminate, not spin
    }

    expect(pages).toBe(3);
    expect(seen).toEqual(archivedEntries(57).map((e) => e.title));
  });

  it('returns an honest empty page for a list with no archived entries', async () => {
    mockGetCountryArchive.mockResolvedValue(countryArchive(0));

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({
      iso3: 'SYR',
      archive: { list: 'usefulLinks' },
    });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(result.archive).toMatchObject({ list: 'usefulLinks', total: 0, shown: 0, offset: 0 });
    expect(result.archive?.entries).toEqual([]);
    expect(result.archive?.nextOffset).toBeUndefined();
  });

  it('returns an empty page carrying the true total when the offset is past the end', async () => {
    mockGetCountryArchive.mockResolvedValue(countryArchive(2317));

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({
      iso3: 'SYR',
      archive: { list: 'keyContent', offset: 5000 },
    });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(result.archive?.total).toBe(2317);
    expect(result.archive?.shown).toBe(0);
    expect(result.archive?.nextOffset).toBeUndefined();
  });

  it('answers an archive call with the page even when the profile itself is over budget', async () => {
    // The same profile that outlines on a plain call, so the branch is a real contest.
    mockGetCountry.mockResolvedValue(oversizedCountry());
    mockGetCountryArchive.mockResolvedValue(countryArchive(2328));

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const plain = await reliefwebGetCountry.handler(
      reliefwebGetCountry.input.parse({ iso3: 'SYR' }),
      ctx,
    );
    expect(plain.kind).toBe('outline');

    const input = reliefwebGetCountry.input.parse({
      iso3: 'SYR',
      archive: { list: 'keyContent' },
    });
    const result = await reliefwebGetCountry.handler(input, ctx);

    // The profile fetch — the only path that can outline — is not taken again in archive mode.
    expect(mockGetCountry).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('archive');
    expect(result.sections).toBeUndefined();
    expect(result.outlineNotice).toBeUndefined();
    expect(result.profileOverview).toBeUndefined();
  });

  it('reads the whole profile when sections is an empty array rather than slicing to nothing', async () => {
    mockGetCountry.mockResolvedValue(oversizedCountry());

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'SYR', sections: [] });
    const result = await reliefwebGetCountry.handler(input, ctx);

    // An empty selection names nothing, so it is not a selection — the record resolves normally.
    expect(result.kind).toBe('outline');
    expect(result.sections?.length).toBeGreaterThan(1);
  });

  it('lets archive win over an empty sections array instead of calling it a conflict', async () => {
    mockGetCountryArchive.mockResolvedValue(countryArchive(40));

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({
      iso3: 'SYR',
      sections: [],
      archive: { list: 'keyContent' },
    });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(result.kind).toBe('archive');
    expect(result.archive?.total).toBe(40);
  });

  it('rejects a call that supplies both selectors instead of silently dropping one', async () => {
    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({
      iso3: 'SYR',
      sections: ['profileOverview'],
      archive: { list: 'keyContent' },
    });

    await expect(reliefwebGetCountry.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'selector_conflict' },
    });
    expect(mockGetCountry).not.toHaveBeenCalled();
    expect(mockGetCountryArchive).not.toHaveBeenCalled();
  });

  it('throws not_found in archive mode when the country does not exist', async () => {
    mockGetCountryArchive.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({
      iso3: 'ZZZ',
      archive: { list: 'keyContent' },
    });

    await expect(reliefwebGetCountry.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('rejects an archive limit above the page cap at the schema', () => {
    expect(() =>
      reliefwebGetCountry.input.parse({ iso3: 'SYR', archive: { list: 'keyContent', limit: 500 } }),
    ).toThrow();
  });

  // ─── format() parity ───────────────────────────────────────────────────────

  it('formats output including id, iso3, and profile sections', () => {
    const output = {
      kind: 'full' as const,
      id: 10001,
      name: 'Syrian Arab Republic',
      iso3: 'SYR',
      status: 'current',
      urlAlias: 'https://reliefweb.int/country/syr',
      profileOverview: 'Syria crisis overview.',
      keyContent: [{ title: 'Key Report', url: 'https://reliefweb.int/key' }],
      appealsResponsePlans: [
        { title: 'HRP 2024', url: 'https://reliefweb.int/hrp', date: '2024-01-01' },
      ],
      usefulLinks: [{ title: 'OCHA', url: 'https://ocha.org' }],
    };
    const text = textOf(reliefwebGetCountry.format!(output));
    expect(text).toContain('10001');
    expect(text).toContain('Syrian Arab Republic');
    expect(text).toContain('SYR');
    expect(text).toContain('Syria crisis overview.');
    expect(text).toContain('Key Report');
    expect(text).toContain('HRP 2024');
    expect(text).toContain('OCHA');
    expect(text).toContain('**Mode:** full');
  });

  it('renders every outline field into content[] so it matches structuredContent', () => {
    const output = {
      kind: 'outline' as const,
      sections: [
        { name: 'profileOverview', bytes: 40_002 },
        { name: 'keyContent', bytes: 74 },
      ],
      outlineNotice: 'Re-call with sections:[...] — e.g. profileOverview, keyContent.',
    };
    const text = textOf(reliefwebGetCountry.format!(output));
    expect(text).toContain('**Mode:** outline');
    expect(text).toContain('profileOverview');
    expect(text).toContain('40002');
    expect(text).toContain(output.outlineNotice);
  });

  it('renders every archive page field into content[] so it matches structuredContent', () => {
    const output = {
      kind: 'archive' as const,
      id: 10001,
      name: 'Syrian Arab Republic',
      iso3: 'SYR',
      archive: {
        list: 'appealsResponsePlans' as const,
        total: 120,
        shown: 2,
        offset: 40,
        nextOffset: 42,
        entries: [
          { title: 'HRP 2019', url: 'https://reliefweb.int/hrp-2019', date: '2019-01-15' },
          { title: 'HRP 2018', url: 'https://reliefweb.int/hrp-2018' },
        ],
      },
    };
    const text = textOf(reliefwebGetCountry.format!(output));
    expect(text).toContain('**Mode:** archive');
    expect(text).toContain('appealsResponsePlans');
    expect(text).toContain('120');
    expect(text).toContain('40');
    expect(text).toContain('42');
    expect(text).toContain('HRP 2019');
    expect(text).toContain('https://reliefweb.int/hrp-2019');
    expect(text).toContain('2019-01-15');
    expect(text).toContain('HRP 2018');
  });

  it('distinguishes a list with no archive from an offset past the end of one', () => {
    const noArchive = {
      kind: 'archive' as const,
      id: 10001,
      name: 'Syrian Arab Republic',
      archive: {
        list: 'usefulLinks' as const,
        total: 0,
        shown: 0,
        offset: 0,
        entries: [],
      },
    };
    expect(textOf(reliefwebGetCountry.format!(noArchive))).toContain(
      'This list has no archived entries.',
    );

    const pastEnd = {
      ...noArchive,
      archive: { ...noArchive.archive, list: 'keyContent' as const, total: 2328, offset: 5000 },
    };
    const text = textOf(reliefwebGetCountry.format!(pastEnd));
    // Names where real data actually ends, rather than reading as an empty archive.
    expect(text).toContain('the archive holds 2328');
    expect(text).toContain('offset 2327');
  });

  it('says the archive ended rather than leaving the last page silent about it', () => {
    const output = {
      kind: 'archive' as const,
      id: 10001,
      name: 'Syrian Arab Republic',
      archive: {
        list: 'keyContent' as const,
        total: 3,
        shown: 1,
        offset: 2,
        entries: [{ title: 'Last One', url: 'https://reliefweb.int/last' }],
      },
    };
    const text = textOf(reliefwebGetCountry.format!(output));
    expect(text).toContain('**Next offset:** none');
    expect(text).toContain('Last One');
  });
});
