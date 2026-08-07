/**
 * @fileoverview Tests for the reliefweb_get_disaster tool.
 * @module tests/tools/get-disaster.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebGetDisaster } from '@/mcp-server/tools/definitions/get-disaster.tool.js';

const mockGetDisaster = vi.fn();
const mockGetDisasterArchive = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({
    getDisaster: mockGetDisaster,
    getDisasterArchive: mockGetDisasterArchive,
  }),
}));

/** A disaster archive whose entries are identifiable by index. */
function disasterArchive(count: number) {
  return {
    id: 51470,
    name: 'Major Disaster',
    urlAlias: 'https://reliefweb.int/disaster/major',
    entries: Array.from({ length: count }, (_, i) => ({
      title: `Archived ${i}`,
      url: `https://reliefweb.int/archive/${i}`,
    })),
  };
}

/** The shape of disaster 51470: two prose sections that together blow the outline budget. */
function oversizedDisaster() {
  return {
    id: 51470,
    name: 'Major Disaster',
    status: 'ongoing',
    urlAlias: 'https://reliefweb.int/disaster/major',
    description: 'd'.repeat(36_849),
    profileOverview: 'o'.repeat(32_389),
    keyContent: [{ title: 'Key Update', url: 'https://reliefweb.int/key' }],
  };
}

function textOf(blocks: ReturnType<NonNullable<typeof reliefwebGetDisaster.format>>): string {
  return blocks.map((b) => (b as { text?: string }).text ?? '').join('\n');
}

describe('reliefwebGetDisaster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full disaster detail on success', async () => {
    const disaster = {
      id: 55555,
      name: 'Turkey: Earthquake 2023',
      status: 'past',
      glide: 'EQ-2023-000053-TUR',
      dateEvent: '2023-02-06T00:00:00+00:00',
      dateCreated: '2023-02-06T12:00:00+00:00',
      primaryCountry: 'Turkey',
      countries: ['Turkey', 'Syrian Arab Republic'],
      types: ['Earthquake'],
      primaryType: 'Earthquake',
      urlAlias: 'https://reliefweb.int/disaster/eq-2023-000053-tur',
      description: 'Magnitude 7.8 earthquake struck southern Turkey.',
      profileOverview: 'Overview text from OCHA editors.',
      keyContent: [{ title: 'Key Update', url: 'https://reliefweb.int/key' }],
      appealsResponsePlans: [
        {
          title: 'FLASH APPEAL Turkey 2023',
          url: 'https://reliefweb.int/appeal',
          date: '2023-02-20',
        },
      ],
      usefulLinks: [{ title: 'UNHCR Response', url: 'https://unhcr.org/turkey' }],
    };
    mockGetDisaster.mockResolvedValue(disaster);

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({ id: 55555 });
    const result = await reliefwebGetDisaster.handler(input, ctx);

    expect(result).toMatchObject({ kind: 'full', id: 55555, name: 'Turkey: Earthquake 2023' });
    expect(result.keyContent).toHaveLength(1);
    expect(result.appealsResponsePlans).toHaveLength(1);
    expect(result.sections).toBeUndefined();
  });

  it('surfaces the active-scoped profile links the service returns (active/archive selection lives in the service)', async () => {
    const disaster = {
      id: 55555,
      name: 'Turkey: Earthquake 2023',
      keyContent: [{ title: 'Active Key', url: 'https://reliefweb.int/key' }],
      appealsResponsePlans: [
        { title: 'Flash Appeal 2023', url: 'https://reliefweb.int/appeal', date: '2023-02-20' },
      ],
      usefulLinks: [{ title: 'UNHCR Response', url: 'https://unhcr.org/turkey' }],
    };
    mockGetDisaster.mockResolvedValue(disaster);

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({ id: 55555 });
    const result = await reliefwebGetDisaster.handler(input, ctx);

    expect(result.keyContent).toEqual(disaster.keyContent);
    expect(result.appealsResponsePlans).toEqual(disaster.appealsResponsePlans);
    expect(result.usefulLinks).toEqual(disaster.usefulLinks);
  });

  it('outlines every section with its real byte size when the record is over budget', async () => {
    const disaster = oversizedDisaster();
    mockGetDisaster.mockResolvedValue(disaster);

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({ id: 51470 });
    const result = await reliefwebGetDisaster.handler(input, ctx);

    expect(result.kind).toBe('outline');
    expect(result.description).toBeUndefined();
    expect(result.profileOverview).toBeUndefined();

    const names = result.sections?.map((s) => s.name);
    expect(names?.slice().sort()).toEqual(Object.keys(disaster).sort());
    expect(names?.slice(0, 2)).toEqual(['description', 'profileOverview']);
    for (const section of result.sections ?? []) {
      const value = disaster[section.name as keyof typeof disaster];
      expect(section.bytes).toBe(JSON.stringify(value).length);
    }
    expect(result.outlineNotice).toMatch(/sections:\[\.\.\.\]/);
  });

  it('returns exactly the sections asked for plus identity metadata', async () => {
    mockGetDisaster.mockResolvedValue(oversizedDisaster());

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({ id: 51470, sections: ['profileOverview'] });
    const result = await reliefwebGetDisaster.handler(input, ctx);

    expect(Object.keys(result).sort()).toEqual(
      ['id', 'kind', 'name', 'profileOverview', 'urlAlias'].sort(),
    );
    expect(result.profileOverview).toHaveLength(32_389);
    expect(result.description).toBeUndefined();
  });

  it('returns prose intact and untruncated when a section is selected', async () => {
    mockGetDisaster.mockResolvedValue(oversizedDisaster());

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({ id: 51470, sections: ['description'] });
    const result = await reliefwebGetDisaster.handler(input, ctx);

    expect(result.description).toHaveLength(36_849);
  });

  it('throws not_found when disaster does not exist', async () => {
    mockGetDisaster.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({ id: 9999999 });

    await expect(reliefwebGetDisaster.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('handles sparse disaster without profile data', async () => {
    const disaster = { id: 1, name: 'Minimal Disaster', status: 'past' };
    mockGetDisaster.mockResolvedValue(disaster);

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({ id: 1 });
    const result = await reliefwebGetDisaster.handler(input, ctx);

    expect(result.id).toBe(1);
    expect(result.kind).toBe('full');
    expect(result.keyContent).toBeUndefined();
    expect(result.appealsResponsePlans).toBeUndefined();
    expect(result.dateCreated).toBeUndefined();
  });

  it('formats output including dateCreated, types, and profile sections', () => {
    const output = {
      kind: 'full' as const,
      id: 55555,
      name: 'Turkey Earthquake 2023',
      status: 'past',
      glide: 'EQ-2023-000053-TUR',
      primaryType: 'Earthquake',
      types: ['Earthquake', 'Cold Wave'],
      dateEvent: '2023-02-06T00:00:00+00:00',
      dateCreated: '2023-02-06T12:00:00+00:00',
      primaryCountry: 'Turkey',
      countries: ['Turkey'],
      urlAlias: 'https://reliefweb.int/disaster/test',
      description: 'Major earthquake.',
      profileOverview: 'Overview text.',
      keyContent: [{ title: 'Key Update', url: 'https://reliefweb.int/key' }],
      appealsResponsePlans: [{ title: 'Flash Appeal', url: 'https://reliefweb.int/appeal' }],
      usefulLinks: [{ title: 'OCHA', url: 'https://ocha.org' }],
    };
    const text = textOf(reliefwebGetDisaster.format!(output));
    expect(text).toContain('55555');
    expect(text).toContain('Turkey Earthquake 2023');
    expect(text).toContain('EQ-2023-000053-TUR');
    expect(text).toContain('Earthquake');
    expect(text).toContain('Cold Wave');
    expect(text).toContain('2023-02-06T12:00:00');
    expect(text).toContain('Major earthquake.');
    expect(text).toContain('Key Update');
    expect(text).toContain('Flash Appeal');
    expect(text).toContain('OCHA');
    expect(text).toContain('**Mode:** full');
  });

  // ─── Archive retrieval ─────────────────────────────────────────────────────

  it('pages the archived entries of the named list with real totals and a next offset', async () => {
    mockGetDisasterArchive.mockResolvedValue(disasterArchive(130));

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({
      id: 51470,
      archive: { list: 'appealsResponsePlans', offset: 100, limit: 25 },
    });
    const result = await reliefwebGetDisaster.handler(input, ctx);

    expect(mockGetDisasterArchive).toHaveBeenCalledWith(51470, 'appealsResponsePlans', ctx);
    expect(result.kind).toBe('archive');
    expect(result.archive).toMatchObject({
      list: 'appealsResponsePlans',
      total: 130,
      shown: 25,
      offset: 100,
      nextOffset: 125,
    });
    expect(result.archive?.entries[0]?.title).toBe('Archived 100');
    expect(result).toMatchObject({ id: 51470, name: 'Major Disaster' });
  });

  it('reports no next offset once the page reaches the end of the archive', async () => {
    mockGetDisasterArchive.mockResolvedValue(disasterArchive(130));

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({
      id: 51470,
      archive: { list: 'appealsResponsePlans', offset: 125, limit: 25 },
    });
    const result = await reliefwebGetDisaster.handler(input, ctx);

    expect(result.archive?.shown).toBe(5);
    expect(result.archive?.nextOffset).toBeUndefined();
    expect(result.archive?.entries.at(-1)?.title).toBe('Archived 129');
  });

  it('answers an archive call with the page even for a record that is over the outline budget', async () => {
    // The same record that outlines on a plain call, so the branch is a real contest.
    mockGetDisaster.mockResolvedValue(oversizedDisaster());
    mockGetDisasterArchive.mockResolvedValue(disasterArchive(2328));

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const plain = await reliefwebGetDisaster.handler(
      reliefwebGetDisaster.input.parse({ id: 51470 }),
      ctx,
    );
    expect(plain.kind).toBe('outline');

    const input = reliefwebGetDisaster.input.parse({
      id: 51470,
      archive: { list: 'keyContent' },
    });
    const result = await reliefwebGetDisaster.handler(input, ctx);

    // The record fetch — the only path that can outline — is not taken again in archive mode.
    expect(mockGetDisaster).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('archive');
    expect(result.sections).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.archive?.shown).toBe(25);
  });

  it('rejects a call that supplies both selectors instead of silently dropping one', async () => {
    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({
      id: 51470,
      sections: ['description'],
      archive: { list: 'keyContent' },
    });

    await expect(reliefwebGetDisaster.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'selector_conflict' },
    });
    expect(mockGetDisaster).not.toHaveBeenCalled();
    expect(mockGetDisasterArchive).not.toHaveBeenCalled();
  });

  it('throws not_found in archive mode when the disaster does not exist', async () => {
    mockGetDisasterArchive.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({
      id: 9999999,
      archive: { list: 'keyContent' },
    });

    await expect(reliefwebGetDisaster.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('renders every archive page field into content[] so it matches structuredContent', () => {
    const output = {
      kind: 'archive' as const,
      id: 51470,
      name: 'Major Disaster',
      archive: {
        list: 'usefulLinks' as const,
        total: 88,
        shown: 2,
        offset: 10,
        nextOffset: 12,
        entries: [
          { title: 'Sitrep Archive', url: 'https://reliefweb.int/sitreps' },
          { title: 'Appeal 2019', url: 'https://reliefweb.int/appeal-2019', date: '2019-03-01' },
        ],
      },
    };
    const text = textOf(reliefwebGetDisaster.format!(output));
    expect(text).toContain('**Mode:** archive');
    expect(text).toContain('usefulLinks');
    expect(text).toContain('88');
    expect(text).toContain('12');
    expect(text).toContain('Sitrep Archive');
    expect(text).toContain('https://reliefweb.int/sitreps');
    expect(text).toContain('Appeal 2019');
    expect(text).toContain('2019-03-01');
  });

  it('renders every outline field into content[] so it matches structuredContent', () => {
    const output = {
      kind: 'outline' as const,
      sections: [
        { name: 'description', bytes: 36_851 },
        { name: 'profileOverview', bytes: 32_391 },
      ],
      outlineNotice: 'Re-call with sections:[...] — e.g. description, profileOverview.',
    };
    const text = textOf(reliefwebGetDisaster.format!(output));
    expect(text).toContain('**Mode:** outline');
    expect(text).toContain('description');
    expect(text).toContain('36851');
    expect(text).toContain('profileOverview');
    expect(text).toContain('32391');
    expect(text).toContain(output.outlineNotice);
  });
});
