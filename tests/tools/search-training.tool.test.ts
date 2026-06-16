/**
 * @fileoverview Tests for the reliefweb_search_training tool.
 * @module tests/tools/search-training.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebSearchTraining } from '@/mcp-server/tools/definitions/search-training.tool.js';

const mockSearchTraining = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ searchTraining: mockSearchTraining }),
}));

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
        formats: ['Workshop'],
        languages: ['en'],
        careerCategories: ['Programme and Project Management'],
        urlAlias: 'https://reliefweb.int/training/test',
      },
    ];
    mockSearchTraining.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext();
    const input = reliefwebSearchTraining.input.parse({ format: 'Workshop', limit: 5 });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 88888, title: 'Emergency Shelter Training' });
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('populates notice enrichment when no training matches', async () => {
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchTraining.input.parse({
      text: 'zzznomatch',
      format: 'NonexistentFormat',
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

    const ctx = createMockContext();
    const input = reliefwebSearchTraining.input.parse({
      source: 'RedR',
      career_category: 'Logistics and Telecommunications',
      language: 'fr',
      date_start_to: '2024-12-31T00:00:00+00:00',
    });
    await reliefwebSearchTraining.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('source="RedR"');
    expect(notice).toContain('career_category="Logistics and Telecommunications"');
    expect(notice).toContain('language=fr');
    expect(notice).toContain('start_to=2024-12-31T00:00:00+00:00');
  });

  it('echoes appliedFilters with normalized country and resolved sort', async () => {
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchTraining.input.parse({ country: 'som', format: 'E-learning' });
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(result.appliedFilters).toMatchObject({
      country: 'SOM',
      format: 'E-learning',
      sort: 'date.created:desc',
      limit: 10,
      offset: 0,
    });
  });

  it('throws ctx.fail("upstream_error") when the service rejects', async () => {
    mockSearchTraining.mockRejectedValue(
      new McpError(JsonRpcErrorCode.InvalidParams, 'ReliefWeb returned HTTP 400'),
    );

    const ctx = createMockContext({ errors: reliefwebSearchTraining.errors });
    const input = reliefwebSearchTraining.input.parse({ text: 'wash' });

    const err = await reliefwebSearchTraining.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect((err as McpError).data).toMatchObject({ reason: 'upstream_error' });
    expect((err as McpError).data).toHaveProperty('recovery.hint');
  });

  it('passes date range filters correctly', async () => {
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
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

    const ctx = createMockContext();
    const input = reliefwebSearchTraining.input.parse({});
    const result = await reliefwebSearchTraining.handler(input, ctx);

    expect(result.items[0]).toMatchObject({ id: 1, title: 'Minimal Training' });
    expect(result.items[0].dateStart).toBeUndefined();
    expect(result.items[0].formats).toBeUndefined();
  });

  it('formats output completely', () => {
    const output = {
      items: [
        {
          id: 88888,
          title: 'WASH Training',
          sources: ['UNICEF'],
          formats: ['E-learning'],
          countries: ['Somalia'],
          careerCategories: ['Water Sanitation and Hygiene'],
          languages: ['en'],
          themes: ['Water Sanitation Hygiene'],
          dateStart: '2024-06-01T00:00:00+00:00',
          dateEnd: '2024-06-30T00:00:00+00:00',
          dateRegistration: '2024-05-15T00:00:00+00:00',
          urlAlias: 'https://reliefweb.int/training/test',
        },
      ],
      appliedFilters: {
        format: 'E-learning',
        sort: 'date.created:desc',
        limit: 10,
        offset: 0,
      },
    };
    const blocks = reliefwebSearchTraining.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Applied filters:');
    expect(text).toContain('88888');
    expect(text).toContain('WASH Training');
    expect(text).toContain('UNICEF');
    expect(text).toContain('E-learning');
    expect(text).toContain('2024-06-01');
    expect(text).toContain('2024-06-30');
  });
});
