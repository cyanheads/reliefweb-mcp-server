/**
 * @fileoverview Tests for the reliefweb_list_countries tool.
 * @module tests/tools/list-countries.tool.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebListCountries } from '@/mcp-server/tools/definitions/list-countries.tool.js';
import { contractError } from '../helpers/contract-error.js';

const mockListCountries = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ listCountries: mockListCountries }),
}));

describe('reliefwebListCountries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all countries by default', async () => {
    const items = [
      {
        id: 10001,
        name: 'Afghanistan',
        iso3: 'AFG',
        status: 'ongoing',
        urlAlias: 'https://reliefweb.int/country/afg',
      },
      {
        id: 10002,
        name: 'Syria',
        iso3: 'SYR',
        status: 'ongoing',
        urlAlias: 'https://reliefweb.int/country/syr',
      },
    ];
    mockListCountries.mockResolvedValue({ items, totalCount: 2 });

    const ctx = createMockContext({ errors: reliefwebListCountries.errors });
    const input = reliefwebListCountries.input.parse({});
    const result = await reliefwebListCountries.handler(input, ctx);

    expect(result.items).toHaveLength(2);
    expect(getEnrichment(ctx).totalCount).toBe(2);
  });

  it('applies default limit of 100', async () => {
    mockListCountries.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebListCountries.errors });
    const input = reliefwebListCountries.input.parse({});
    expect(input.limit).toBe(100);
    await reliefwebListCountries.handler(input, ctx);

    expect(mockListCountries).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }), ctx);
  });

  it('passes crisis_only filter when set', async () => {
    mockListCountries.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebListCountries.errors });
    const input = reliefwebListCountries.input.parse({ crisis_only: true });
    await reliefwebListCountries.handler(input, ctx);

    expect(mockListCountries).toHaveBeenCalledWith(
      expect.objectContaining({ crisisOnly: true }),
      ctx,
    );
  });

  it('populates notice enrichment when crisis_only returns no countries', async () => {
    mockListCountries.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebListCountries.errors });
    const input = reliefwebListCountries.input.parse({ crisis_only: true });
    const result = await reliefwebListCountries.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('crisis_only=true');
    expect(enrichment.notice).toContain('crisis_only=false');
  });

  it('does not populate notice when countries are returned', async () => {
    mockListCountries.mockResolvedValue({
      items: [{ id: 1, name: 'Afghanistan', iso3: 'AFG' }],
      totalCount: 1,
    });

    const ctx = createMockContext({ errors: reliefwebListCountries.errors });
    const input = reliefwebListCountries.input.parse({});
    await reliefwebListCountries.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  it('throws ctx.fail("upstream_error") when the service rejects', async () => {
    mockListCountries.mockRejectedValue(
      new McpError(JsonRpcErrorCode.ServiceUnavailable, 'ReliefWeb returned HTTP 502'),
    );

    const err = await contractError(reliefwebListCountries, {});
    expect(err.code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect(err.data).toMatchObject({ reason: 'upstream_error' });
    expect(err.data).toHaveProperty('recovery.hint');
    expect(err.data).not.toHaveProperty('cause');
  });

  it('handles sparse country without iso3 or status', async () => {
    const items = [{ id: 999, name: 'Minimal Country' }];
    mockListCountries.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext({ errors: reliefwebListCountries.errors });
    const input = reliefwebListCountries.input.parse({});
    const result = await reliefwebListCountries.handler(input, ctx);

    expect(result.items[0]).toMatchObject({ id: 999, name: 'Minimal Country' });
    expect(result.items[0]!.iso3).toBeUndefined();
  });

  it('formats output including id for each item', () => {
    const output = {
      items: [
        {
          id: 10001,
          name: 'Afghanistan',
          iso3: 'AFG',
          status: 'ongoing',
          urlAlias: 'https://reliefweb.int/country/afg',
        },
        { id: 10002, name: 'France', iso3: 'FRA' },
      ],
    };
    const blocks = reliefwebListCountries.format!(output);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('10001');
    expect(text).toContain('Afghanistan');
    expect(text).toContain('AFG');
    expect(text).toContain('10002');
    expect(text).toContain('France');
  });
});

// ─── Issue #20: rejected query vs service failure ────────────────────────────

describe('reliefwebListCountries — upstream error contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws ctx.fail("invalid_query") with the ReliefWeb message when the request is rejected', async () => {
    mockListCountries.mockRejectedValue(
      new McpError(JsonRpcErrorCode.InvalidParams, 'ReliefWeb returned HTTP 400.', {
        upstreamMessage: "Invalid filter field 'bogus'.",
      }),
    );

    const err = await contractError(reliefwebListCountries, {});

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(err.data).toMatchObject({ reason: 'invalid_query' });
    expect(err.message).toContain("Invalid filter field 'bogus'");
    expect(err.data?.recovery?.hint).toMatch(/correct the value/i);
    expect(err.data?.recovery?.hint).not.toMatch(/quota/i);
  });
});

// ─── Issue #22: paged past the end of a result set ───────────────────────────

describe('reliefwebListCountries — offset past the end of the result set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the offset and the last reachable page instead of calling the list empty', async () => {
    mockListCountries.mockResolvedValue({ items: [], totalCount: 296 });

    const ctx = createMockContext({ errors: reliefwebListCountries.errors });
    const input = reliefwebListCountries.input.parse({ offset: 5000, limit: 100 });
    await reliefwebListCountries.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('5000');
    expect(notice).toContain('296');
    expect(notice).toContain('offset 200');
    expect(notice).not.toMatch(/unfiltered zero-match/i);
  });

  it('reports an offset past the end even when crisis_only narrowed the list', async () => {
    mockListCountries.mockResolvedValue({ items: [], totalCount: 34 });

    const ctx = createMockContext({ errors: reliefwebListCountries.errors });
    const input = reliefwebListCountries.input.parse({
      crisis_only: true,
      offset: 500,
      limit: 10,
    });
    await reliefwebListCountries.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('offset 30');
    expect(notice).not.toContain('crisis_only=false');
  });

  it('keeps the zero-match notice when the filter genuinely matched nothing', async () => {
    mockListCountries.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebListCountries.errors });
    const input = reliefwebListCountries.input.parse({ crisis_only: true, offset: 5000 });
    await reliefwebListCountries.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('crisis_only=false');
    expect(notice).not.toContain('past the end');
  });
});

// ─── Issue #43: look up a country by name ────────────────────────────────────

describe('reliefwebListCountries — text lookup', () => {
  const SYRIA = {
    id: 226,
    name: 'Syrian Arab Republic',
    iso3: 'SYR',
    status: 'ongoing',
    urlAlias: 'https://reliefweb.int/country/syr',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends no text and echoes no query when text is absent', async () => {
    mockListCountries.mockResolvedValue({ items: [SYRIA], totalCount: 248 });
    const result = await runToolContract(reliefwebListCountries, {});
    expect(mockListCountries.mock.lastCall?.[0]).not.toHaveProperty('text');
    expect(result.structuredContent).not.toHaveProperty('effectiveQuery');
  });

  it('sends the name and echoes it on both surfaces', async () => {
    mockListCountries.mockResolvedValue({ items: [SYRIA], totalCount: 1 });
    const result = await runToolContract(reliefwebListCountries, { text: ' Syria ' });
    expect(mockListCountries.mock.lastCall?.[0]).toMatchObject({ text: 'Syria' });
    expect(result.structuredContent).toMatchObject({
      items: [{ iso3: 'SYR' }],
      effectiveQuery: 'Syria',
    });
    expect(JSON.stringify(result.content)).toContain('`Syria`');
    expect(JSON.stringify(result.content)).toContain('(SYR)');
  });

  it.each(['', '   '])('treats text %j as omitted', async (text) => {
    mockListCountries.mockResolvedValue({ items: [SYRIA], totalCount: 248 });
    const result = await runToolContract(reliefwebListCountries, { text });
    expect(mockListCountries.mock.lastCall?.[0]).not.toHaveProperty('text');
    expect(result.structuredContent).not.toHaveProperty('effectiveQuery');
  });

  it('combines text with crisis_only, limit, and offset', async () => {
    mockListCountries.mockResolvedValue({ items: [SYRIA], totalCount: 2 });
    await runToolContract(reliefwebListCountries, {
      text: 'Congo',
      crisis_only: true,
      limit: 1,
      offset: 1,
    });
    expect(mockListCountries.mock.lastCall?.[0]).toEqual({
      text: 'Congo',
      crisisOnly: true,
      limit: 1,
      offset: 1,
    });
  });

  it('says no country name or short name matched, naming each filter, on both surfaces', async () => {
    mockListCountries.mockResolvedValue({ items: [], totalCount: 0 });
    const result = await runToolContract(reliefwebListCountries, {
      text: 'Ivory Coast',
      crisis_only: true,
    });
    for (const text of [JSON.stringify(result.structuredContent), JSON.stringify(result.content)]) {
      expect(text).toContain('Ivory Coast');
      expect(text).toContain('crisis_only=true');
      expect(text).toMatch(/no ReliefWeb country name or short name matched/i);
    }
  });

  it('leaves crisis_only out of the no-match notice when the caller did not set it', async () => {
    mockListCountries.mockResolvedValue({ items: [], totalCount: 0 });
    const result = await runToolContract(reliefwebListCountries, { text: 'Ivory Coast' });
    const { notice } = z.object({ notice: z.string() }).parse(result.structuredContent);
    expect(notice).toMatch(/no ReliefWeb country name or short name matched text="Ivory Coast"\./i);
    expect(notice).toContain('one distinctive word of it or list without text');
    for (const text of [notice, JSON.stringify(result.content)]) {
      expect(text).not.toContain('crisis_only');
    }
  });

  it('keeps the past-the-end notice when a text match is paged beyond', async () => {
    mockListCountries.mockResolvedValue({ items: [], totalCount: 2 });
    const result = await runToolContract(reliefwebListCountries, { text: 'Congo', offset: 10 });
    expect(JSON.stringify(result.structuredContent)).toContain('past the end');
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/no ReliefWeb country name/i);
  });

  it('carries the malformed-text recovery on invalid_query', async () => {
    mockListCountries.mockRejectedValue(
      new McpError(JsonRpcErrorCode.InvalidParams, 'ReliefWeb returned HTTP 400.', {
        upstreamMessage: 'Malformed query.',
      }),
    );
    const err = await contractError(reliefwebListCountries, { text: 'Syria (' });
    expect(err.data).toMatchObject({ reason: 'invalid_query' });
    expect(err.data?.recovery?.hint).toMatch(/malformed text/i);
  });
});
