/**
 * @fileoverview Limit defaults, validation, and applied page-size contracts.
 * @module tests/tools/limits.test
 */
import { z } from '@cyanheads/mcp-ts-core';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebGetCountry } from '@/mcp-server/tools/definitions/get-country.tool.js';
import { reliefwebGetDisaster } from '@/mcp-server/tools/definitions/get-disaster.tool.js';
import { reliefwebListCountries } from '@/mcp-server/tools/definitions/list-countries.tool.js';
import { reliefwebListSources } from '@/mcp-server/tools/definitions/list-sources.tool.js';
import { reliefwebSearchDisasters } from '@/mcp-server/tools/definitions/search-disasters.tool.js';
import { reliefwebSearchJobs } from '@/mcp-server/tools/definitions/search-jobs.tool.js';
import { reliefwebSearchReports } from '@/mcp-server/tools/definitions/search-reports.tool.js';
import { reliefwebSearchTraining } from '@/mcp-server/tools/definitions/search-training.tool.js';
import { limitSchema, resolveLimit } from '@/mcp-server/tools/limits.js';

const { service, counter } = vi.hoisted(() => ({
  service: {
    searchReports: vi.fn(),
    searchJobs: vi.fn(),
    searchTraining: vi.fn(),
    searchDisasters: vi.fn(),
    listCountries: vi.fn(),
    listSources: vi.fn(),
    getCountryArchive: vi.fn(),
    getDisasterArchive: vi.fn(),
  },
  counter: { add: vi.fn() },
}));
vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => service,
}));
vi.mock('@cyanheads/mcp-ts-core/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cyanheads/mcp-ts-core/utils')>()),
  createCounter: () => counter,
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of [
    'searchReports',
    'searchJobs',
    'searchTraining',
    'searchDisasters',
    'listCountries',
    'listSources',
  ] as const) {
    service[name].mockResolvedValue({ items: [], totalCount: 0 });
  }
});

describe('limit contracts', () => {
  it('accepts over-cap integers without discarding the requested value', () => {
    expect(reliefwebSearchReports.input.parse({ limit: 1001 }).limit).toBe(1001);
    expect(
      reliefwebGetCountry.input.parse({ iso3: 'SYR', archive: { list: 'keyContent', limit: 101 } })
        .archive?.limit,
    ).toBe(101);
  });
  it('preserves defaults and refuses non-positive or fractional page sizes', () => {
    expect(reliefwebListSources.input.parse({}).limit).toBe(10);
    expect(reliefwebListCountries.input.parse({}).limit).toBe(100);
    expect(
      reliefwebGetCountry.input.parse({ iso3: 'SYR', archive: { list: 'keyContent' } }).archive
        ?.limit,
    ).toBe(25);
    for (const limit of [0, -1, 1.5]) {
      expect(reliefwebSearchReports.input.safeParse({ limit }).success).toBe(false);
      expect(
        reliefwebGetCountry.input.safeParse({ iso3: 'SYR', archive: { list: 'keyContent', limit } })
          .success,
      ).toBe(false);
    }
  });
});

describe('shared clamping policy', () => {
  it.each([
    [1000, 1, 1, false],
    [1000, 1000, 1000, false],
    [1000, 1001, 1000, true],
    [1000, Number.MAX_SAFE_INTEGER, 1000, true],
    [100, 100, 100, false],
    [100, 101, 100, true],
  ] as const)('ceiling %i, requested %i applies %i', (maximum, requested, applied, clamped) => {
    const ctx = createMockContext();
    const info = vi.spyOn(ctx.log, 'info');
    const result = resolveLimit(requested, maximum, 'reliefweb_search_jobs', ctx);
    expect(result.limit).toBe(applied);
    if (clamped) {
      expect(info).toHaveBeenCalledExactlyOnceWith('ReliefWeb page limit clamped', {
        tool: 'reliefweb_search_jobs',
        requested,
        applied,
      });
      expect(counter.add).toHaveBeenCalledExactlyOnceWith(1, {
        tool: 'reliefweb_search_jobs',
        maximum,
      });
      result.notice('Further guidance.');
      expect(getEnrichment(ctx).notice).toBe(
        `Requested limit ${requested}; applied limit ${applied}. Further guidance.`,
      );
      expect(counter.add).toHaveBeenCalledTimes(1);
    } else {
      expect(info).not.toHaveBeenCalled();
      expect(counter.add).not.toHaveBeenCalled();
      expect(getEnrichment(ctx).notice).toBeUndefined();
    }
    const next = createMockContext();
    resolveLimit(1, maximum, 'reliefweb_search_jobs', next);
    expect(getEnrichment(next).notice).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid size %s',
    (limit) => {
      expect(limitSchema(1000).safeParse(limit).success).toBe(false);
    },
  );
});

describe('search/list wiring', () => {
  const tools = [
    [reliefwebSearchReports, service.searchReports],
    [reliefwebSearchJobs, service.searchJobs],
    [reliefwebSearchTraining, service.searchTraining],
    [reliefwebSearchDisasters, service.searchDisasters],
    [reliefwebListCountries, service.listCountries],
    [reliefwebListSources, service.listSources],
  ] as const;
  it.each(tools)('$0.name preserves its default page size', (tool) => {
    expect(tool.input.parse({}).limit).toBe(tool.name === 'reliefweb_list_countries' ? 100 : 10);
  });
  it.each(tools)(
    '$0.name applies the ceiling before the service and preserves both notices',
    async (tool, mock) => {
      mock.mockResolvedValue({ items: [], totalCount: 2501 });
      const response = await runToolContract(tool, { limit: 1001, offset: 99999 });
      expect(response.isError).not.toBe(true);
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1000, offset: 99999 }),
        expect.anything(),
      );
      expect(response.structuredContent).toMatchObject({
        totalCount: 2501,
        notice: expect.stringContaining('Requested limit 1001; applied limit 1000.'),
      });
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n');
      expect(text).toContain('Requested limit 1001; applied limit 1000.');
      expect(text).toContain('last page starts at offset 2000');
      if (tool.name.startsWith('reliefweb_search_')) {
        expect(response.structuredContent).toMatchObject({ appliedFilters: { limit: 1000 } });
        expect(text).toContain('limit=1000');
      }
      expect(counter.add).toHaveBeenCalledTimes(1);
    },
  );

  it('retains the empty-filter and zero-match guidance alongside the clamp on both surfaces', async () => {
    const response = await runToolContract(reliefwebSearchReports, { filter: {}, limit: 1001 });
    const structured = z.object({ notice: z.string() }).parse(response.structuredContent);
    for (const text of [structured.notice, JSON.stringify(response.content)]) {
      expect(text).toContain('Requested limit 1001; applied limit 1000.');
      expect(text).toContain('Ignored empty filter');
      expect(text).toContain('No reports matched');
    }
  });

  it('keeps clamp disclosure on a nonempty page', async () => {
    service.listCountries.mockResolvedValue({
      items: [{ id: 1, name: 'Afghanistan' }],
      totalCount: 1,
    });
    const response = await runToolContract(reliefwebListCountries, { limit: 1001 });
    expect(response.structuredContent).toMatchObject({
      notice: 'Requested limit 1001; applied limit 1000.',
    });
    expect(JSON.stringify(response.content)).toContain('Requested limit 1001; applied limit 1000.');
  });

  it.each([0, -1, 1.5])(
    'refuses invalid size %s on both surfaces before any work',
    async (limit) => {
      for (const response of [
        await runToolContract(reliefwebSearchJobs, { limit }),
        await runToolContract(reliefwebGetCountry, {
          iso3: 'SYR',
          archive: { list: 'keyContent', limit },
        }),
      ]) {
        expect(response.isError).toBe(true);
        expect(response.structuredContent).toMatchObject({
          error: { code: -32602, data: { reason: 'invalid_arguments' } },
        });
        expect(JSON.stringify(response.content)).toContain('invalid_arguments');
      }
      expect(service.searchJobs).not.toHaveBeenCalled();
      expect(service.getCountryArchive).not.toHaveBeenCalled();
      expect(counter.add).not.toHaveBeenCalled();
    },
  );
});

describe('archive wiring', () => {
  const entries = Array.from({ length: 201 }, (_, index) => ({
    title: `Archive ${index}`,
    url: `https://example.test/${index}`,
  }));
  it.each([
    [
      reliefwebGetCountry,
      { iso3: 'SYR' },
      service.getCountryArchive,
      { id: 1, name: 'Syria', iso3: 'SYR' },
    ],
    [reliefwebGetDisaster, { id: 1 }, service.getDisasterArchive, { id: 1, name: 'Flood' }],
  ] as const)(
    '$0.name slices successive pages using the applied size',
    async (tool, identityInput, mock, identity) => {
      mock.mockResolvedValue({ ...identity, entries });
      for (const [offset, shown, nextOffset, first] of [
        [0, 100, 100, 'Archive 0'],
        [100, 100, 200, 'Archive 100'],
        [200, 1, undefined, 'Archive 200'],
        [300, 0, undefined, undefined],
      ] as const) {
        const response = await runToolContract(tool, {
          ...identityInput,
          archive: { list: 'keyContent', limit: 101, offset },
        });
        expect(response.isError).not.toBe(true);
        expect(response.structuredContent).toMatchObject({
          archive: { total: 201, shown, offset },
          notice: 'Requested limit 101; applied limit 100.',
        });
        const { archive: page } = z
          .object({
            archive: z.object({
              entries: z.array(z.object({ title: z.string() })),
              nextOffset: z.number().optional(),
            }),
          })
          .parse(response.structuredContent);
        expect(page.nextOffset).toBe(nextOffset);
        expect(page.entries[0]?.title).toBe(first);
        const text = JSON.stringify(response.content);
        expect(text).toContain('Requested limit 101; applied limit 100.');
        if (first) expect(text).toContain(first);
        if (offset === 300) expect(text).toContain('No archived entries at this offset');
      }
      mock.mockResolvedValue({ ...identity, entries: [] });
      const empty = await runToolContract(tool, {
        ...identityInput,
        archive: { list: 'keyContent', limit: 101 },
      });
      expect(empty.structuredContent).toMatchObject({ archive: { total: 0, shown: 0 } });
      expect(JSON.stringify(empty.content)).toContain('This list has no archived entries');
      expect(JSON.stringify(empty.content)).toContain('Requested limit 101; applied limit 100.');
    },
  );
});
