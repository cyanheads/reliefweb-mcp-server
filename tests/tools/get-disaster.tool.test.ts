/**
 * @fileoverview Tests for the reliefweb_get_disaster tool.
 * @module tests/tools/get-disaster.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { DEFAULT_OUTLINE_BUDGET_BYTES } from '@cyanheads/mcp-ts-core/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebGetDisaster } from '@/mcp-server/tools/definitions/get-disaster.tool.js';
import { contractError } from '../helpers/contract-error.js';

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

describe('archived disaster tool through the real service', () => {
  beforeEach(async () => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    const { ReliefWebService } = await vi.importActual<
      typeof import('@/services/reliefweb/reliefweb-service.js')
    >('@/services/reliefweb/reliefweb-service.js');
    const service = new ReliefWebService({} as never, createInMemoryStorage());
    mockGetDisaster.mockImplementation(service.getDisaster.bind(service));
    mockGetDisasterArchive.mockImplementation(service.getDisasterArchive.bind(service));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request) => {
      const url = new URL(String(request));
      if (
        (!url.pathname.endsWith('/disasters/52675') &&
          !url.pathname.endsWith('/disasters/51470')) ||
        url.searchParams.get('preset') !== 'analysis'
      )
        return new Response('{}', { status: 404 });
      return Response.json({
        data: [
          {
            id: url.pathname.endsWith('/52675') ? 52675 : 51470,
            fields: {
              name: 'Archived alert',
              status: url.pathname.endsWith('/52675') ? 'alert-archive' : 'ongoing',
              description: 'Archived description',
              profile: {
                key_content: {
                  active: [{ title: 'Current link', url: 'https://example.org/current' }],
                  archive: [
                    { title: 'Archived first', url: 'https://example.org/first' },
                    { title: 'Archived second', url: 'https://example.org/second' },
                  ],
                },
              },
            },
          },
        ],
      });
    });
  });
  afterEach(() => {
    mockGetDisaster.mockReset();
    mockGetDisasterArchive.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('resolves archived full and section calls without including curated archives', async () => {
    for (const sections of [undefined, ['description']]) {
      const result = await runToolContract(reliefwebGetDisaster, {
        id: 52675,
        ...(sections ? { sections } : {}),
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        id: 52675,
        kind: 'full',
        description: 'Archived description',
      });
      expect(JSON.stringify(result.content)).toContain('Archived description');
      expect(JSON.stringify(result)).not.toContain('Archived first');
      if (sections) expect(result.structuredContent).not.toHaveProperty('keyContent');
      else
        expect(result.structuredContent).toMatchObject({
          status: 'alert-archive',
          keyContent: [{ title: 'Current link' }],
        });
    }
  });

  it('keeps ongoing disaster detail reachable with the same analysis request', async () => {
    const result = await runToolContract(reliefwebGetDisaster, { id: 51470 });
    expect(result.structuredContent).toMatchObject({
      id: 51470,
      status: 'ongoing',
      description: 'Archived description',
    });
    expect(JSON.stringify(result.content)).toContain('ongoing');
  });

  it('pages the normalized archived list through second, last, and past-end pages', async () => {
    for (const offset of [0, 1, 2]) {
      const result = await runToolContract(reliefwebGetDisaster, {
        id: 52675,
        archive: { list: 'keyContent', offset, limit: 1 },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        kind: 'archive',
        archive: { total: 2, offset, shown: offset < 2 ? 1 : 0 },
      });
      if (offset === 0)
        expect(result.structuredContent).toMatchObject({
          archive: { nextOffset: 1, entries: [{ title: 'Archived first' }] },
        });
      if (offset === 1) {
        expect(result.structuredContent).toMatchObject({
          archive: { entries: [{ title: 'Archived second' }] },
        });
        expect(JSON.stringify(result.content)).toContain('Archived second');
      }
      if (offset > 0) expect(result.structuredContent).not.toHaveProperty('archive.nextOffset');
    }
  });

  it('keeps an absent archived ID on not_found in full and archive modes', async () => {
    for (const archive of [undefined, { list: 'keyContent' }]) {
      const error = await contractError(reliefwebGetDisaster, {
        id: 9999999,
        ...(archive ? { archive } : {}),
      });
      expect(error.data).toMatchObject({ reason: 'not_found' });
    }
  });
});

// ─── Description and profile overview ────────────────────────────────────────

/** Two copies of a text this long exceed the outline budget; one copy fits. */
const FITS_ONCE = 15_000;
/** A text this long exceeds the outline budget on its own. */
const OVER_BUDGET = 30_000;
/** The legacy link list ReliefWeb appends to a description whose overview is its prefix. */
const LINK_TAIL = '\n### Useful Links\n\n- [Situation map](https://example.org/map)';

function overviewText(size: number): string {
  return `Overview ${'x'.repeat(size - 9)}`;
}

/**
 * Upstream disaster fields in the three shapes ReliefWeb serves: an overview identical to the
 * description, an overview the description extends with a link list, and no overview at all.
 */
function overviewFields(shape: 'identical' | 'prefix' | 'absent', size: number) {
  const text = overviewText(size);
  return {
    name: `Disaster with ${shape} overview`,
    status: 'ongoing',
    url_alias: `https://reliefweb.int/disaster/${shape}`,
    description: shape === 'prefix' ? `${text}${LINK_TAIL}` : text,
    ...(shape === 'absent' ? {} : { profile: { overview: text } }),
  };
}

const OVERVIEW_ID = {
  identicalFits: 401,
  identicalOver: 402,
  prefixSmall: 403,
  prefixOver: 404,
  absentFits: 405,
  absentOver: 406,
} as const;

const OVERVIEW_FIXTURES = new Map<number, ReturnType<typeof overviewFields>>([
  [OVERVIEW_ID.identicalFits, overviewFields('identical', FITS_ONCE)],
  [OVERVIEW_ID.identicalOver, overviewFields('identical', OVER_BUDGET)],
  [OVERVIEW_ID.prefixSmall, overviewFields('prefix', 1_000)],
  [OVERVIEW_ID.prefixOver, overviewFields('prefix', FITS_ONCE)],
  [OVERVIEW_ID.absentFits, overviewFields('absent', FITS_ONCE)],
  [OVERVIEW_ID.absentOver, overviewFields('absent', OVER_BUDGET)],
]);

function contractText(result: Awaited<ReturnType<typeof runToolContract>>): string {
  return result.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
}

/** Calls the tool and returns its typed structuredContent with the content[] text. */
async function callTool(input: { id: number; sections?: string[] }) {
  const result = await runToolContract(reliefwebGetDisaster, input);
  expect(result.isError).not.toBe(true);
  return {
    record: reliefwebGetDisaster.output.parse(result.structuredContent),
    text: contractText(result),
  };
}

describe('description and profile overview through the real service', () => {
  beforeEach(async () => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    const { ReliefWebService } = await vi.importActual<
      typeof import('@/services/reliefweb/reliefweb-service.js')
    >('@/services/reliefweb/reliefweb-service.js');
    const service = new ReliefWebService({} as never, createInMemoryStorage());
    mockGetDisaster.mockImplementation(service.getDisaster.bind(service));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request) => {
      const id = Number(new URL(String(request)).pathname.split('/').at(-1));
      const fields = OVERVIEW_FIXTURES.get(id);
      return fields
        ? Response.json({ data: [{ id, fields }] })
        : new Response('{}', { status: 404 });
    });
  });
  afterEach(() => {
    mockGetDisaster.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns an identical overview once, flagged, so a record whose two copies outline now fits', async () => {
    const copy = overviewText(FITS_ONCE);
    const { record, text } = await callTool({ id: OVERVIEW_ID.identicalFits });

    expect(record).toMatchObject({
      kind: 'full',
      description: copy,
      profileOverviewSameAsDescription: true,
    });
    expect(record).not.toHaveProperty('profileOverview');
    // The flip is real: with the second copy restored, the same record is over budget.
    const { kind: _kind, profileOverviewSameAsDescription: _flag, ...stored } = record;
    expect(JSON.stringify({ ...stored, profileOverview: copy }).length).toBeGreaterThan(
      DEFAULT_OUTLINE_BUDGET_BYTES,
    );

    expect(text).toContain('**Profile overview:** same as description');
    expect(text).not.toContain('## Overview');
    expect(text.split(copy).length - 1).toBe(1);
  });

  it('outlines the deduplicated record when one copy alone is over budget, and resolves every name it lists', async () => {
    const { record, text } = await callTool({ id: OVERVIEW_ID.identicalOver });

    expect(record.kind).toBe('outline');
    const names = record.sections?.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['description', 'profileOverviewSameAsDescription']),
    );
    expect(names).not.toContain('profileOverview');
    expect(record.sections?.find((s) => s.name === 'description')?.bytes).toBe(OVER_BUDGET + 2);
    expect(text).toContain('profileOverviewSameAsDescription');

    const flag = await callTool({
      id: OVERVIEW_ID.identicalOver,
      sections: ['profileOverviewSameAsDescription'],
    });
    expect(flag.record).toMatchObject({ kind: 'full', profileOverviewSameAsDescription: true });
    expect(flag.record).not.toHaveProperty('description');
    expect(flag.text).toContain('**Profile overview:** same as description');
  });

  it('returns an identical overview as stored when sections names it, and keeps it among the available names', async () => {
    const copy = overviewText(OVER_BUDGET);
    const { record, text } = await callTool({
      id: OVERVIEW_ID.identicalOver,
      sections: ['profileOverview'],
    });

    expect(Object.keys(record).sort()).toEqual([
      'id',
      'kind',
      'name',
      'profileOverview',
      'urlAlias',
    ]);
    expect(record.profileOverview).toBe(copy);
    expect(text).toContain(`## Overview\n\n${copy}`);

    const err = await contractError(reliefwebGetDisaster, {
      id: OVERVIEW_ID.identicalOver,
      sections: ['situation'],
    });
    expect(err.data?.unmatched).toEqual(['situation']);
    expect(err.data?.available).toEqual(expect.arrayContaining(['description', 'profileOverview']));
  });

  it('leaves prefix and absent overviews unchanged in full, outline, and selection modes', async () => {
    const small = overviewText(1_000);
    const prefixFull = await callTool({ id: OVERVIEW_ID.prefixSmall });
    expect(prefixFull.record).toMatchObject({
      kind: 'full',
      description: `${small}${LINK_TAIL}`,
      profileOverview: small,
    });
    expect(prefixFull.record).not.toHaveProperty('profileOverviewSameAsDescription');
    expect(prefixFull.text).toContain(`## Overview\n\n${small}`);
    expect(prefixFull.text).not.toContain('**Profile overview:**');

    const absentFull = await callTool({ id: OVERVIEW_ID.absentFits });
    expect(absentFull.record).toMatchObject({ kind: 'full', description: overviewText(FITS_ONCE) });
    expect(absentFull.record).not.toHaveProperty('profileOverview');
    expect(absentFull.record).not.toHaveProperty('profileOverviewSameAsDescription');
    expect(absentFull.text).not.toContain('## Overview');
    expect(absentFull.text).not.toContain('**Profile overview:**');

    const prefixOutline = await callTool({ id: OVERVIEW_ID.prefixOver });
    expect(prefixOutline.record.kind).toBe('outline');
    const prefixNames = prefixOutline.record.sections?.map((s) => s.name);
    expect(prefixNames).toEqual(expect.arrayContaining(['description', 'profileOverview']));
    expect(prefixNames).not.toContain('profileOverviewSameAsDescription');

    const absentOutline = await callTool({ id: OVERVIEW_ID.absentOver });
    expect(absentOutline.record.kind).toBe('outline');
    const absentNames = absentOutline.record.sections?.map((s) => s.name);
    expect(absentNames).toContain('description');
    expect(absentNames).not.toContain('profileOverview');
    expect(absentNames).not.toContain('profileOverviewSameAsDescription');

    const prefixSelected = await callTool({
      id: OVERVIEW_ID.prefixOver,
      sections: ['profileOverview'],
    });
    expect(prefixSelected.record.profileOverview).toBe(overviewText(FITS_ONCE));

    const err = await contractError(reliefwebGetDisaster, {
      id: OVERVIEW_ID.absentOver,
      sections: ['profileOverview'],
    });
    expect(err.data?.unmatched).toEqual(['profileOverview']);
    expect(err.data?.available).not.toContain('profileOverview');
    expect(err.data?.available).not.toContain('profileOverviewSameAsDescription');
  });
});

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

  it('rejects a section this record does not carry and names the ones it does', async () => {
    mockGetDisaster.mockResolvedValue({ id: 1, name: 'Minimal Disaster', status: 'past' });

    const err = await contractError(reliefwebGetDisaster, {
      id: 1,
      sections: ['profileOverview', 'keyContent'],
    });

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(err.message).toContain('Unknown sections: profileOverview, keyContent.');
    expect(err.data).toMatchObject({
      unmatched: ['profileOverview', 'keyContent'],
      available: ['id', 'name', 'status'],
    });
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

// ─── Identifiers for the next call ───────────────────────────────────────────

describe('reliefwebGetDisaster — ISO3 codes and curated report IDs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function textOfContent(content: Array<{ type: string; text?: string }>): string {
    return content.map((block) => block.text ?? '').join('\n');
  }

  it('carries both onto structuredContent and content[] on the full record', async () => {
    const curated = {
      keyContent: [
        { title: 'Flash Update', url: 'https://reliefweb.int/node/4236883', reportId: 4236883 },
      ],
      appealsResponsePlans: [
        {
          title: 'Flash Appeal',
          url: 'https://reliefweb.int/node/2611439/edit',
          date: '2025-11-20',
          reportId: 2611439,
        },
      ],
      usefulLinks: [{ title: 'Partner page', url: 'https://example.org/response' }],
    };
    mockGetDisaster.mockResolvedValue({
      id: 52467,
      name: 'Afghanistan: Earthquake - Nov 2025',
      primaryCountry: 'Afghanistan',
      primaryCountryIso3: 'AFG',
      countries: ['Afghanistan', 'Pakistan'],
      countryIso3s: ['AFG', 'PAK'],
      ...curated,
    });

    const result = await runToolContract(reliefwebGetDisaster, { id: 52467 });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      kind: 'full',
      primaryCountryIso3: 'AFG',
      countryIso3s: ['AFG', 'PAK'],
      ...curated,
    });
    expect(result.structuredContent).not.toHaveProperty('usefulLinks.0.reportId');
    const text = textOfContent(result.content);
    expect(text).toContain('**Primary country ISO3:** AFG');
    expect(text).toContain('**Country ISO3 codes:** AFG, PAK');
    expect(text).toContain('(<https://reliefweb.int/node/4236883>) — report ID 4236883');
    expect(text).toContain('(2025-11-20) — report ID 2611439');
    expect(text.match(/report ID/g)).toHaveLength(2);
  });

  it('carries report IDs on archive page entries', async () => {
    mockGetDisasterArchive.mockResolvedValue({
      id: 52467,
      name: 'Afghanistan: Earthquake - Nov 2025',
      primaryCountryIso3: 'AFG',
      countryIso3s: ['AFG'],
      entries: [
        { title: 'Archived update', url: 'https://reliefweb.int/node/4100001', reportId: 4100001 },
        { title: 'Archived partner page', url: 'https://example.org/old' },
      ],
    });

    const result = await runToolContract(reliefwebGetDisaster, {
      id: 52467,
      archive: { list: 'keyContent' },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      kind: 'archive',
      primaryCountryIso3: 'AFG',
      archive: {
        entries: [{ reportId: 4100001 }, { title: 'Archived partner page' }],
      },
    });
    expect(result.structuredContent).not.toHaveProperty('archive.entries.1.reportId');
    const text = textOfContent(result.content);
    expect(text).toContain('**Primary country ISO3:** AFG');
    expect(text).toContain('(<https://reliefweb.int/node/4100001>) — report ID 4100001');
    expect(text.match(/report ID/g)).toHaveLength(1);
  });
});
