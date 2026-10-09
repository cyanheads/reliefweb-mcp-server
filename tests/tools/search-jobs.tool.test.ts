/**
 * @fileoverview Tests for the reliefweb_search_jobs tool.
 * @module tests/tools/search-jobs.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebSearchJobs } from '@/mcp-server/tools/definitions/search-jobs.tool.js';
import { contractError } from '../helpers/contract-error.js';

const mockSearchJobs = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ searchJobs: mockSearchJobs }),
}));

describe('reliefwebSearchJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns job listings on success', async () => {
    const items = [
      {
        id: 77777,
        title: 'Emergency Response Officer',
        dateCreated: '2024-03-01T00:00:00+00:00',
        dateClosing: '2024-04-01T00:00:00+00:00',
        sources: ['OCHA'],
        countries: ['Afghanistan'],
        themes: ['Coordination'],
        types: ['International'],
        careerCategories: ['Programme and Project Management'],
        experienceLevels: ['5-9 years'],
        urlAlias: 'https://reliefweb.int/job/test',
      },
    ];
    mockSearchJobs.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({
      career_category: 'Programme and Project Management',
    });
    const result = await reliefwebSearchJobs.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 77777, title: 'Emergency Response Officer' });
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('populates notice enrichment when no jobs match', async () => {
    mockSearchJobs.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({
      text: 'zzznomatch',
      country: 'ZZZ',
      career_category: 'Nonexistent',
    });
    const result = await reliefwebSearchJobs.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('zzznomatch');
  });

  it('empty-result notice echoes source, theme, and experience filters', async () => {
    mockSearchJobs.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({
      source: 'UNHCR',
      theme: 'Protection',
      experience: '5-9 years',
    });
    await reliefwebSearchJobs.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('source="UNHCR"');
    expect(notice).toContain('theme="Protection"');
    expect(notice).toContain('experience="5-9 years"');
  });

  it('echoes appliedFilters with normalized country and resolved sort', async () => {
    mockSearchJobs.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({ country: 'ken', source: 'WFP', limit: 20 });
    const result = await reliefwebSearchJobs.handler(input, ctx);

    expect(result.appliedFilters).toMatchObject({
      country: 'KEN',
      source: 'WFP',
      sort: 'date.created:desc',
      limit: 20,
      offset: 0,
    });
  });

  it('threads an explicit sort into the service call and echoes it in appliedFilters', async () => {
    mockSearchJobs.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({ sort: 'date.closing:asc' });
    const result = await reliefwebSearchJobs.handler(input, ctx);

    expect(mockSearchJobs).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'date.closing:asc' }),
      ctx,
    );
    expect(result.appliedFilters.sort).toBe('date.closing:asc');
  });

  it('throws ctx.fail("upstream_error") when the service rejects', async () => {
    mockSearchJobs.mockRejectedValue(
      new McpError(JsonRpcErrorCode.ServiceUnavailable, 'ReliefWeb returned HTTP 503'),
    );

    const err = await contractError(reliefwebSearchJobs, { text: 'officer' });
    expect(err.code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect(err.data).toMatchObject({ reason: 'upstream_error' });
    expect(err.data).toHaveProperty('recovery.hint');
    expect(err.data).not.toHaveProperty('cause');
  });

  it('normalizes country code to uppercase', async () => {
    mockSearchJobs.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({ country: 'afg' });
    await reliefwebSearchJobs.handler(input, ctx);

    expect(mockSearchJobs).toHaveBeenCalledWith(expect.objectContaining({ country: 'AFG' }), ctx);
  });

  it('handles sparse job listing without optional fields', async () => {
    const items = [{ id: 1, title: 'Minimal Job' }];
    mockSearchJobs.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({});
    const result = await reliefwebSearchJobs.handler(input, ctx);

    expect(result.items[0]).toMatchObject({ id: 1, title: 'Minimal Job' });
    expect(result.items[0]!.sources).toBeUndefined();
  });

  it('formats output completely', () => {
    const output = {
      items: [
        {
          id: 77777,
          title: 'Field Coordinator',
          sources: ['WFP'],
          countries: ['Kenya'],
          careerCategories: ['Logistics and Telecommunications'],
          experienceLevels: ['3-4 years'],
          themes: ['Food and Nutrition'],
          types: ['International'],
          dateCreated: '2024-03-01T00:00:00+00:00',
          dateClosing: '2024-04-01T00:00:00+00:00',
          urlAlias: 'https://reliefweb.int/job/test',
        },
      ],
      appliedFilters: {
        careerCategory: 'Logistics and Telecommunications',
        sort: 'date.created:desc',
        preset: 'latest',
        limit: 10,
        offset: 0,
      },
    };
    const blocks = reliefwebSearchJobs.format!(output);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Applied filters:');
    expect(text).toContain('preset=latest');
    expect(text).toContain('77777');
    expect(text).toContain('Field Coordinator');
    expect(text).toContain('WFP');
    expect(text).toContain('Kenya');
    expect(text).toContain('2024-03-01');
    expect(text).toContain('2024-04-01');
  });
});

// ─── Issue #20: rejected query vs service failure ────────────────────────────

describe('reliefwebSearchJobs — upstream error contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws ctx.fail("invalid_query") with the ReliefWeb message when the query is rejected', async () => {
    mockSearchJobs.mockRejectedValue(
      new McpError(JsonRpcErrorCode.InvalidParams, 'ReliefWeb returned HTTP 400.', {
        upstreamMessage: "Unrecognized sort field 'bogus.field'.",
      }),
    );

    const err = await contractError(reliefwebSearchJobs, { sort: 'bogus.field:desc' });

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(err.data).toMatchObject({ reason: 'invalid_query' });
    expect(err.message).toContain("Unrecognized sort field 'bogus.field'");
    expect(err.data?.recovery?.hint).toMatch(/correct the value/i);
    expect(err.data?.recovery?.hint).not.toMatch(/quota/i);
  });
});

// ─── Issue #22: paged past the end of a result set ───────────────────────────

describe('reliefwebSearchJobs — offset past the end of the result set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the offset and the last reachable page instead of claiming no matches', async () => {
    mockSearchJobs.mockResolvedValue({ items: [], totalCount: 640 });

    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({ offset: 9000, limit: 20 });
    await reliefwebSearchJobs.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('9000');
    expect(notice).toContain('640');
    expect(notice).toContain('offset 620');
    expect(notice).not.toContain('No jobs matched');
  });

  it('keeps the broaden-your-search notice when nothing actually matched', async () => {
    mockSearchJobs.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({ offset: 9000 });
    await reliefwebSearchJobs.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toContain('No jobs matched');
  });
});

// ─── Issue #18: include_archived reaches the expired-postings archive ─────────

describe('reliefwebSearchJobs — include_archived', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchJobs.mockResolvedValue({ items: [], totalCount: 0 });
  });

  it('sends preset=analysis to the service and echoes it on both surfaces', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({ country: 'KEN', include_archived: true });
    const result = await reliefwebSearchJobs.handler(input, ctx);

    expect(mockSearchJobs).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: true }),
      ctx,
    );
    expect(result.appliedFilters.preset).toBe('analysis');
    const text = (reliefwebSearchJobs.format!(result)[0] as { text: string }).text;
    expect(text).toContain('preset=analysis');
  });

  it('defaults to the open-postings preset when the flag is absent', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({ country: 'KEN' });
    const result = await reliefwebSearchJobs.handler(input, ctx);

    const params = mockSearchJobs.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('includeArchived');
    expect(result.appliedFilters.preset).toBe('latest');
    const text = (reliefwebSearchJobs.format!(result)[0] as { text: string }).text;
    expect(text).toContain('preset=latest');
  });

  it('offers the archive in the empty-result notice', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchJobs.errors });
    const input = reliefwebSearchJobs.input.parse({ country: 'KEN' });
    await reliefwebSearchJobs.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toContain('include_archived=true');
  });
});
