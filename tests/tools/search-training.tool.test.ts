/**
 * @fileoverview Tests for the reliefweb_search_training tool.
 * @module tests/tools/search-training.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebSearchTraining } from '@/mcp-server/tools/definitions/search-training.tool.js';
import { contractError } from '../helpers/contract-error.js';

const mockSearchTraining = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ searchTraining: mockSearchTraining }),
}));

describe('training cost and delivery language', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });
  });

  it.each(['free', 'fee-based', ' FEE BASED '])(
    'resolves %s and keeps listing and delivery languages distinct',
    async (cost) => {
      mockSearchTraining.mockResolvedValue({
        items: [
          {
            id: 3678550,
            title: 'Bilingual course',
            cost: cost === 'free' ? 'free' : 'fee-based',
            languages: ['en'],
            trainingLanguages: ['en', 'fr'],
          },
        ],
        totalCount: 1,
      });
      const result = await runToolContract(reliefwebSearchTraining, {
        cost,
        language: 'en',
        training_language: 'fr',
        include_archived: true,
      });
      const canonical = cost === 'free' ? 'free' : 'fee-based';
      expect(result.isError).not.toBe(true);
      expect(mockSearchTraining.mock.lastCall?.[0]).toMatchObject({
        cost: canonical,
        language: 'en',
        trainingLanguage: 'fr',
      });
      expect(result.structuredContent).toMatchObject({
        items: [{ cost: canonical, languages: ['en'], trainingLanguages: ['en', 'fr'] }],
        appliedFilters: { cost: canonical, language: 'en', trainingLanguage: 'fr' },
      });
      const text = JSON.stringify(result.content);
      expect(text).toContain(`cost=${canonical}`);
      expect(text).toContain('trainingLanguage=fr');
      expect(text).toContain('Listing languages');
      expect(text).toContain('Training languages');
      expect(text).toContain('en, fr');
    },
  );

  it('rejects unknown cost locally and lists valid choices on both error surfaces', async () => {
    const result = await runToolContract(reliefwebSearchTraining, { cost: 'paid' });
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'unknown_cost' } },
    });
    for (const text of [JSON.stringify(result.structuredContent), JSON.stringify(result.content)]) {
      expect(text).toContain('paid');
      expect(text).toContain('free');
      expect(text).toContain('fee-based');
    }
    expect(mockSearchTraining).not.toHaveBeenCalled();
  });

  it('omits blank filters and sparse summary metadata on both surfaces', async () => {
    mockSearchTraining.mockResolvedValue({ items: [{ id: 1, title: 'Sparse' }], totalCount: 1 });
    const result = await runToolContract(reliefwebSearchTraining, {
      cost: '  ',
      training_language: ' ',
      include_archived: true,
    });
    expect(mockSearchTraining.mock.lastCall?.[0]).not.toHaveProperty('cost');
    expect(mockSearchTraining.mock.lastCall?.[0]).not.toHaveProperty('trainingLanguage');
    expect(result.structuredContent).not.toHaveProperty('appliedFilters.cost');
    expect(result.structuredContent).not.toHaveProperty('appliedFilters.trainingLanguage');
    expect(result.structuredContent).not.toHaveProperty('items.0.cost');
    expect(result.structuredContent).not.toHaveProperty('items.0.trainingLanguages');
    expect(JSON.stringify(result.content)).not.toContain('**Cost:**');
    expect(JSON.stringify(result.content)).not.toContain('Training languages');
  });

  it('includes cost and delivery-language guidance for no matches on both surfaces', async () => {
    const result = await runToolContract(reliefwebSearchTraining, {
      cost: 'FREE',
      training_language: 'fr',
    });
    for (const text of [JSON.stringify(result.structuredContent), JSON.stringify(result.content)]) {
      expect(text).toContain('cost=free');
      expect(text).toContain('training_language=fr');
      expect(text).toContain('remove the cost or training_language filter');
    }
  });

  it('keeps past-end guidance with the new filter echo', async () => {
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 12 });
    const result = await runToolContract(reliefwebSearchTraining, {
      cost: 'free',
      training_language: 'fr',
      offset: 100,
    });
    expect(result.structuredContent).toMatchObject({
      appliedFilters: { cost: 'free', trainingLanguage: 'fr' },
    });
    expect(JSON.stringify(result.content)).toContain('past the end');
  });
});

describe('reliefwebSearchTraining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns training listings on success', async () => {
    const items = [
      {
        id: 88888,
        title: 'Emergency Shelter Training',
        dateStart: '2024-06-01T00:00:00+00:00',
        dateEnd: '2024-06-05T00:00:00+00:00',
        dateRegistration: '2024-05-20T00:00:00+00:00',
        sources: ['UNHCR'],
        countries: ['Kenya'],
        themes: ['Shelter and NFI'],
        formats: ['on-site'],
        languages: ['en'],
        careerCategories: ['Program/Project Management'],
        urlAlias: 'https://reliefweb.int/training/test',
      },
    ];
    mockSearchTraining.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ format: 'on-site', limit: 5 });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 88888, title: 'Emergency Shelter Training' });
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('rejects a format outside the ReliefWeb taxonomy at input validation', () => {
    // The only real format.name values are on-site and online — the enum rejects
    // Workshop/E-learning/Conference/Seminar at parse time.
    expect(() => reliefwebSearchTraining.input.parse({ format: 'Workshop' })).toThrow();
    expect(() => reliefwebSearchTraining.input.parse({ format: 'E-learning' })).toThrow();
  });

  it('populates notice enrichment when no training matches', async () => {
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({
      text: 'zzznomatch',
      format: 'online',
    });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('zzznomatch');
  });

  it('empty-result notice echoes source, career_category, language, and date_start_to', async () => {
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({
      source: 'RedR',
      career_category: 'Logistics/Procurement',
      language: 'fr',
      date_start_to: '2024-12-31T00:00:00+00:00',
    });
    await reliefwebSearchTraining.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('source="RedR"');
    expect(notice).toContain('career_category="Logistics/Procurement"');
    expect(notice).toContain('language=fr');
    expect(notice).toContain('start_to=2024-12-31T00:00:00+00:00');
  });

  it('echoes appliedFilters with normalized country and resolved sort', async () => {
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ country: 'som', format: 'online' });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(result.appliedFilters).toMatchObject({
      country: 'SOM',
      format: 'online',
      sort: 'date.start:asc',
      limit: 10,
      offset: 0,
    });
  });

  it('threads an explicit sort into the service call and echoes it in appliedFilters', async () => {
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ sort: 'date.start:desc' });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(mockSearchTraining).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'date.start:desc' }),
      ctx,
    );
    expect(result.appliedFilters.sort).toBe('date.start:desc');
  });

  it('throws ctx.fail("upstream_error") when ReliefWeb is unavailable', async () => {
    mockSearchTraining.mockRejectedValue(
      new McpError(JsonRpcErrorCode.ServiceUnavailable, 'ReliefWeb returned HTTP 503.'),
    );

    const err = await contractError(reliefwebSearchTraining, { text: 'wash' });
    expect(err.code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect(err.data).toMatchObject({ reason: 'upstream_error' });
    expect(err.data).toHaveProperty('recovery.hint');
    expect(err.data).not.toHaveProperty('cause');
  });

  it('throws ctx.fail("invalid_query") with the ReliefWeb message when the query is rejected', async () => {
    mockSearchTraining.mockRejectedValue(
      new McpError(JsonRpcErrorCode.InvalidParams, 'ReliefWeb returned HTTP 400.', {
        upstreamMessage: "Unrecognized sort field 'bogus.field'.",
      }),
    );

    const err = await contractError(reliefwebSearchTraining, { sort: 'bogus.field:desc' });
    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(err.data).toMatchObject({ reason: 'invalid_query' });
    expect(err.message).toContain("Unrecognized sort field 'bogus.field'");
    expect(err.data?.recovery?.hint).toMatch(/correct the value/i);
    expect(err.data?.recovery?.hint).not.toMatch(/quota/i);
  });

  it('passes date range filters correctly', async () => {
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({
      date_start_from: '2024-06-01T00:00:00+00:00',
      date_start_to: '2024-12-31T00:00:00+00:00',
    });
    await reliefwebSearchTraining.handler(input, ctx);

    expect(mockSearchTraining).toHaveBeenCalledWith(
      expect.objectContaining({
        dateStartFrom: '2024-06-01T00:00:00+00:00',
        dateStartTo: '2024-12-31T00:00:00+00:00',
      }),
      ctx,
    );
  });

  it('handles sparse training without optional fields', async () => {
    const items = [{ id: 1, title: 'Minimal Training' }];
    mockSearchTraining.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({});
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(result.items[0]).toMatchObject({ id: 1, title: 'Minimal Training' });
    expect(result.items[0]!.dateStart).toBeUndefined();
    expect(result.items[0]!.formats).toBeUndefined();
  });

  it('formats output completely', () => {
    const output = {
      items: [
        {
          id: 88888,
          title: 'WASH Training',
          sources: ['UNICEF'],
          formats: ['online'],
          countries: ['Somalia'],
          careerCategories: ['Program/Project Management'],
          languages: ['en'],
          themes: ['Water Sanitation Hygiene'],
          dateStart: '2024-06-01T00:00:00+00:00',
          dateEnd: '2024-06-30T00:00:00+00:00',
          dateRegistration: '2024-05-15T00:00:00+00:00',
          urlAlias: 'https://reliefweb.int/training/test',
        },
      ],
      appliedFilters: {
        format: 'online',
        sort: 'date.start:asc',
        preset: 'latest',
        limit: 10,
        offset: 0,
      },
    };
    const blocks = reliefwebSearchTraining.format!(output);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Applied filters:');
    expect(text).toContain('preset=latest');
    expect(text).toContain('88888');
    expect(text).toContain('WASH Training');
    expect(text).toContain('UNICEF');
    expect(text).toContain('online');
    expect(text).toContain('2024-06-01');
    expect(text).toContain('2024-06-30');
  });
});

// ─── Issue #17: unbounded searches default to upcoming starts ────────────────

describe('reliefwebSearchTraining — default upcoming-start window', () => {
  const NOW = new Date('2026-08-06T12:34:56.789Z');
  const NOW_BOUND = '2026-08-06T12:34:56+00:00';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a current-timestamp lower bound when neither date bound is supplied', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ limit: 5 });
    await reliefwebSearchTraining.handler(input, ctx);

    expect(mockSearchTraining).toHaveBeenCalledWith(
      expect.objectContaining({ dateStartFrom: NOW_BOUND }),
      ctx,
    );
  });

  it('echoes the injected bound in appliedFilters and in content[]', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({});
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(result.appliedFilters.dateStartFrom).toBe(NOW_BOUND);
    const text = (reliefwebSearchTraining.format!(result)[0] as { text: string }).text;
    expect(text).toContain(`dateStartFrom=${NOW_BOUND}`);
  });

  it('injects no lower bound when the caller supplied only an upper bound', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({
      date_start_to: '2025-12-31T23:59:59+00:00',
    });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(mockSearchTraining.mock.calls[0]![0]).not.toHaveProperty('dateStartFrom');
    expect(result.appliedFilters).not.toHaveProperty('dateStartFrom');
  });

  it('leaves an explicit lower bound alone', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ date_start_from: '2020-01-01' });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(result.appliedFilters.dateStartFrom).toBe('2020-01-01T00:00:00+00:00');
  });
});

// ─── Issue #21: bare YYYY-MM-DD dates ────────────────────────────────────────

describe('reliefwebSearchTraining — date normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });
  });

  it('resolves a bare date window to start-of-day and end-of-day', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({
      date_start_from: '2026-09-01',
      date_start_to: '2026-09-30',
    });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(mockSearchTraining).toHaveBeenCalledWith(
      expect.objectContaining({
        dateStartFrom: '2026-09-01T00:00:00+00:00',
        dateStartTo: '2026-09-30T23:59:59+00:00',
      }),
      ctx,
    );
    expect(result.appliedFilters).toMatchObject({
      dateStartFrom: '2026-09-01T00:00:00+00:00',
      dateStartTo: '2026-09-30T23:59:59+00:00',
    });
  });

  it('rejects an unparseable date at the schema, naming the accepted formats', () => {
    expect(() => reliefwebSearchTraining.input.parse({ date_start_from: 'next month' })).toThrow(
      /calendar date/i,
    );
  });

  it('accepts blank date bounds from form-based clients and still defaults to upcoming', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T12:34:56.789Z'));
    try {
      const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
      const input = reliefwebSearchTraining.input.parse({ date_start_from: '', date_start_to: '' });
      const result = await reliefwebSearchTraining.handler(input, ctx);

      expect(result.appliedFilters.dateStartFrom).toBe('2026-08-06T12:34:56+00:00');
      expect(result.appliedFilters).not.toHaveProperty('dateStartTo');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Issue #22: paged past the end of a result set ───────────────────────────

describe('reliefwebSearchTraining — offset past the end of the result set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the offset and the last reachable page instead of claiming no matches', async () => {
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 215 });

    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ offset: 99999, limit: 10 });
    await reliefwebSearchTraining.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('99999');
    expect(notice).toContain('215');
    expect(notice).toContain('offset 210');
    expect(notice).not.toContain('No training matched');
  });

  it('keeps the broaden-your-search notice when nothing actually matched', async () => {
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ offset: 99999 });
    await reliefwebSearchTraining.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toContain('No training matched');
  });
});

// ─── Issue #18: include_archived reaches the concluded-listings archive ───────

describe('reliefwebSearchTraining — include_archived', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });
  });

  it('sends preset=analysis to the service and echoes it on both surfaces', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ country: 'KEN', include_archived: true });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(mockSearchTraining).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: true }),
      ctx,
    );
    expect(result.appliedFilters.preset).toBe('analysis');
    const text = (reliefwebSearchTraining.format!(result)[0] as { text: string }).text;
    expect(text).toContain('preset=analysis');
  });

  it('defaults to the current-listings preset when the flag is absent', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ country: 'KEN' });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    const params = mockSearchTraining.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('includeArchived');
    expect(result.appliedFilters.preset).toBe('latest');
  });

  it('drops the start-from-now bound, which would hide the archive it just unlocked', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ include_archived: true });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    const params = mockSearchTraining.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('dateStartFrom');
    expect(result.appliedFilters.dateStartFrom).toBeUndefined();
  });

  it('honors an explicit lower bound even with the archive on', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({
      include_archived: true,
      date_start_from: '2015-01-01',
    });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(result.appliedFilters.dateStartFrom).toBe('2015-01-01T00:00:00+00:00');
  });

  it('offers the archive in the empty-result notice', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ country: 'KEN' });
    await reliefwebSearchTraining.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toContain('include_archived=true');
  });
});
