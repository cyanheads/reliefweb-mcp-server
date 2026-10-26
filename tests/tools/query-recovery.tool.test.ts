/**
 * @fileoverview Query rejection guidance and sanitized envelopes across query tools.
 * @module tests/tools/query-recovery.tool.test
 */
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebListSources } from '@/mcp-server/tools/definitions/list-sources.tool.js';
import { reliefwebSearchDisasters } from '@/mcp-server/tools/definitions/search-disasters.tool.js';
import { reliefwebSearchJobs } from '@/mcp-server/tools/definitions/search-jobs.tool.js';
import { reliefwebSearchReports } from '@/mcp-server/tools/definitions/search-reports.tool.js';
import { reliefwebSearchTraining } from '@/mcp-server/tools/definitions/search-training.tool.js';

const search = vi.fn();
vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({
    searchReports: search,
    searchDisasters: search,
    searchJobs: search,
    searchTraining: search,
    listSources: search,
  }),
}));

describe.each([
  reliefwebSearchReports,
  reliefwebSearchDisasters,
  reliefwebSearchJobs,
  reliefwebSearchTraining,
  reliefwebListSources,
])('$name query recovery', (definition) => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves the rejected-query reason and sanitized upstream explanation on both surfaces', async () => {
    search.mockRejectedValue(
      new McpError(JsonRpcErrorCode.InvalidParams, 'HTTP 400', {
        upstreamMessage: 'Search backend rejected the request.',
        body: 'private-body',
        url: 'https://private.example',
        cause: { secret: 'private-cause' },
      }),
    );
    const result = await runToolContract(definition, { text: '((( AND OR )' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        data: { reason: 'invalid_query' },
        message: expect.stringContaining('Search backend rejected the request.'),
      },
    });
    expect(JSON.stringify(result)).not.toContain('private-body');
    expect(JSON.stringify(result)).not.toContain('private.example');
    expect(JSON.stringify(result)).not.toContain('private-cause');
    expect(JSON.stringify(result.content)).toContain('Search backend rejected the request.');
  });

  it('names malformed text as a possible cause and gives syntax recovery on both surfaces', async () => {
    search.mockRejectedValue(new McpError(JsonRpcErrorCode.InvalidParams, 'HTTP 400'));
    const result = await runToolContract(definition, { text: '((( AND OR )' });
    const error = (result.structuredContent as { error: { data: { recovery: { hint: string } } } })
      .error;
    for (const text of [error.data.recovery.hint, JSON.stringify(result.content)]) {
      expect(text).toContain('text');
      expect(text).toContain('plain keywords');
      expect(text).toContain('balanced parentheses');
      expect(text).toContain('complete boolean expressions');
      expect(text).toContain('possible cause');
    }
  });
});

describe.each([reliefwebSearchJobs, reliefwebSearchTraining])(
  '$name career taxonomy',
  (definition) => {
    it('keeps arbitrary and case-variant career names accepted', () => {
      expect(definition.input.parse({ career_category: 'Nonexistent' }).career_category).toBe(
        'Nonexistent',
      );
      expect(
        definition.input.parse({ career_category: 'program/project management' }).career_category,
      ).toBe('program/project management');
    });

    it('advertises real ReliefWeb career names', () => {
      const description = definition.input.shape.career_category.description;
      expect(description).toContain('Program/Project Management');
      expect(description).toContain('Information and Communications Technology');
      expect(description).not.toContain('Programme and Project Management');
      expect(description).not.toContain('Logistics and Telecommunications');
    });
  },
);

describe('report raw-filter normalization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves zero and negative disaster IDs and nonempty raw filters', async () => {
    search.mockResolvedValue({ items: [], totalCount: 0 });
    for (const disaster_id of [0, -1]) {
      const filter = { field: 'language.code', value: 'fr' };
      const result = await runToolContract(reliefwebSearchReports, { disaster_id, filter });
      expect(search.mock.lastCall?.[0]).toMatchObject({
        disasterId: disaster_id,
        rawFilter: filter,
      });
      expect(result.structuredContent).toMatchObject({
        appliedFilters: { disasterId: disaster_id, rawFilter: true },
      });
      expect(JSON.stringify(result.content)).toContain(`disasterId=${disaster_id}`);
    }
  });

  it.each([
    { items: [{ id: 1, title: 'One' }], totalCount: 1, expected: undefined },
    { items: [], totalCount: 0, expected: 'No reports matched' },
    { items: [], totalCount: 12, expected: 'past the end' },
  ])(
    'omits an empty raw filter and composes notices for $totalCount matches',
    async ({ items, totalCount, expected }) => {
      search.mockResolvedValue({ items, totalCount });
      const result = await runToolContract(reliefwebSearchReports, { filter: {}, offset: 100 });
      expect(search.mock.lastCall?.[0]).not.toHaveProperty('rawFilter');
      expect(result.structuredContent).not.toHaveProperty('appliedFilters.rawFilter');
      for (const text of [
        JSON.stringify(result.structuredContent),
        JSON.stringify(result.content),
      ]) {
        expect(text).toContain('Ignored empty filter');
        if (expected) expect(text).toContain(expected);
      }
    },
  );
});

describe.each([
  { definition: reliefwebSearchReports, fields: ['date_from', 'date_to'] },
  { definition: reliefwebSearchDisasters, fields: ['date_from', 'date_to'] },
  { definition: reliefwebSearchTraining, fields: ['date_start_from', 'date_start_to'] },
])('$definition.name local date errors', ({ definition, fields }) => {
  beforeEach(() => vi.clearAllMocks());

  it.each(fields)(
    'rejects impossible %s locally with field, value, and recovery on both surfaces',
    async (field) => {
      search.mockResolvedValue({ items: [], totalCount: 0 });
      const result = await runToolContract(definition, { [field]: '2026-02-30T00:00:00Z' });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'invalid_date' } },
      });
      for (const text of [
        JSON.stringify(result.structuredContent),
        JSON.stringify(result.content),
      ]) {
        expect(text).toContain(field);
        expect(text).toContain('2026-02-30T00:00:00Z');
        expect(text).toContain('calendar date');
        expect(text).toContain('ISO 8601');
      }
      expect(search).not.toHaveBeenCalled();
    },
  );

  it('preserves end-of-day normalization and echoes the same UTC bounds', async () => {
    search.mockResolvedValue({ items: [], totalCount: 0 });
    const result = await runToolContract(definition, {
      [fields[0]!]: '2026-07-01T24:00:00.000Z',
      [fields[1]!]: '2026-07-02',
    });
    expect(result.isError).not.toBe(true);
    const applied =
      definition === reliefwebSearchTraining
        ? { dateStartFrom: '2026-07-02T00:00:00+00:00', dateStartTo: '2026-07-02T23:59:59+00:00' }
        : { dateFrom: '2026-07-02T00:00:00+00:00', dateTo: '2026-07-02T23:59:59+00:00' };
    expect(search.mock.lastCall?.[0]).toMatchObject(applied);
    expect(result.structuredContent).toMatchObject({ appliedFilters: applied });
    expect(JSON.stringify(result.content)).toContain('2026-07-02T00:00:00+00:00');
    expect(JSON.stringify(result.content)).toContain('2026-07-02T23:59:59+00:00');
  });
});
