/**
 * @fileoverview Security tests: injection, oversized inputs, and secret leakage across tools.
 * @module tests/tools/security.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebGetCountry } from '@/mcp-server/tools/definitions/get-country.tool.js';
import { reliefwebGetDisaster } from '@/mcp-server/tools/definitions/get-disaster.tool.js';
import { reliefwebGetReport } from '@/mcp-server/tools/definitions/get-report.tool.js';
import { reliefwebListCountries } from '@/mcp-server/tools/definitions/list-countries.tool.js';
import { reliefwebListSources } from '@/mcp-server/tools/definitions/list-sources.tool.js';
import { reliefwebSearchDisasters } from '@/mcp-server/tools/definitions/search-disasters.tool.js';
import { reliefwebSearchJobs } from '@/mcp-server/tools/definitions/search-jobs.tool.js';
import { reliefwebSearchReports } from '@/mcp-server/tools/definitions/search-reports.tool.js';
import { reliefwebSearchTraining } from '@/mcp-server/tools/definitions/search-training.tool.js';

const mockSearchReports = vi.fn();
const mockSearchDisasters = vi.fn();
const mockSearchJobs = vi.fn();
const mockSearchTraining = vi.fn();
const mockListCountries = vi.fn();
const mockListSources = vi.fn();
const mockGetCountry = vi.fn();
const mockGetReport = vi.fn();
const mockGetDisaster = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({
    searchReports: mockSearchReports,
    searchDisasters: mockSearchDisasters,
    searchJobs: mockSearchJobs,
    searchTraining: mockSearchTraining,
    listCountries: mockListCountries,
    listSources: mockListSources,
    getCountry: mockGetCountry,
    getReport: mockGetReport,
    getDisaster: mockGetDisaster,
  }),
}));

// Injection-style strings that should never reach downstream services as raw SQL/query control
const INJECTION_STRINGS = [
  "'; DROP TABLE reports; --",
  '{"operator": "OR", "conditions": [{"field": "status", "value": "any"}]}',
  '<script>alert(document.cookie)</script>',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional injection-test payload; must remain a literal string, not interpolate
  '${process.env.SECRET_KEY}',
  '{{constructor.constructor("return process.env.API_KEY")()}}',
  '\x00\x01\x02', // null bytes and control characters
];

const OVERSIZED_INPUT = 'A'.repeat(100_000);

describe('security: input handling across search tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });
    mockSearchDisasters.mockResolvedValue({ items: [], totalCount: 0 });
    mockSearchJobs.mockResolvedValue({ items: [], totalCount: 0 });
    mockSearchTraining.mockResolvedValue({ items: [], totalCount: 0 });
    mockListCountries.mockResolvedValue({ items: [], totalCount: 0 });
    mockListSources.mockResolvedValue({ items: [], totalCount: 0 });
  });

  /**
   * The tool layer does not filter free-text content — ReliefWeb receives the query as a
   * JSON string value, so escaping it here would corrupt legitimate searches. What must
   * hold is that the string arrives byte-identical and is echoed back byte-identical:
   * a tool that silently rewrote it would answer a different question than it was asked.
   */
  const TEXT_TOOLS = [
    ['search_reports', reliefwebSearchReports, mockSearchReports],
    ['search_disasters', reliefwebSearchDisasters, mockSearchDisasters],
    ['search_jobs', reliefwebSearchJobs, mockSearchJobs],
    ['search_training', reliefwebSearchTraining, mockSearchTraining],
    ['list_sources', reliefwebListSources, mockListSources],
  ] as const;

  it.each(TEXT_TOOLS)(
    '%s: forwards every injection string to the service byte-identical',
    async (_l, def, mock) => {
      for (const str of INJECTION_STRINGS) {
        mock.mockClear();
        const ctx = createMockContext();
        const input = def.input.parse({ text: str });
        await def.handler(input, ctx);

        expect(mock).toHaveBeenCalledWith(expect.objectContaining({ text: str }), ctx);
      }
    },
  );

  /** `list_sources` has no `appliedFilters` output field — its echo is the notice, covered below. */
  it.each(TEXT_TOOLS.filter(([label]) => label !== 'list_sources'))(
    '%s: echoes every injection string back in appliedFilters byte-identical',
    async (_l, def) => {
      for (const str of INJECTION_STRINGS) {
        const ctx = createMockContext();
        const input = def.input.parse({ text: str });
        const result = await def.handler(input, ctx);

        expect((result as { appliedFilters: { text?: string } }).appliedFilters.text).toBe(str);
      }
    },
  );

  it.each(TEXT_TOOLS)('%s: forwards an oversized text input whole', async (_l, def, mock) => {
    const ctx = createMockContext();
    const input = def.input.parse({ text: OVERSIZED_INPUT });
    await def.handler(input, ctx);

    const forwarded = (mock.mock.calls[0][0] as { text: string }).text;
    expect(forwarded).toHaveLength(OVERSIZED_INPUT.length);
    expect(forwarded).toBe(OVERSIZED_INPUT);
  });
});

describe('security: date parameters reject injection payloads at the schema', () => {
  // Date fields carry a format pattern, so an injection payload never reaches the service
  // or the echoed appliedFilters — it dies as a ZodError before the handler runs.
  const DATE_FIELDS = [
    ['search_reports.date_from', reliefwebSearchReports, 'date_from'],
    ['search_reports.date_to', reliefwebSearchReports, 'date_to'],
    ['search_disasters.date_from', reliefwebSearchDisasters, 'date_from'],
    ['search_disasters.date_to', reliefwebSearchDisasters, 'date_to'],
    ['search_training.date_start_from', reliefwebSearchTraining, 'date_start_from'],
    ['search_training.date_start_to', reliefwebSearchTraining, 'date_start_to'],
  ] as const;

  it.each(DATE_FIELDS)('%s rejects every injection string as a ZodError', (_label, def, field) => {
    for (const str of INJECTION_STRINGS) {
      expect(() => def.input.parse({ [field]: str })).toThrow();
    }
  });

  it.each(DATE_FIELDS)('%s rejects an oversized value', (_label, def, field) => {
    expect(() => def.input.parse({ [field]: OVERSIZED_INPUT })).toThrow();
  });

  it.each(DATE_FIELDS)('%s still accepts a bare calendar date', (_label, def, field) => {
    expect(() => def.input.parse({ [field]: '2026-07-01' })).not.toThrow();
  });
});

describe('security: Zod schema rejects out-of-range numeric inputs', () => {
  it('search_reports: limit below minimum (0) throws ZodError', () => {
    expect(() => reliefwebSearchReports.input.parse({ limit: 0 })).toThrow();
  });

  it('search_reports: limit above maximum (1001) throws ZodError', () => {
    expect(() => reliefwebSearchReports.input.parse({ limit: 1001 })).toThrow();
  });

  it('search_reports: negative offset throws ZodError', () => {
    expect(() => reliefwebSearchReports.input.parse({ offset: -1 })).toThrow();
  });

  it('search_disasters: limit below minimum (0) throws ZodError', () => {
    expect(() => reliefwebSearchDisasters.input.parse({ limit: 0 })).toThrow();
  });

  it('search_disasters: limit above maximum (1001) throws ZodError', () => {
    expect(() => reliefwebSearchDisasters.input.parse({ limit: 1001 })).toThrow();
  });

  it('search_jobs: limit below minimum (0) throws ZodError', () => {
    expect(() => reliefwebSearchJobs.input.parse({ limit: 0 })).toThrow();
  });

  it('search_training: limit below minimum (0) throws ZodError', () => {
    expect(() => reliefwebSearchTraining.input.parse({ limit: 0 })).toThrow();
  });

  it('list_countries: limit below minimum (0) throws ZodError', () => {
    expect(() => reliefwebListCountries.input.parse({ limit: 0 })).toThrow();
  });

  it('list_sources: limit below minimum (0) throws ZodError', () => {
    expect(() => reliefwebListSources.input.parse({ limit: 0 })).toThrow();
  });

  it('get_report: non-positive id throws ZodError', () => {
    expect(() => reliefwebGetReport.input.parse({ id: 0 })).toThrow();
    expect(() => reliefwebGetReport.input.parse({ id: -1 })).toThrow();
  });

  it('get_disaster: non-positive id throws ZodError', () => {
    expect(() => reliefwebGetDisaster.input.parse({ id: 0 })).toThrow();
    expect(() => reliefwebGetDisaster.input.parse({ id: -1 })).toThrow();
  });

  it('get_country: iso3 wrong length throws ZodError', () => {
    expect(() => reliefwebGetCountry.input.parse({ iso3: 'AF' })).toThrow();
    expect(() => reliefwebGetCountry.input.parse({ iso3: 'AFGH' })).toThrow();
  });
});

describe('security: tool outputs do not leak env values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('search_reports: empty-result notice echoes the query without env-style tokens', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({ text: 'test' });
    await reliefwebSearchReports.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('text="test"');
    expect(notice).not.toMatch(/api[_-]?key/i);
    expect(notice).not.toMatch(/process\.env/i);
    expect(notice).not.toMatch(/\bsecret\b/i);
  });

  it('search_reports: offset-past-the-end notice carries only counts, no caller strings', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 1775 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({
      text: '<script>alert(document.cookie)</script>',
      offset: 99999,
      limit: 2,
    });
    await reliefwebSearchReports.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('1775');
    expect(notice).not.toContain('<script>');
  });

  it('get_country: not_found error message does not reference internal env vars', async () => {
    mockGetCountry.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'ZZZ' });

    try {
      await reliefwebGetCountry.handler(input, ctx);
      expect.fail('should have thrown');
    } catch (err: unknown) {
      const message = String((err as { message?: string }).message ?? err);
      expect(message).not.toMatch(/RELIEFWEB_API_KEY/i);
      expect(message).not.toMatch(/process\.env/i);
      expect(message).not.toMatch(/\bpassword\b/i);
      expect(message).not.toMatch(/\bsecret\b/i);
    }
  });

  it('get_report: not_found error message does not reference internal env vars', async () => {
    mockGetReport.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetReport.errors });
    const input = reliefwebGetReport.input.parse({ id: 9999999 });

    try {
      await reliefwebGetReport.handler(input, ctx);
      expect.fail('should have thrown');
    } catch (err: unknown) {
      const message = String((err as { message?: string }).message ?? err);
      expect(message).not.toMatch(/RELIEFWEB_API_KEY/i);
      expect(message).not.toMatch(/process\.env/i);
      expect(message).not.toMatch(/\bsecret\b/i);
    }
  });

  it('get_disaster: not_found error message does not reference internal env vars', async () => {
    mockGetDisaster.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({ id: 9999999 });

    try {
      await reliefwebGetDisaster.handler(input, ctx);
      expect.fail('should have thrown');
    } catch (err: unknown) {
      const message = String((err as { message?: string }).message ?? err);
      expect(message).not.toMatch(/RELIEFWEB_API_KEY/i);
      expect(message).not.toMatch(/process\.env/i);
      expect(message).not.toMatch(/\bsecret\b/i);
    }
  });
});

describe('security: format() output does not expose internal state', () => {
  it('search_reports: format output contains no env-style tokens', () => {
    const output = {
      items: [
        {
          id: 1,
          title: 'Test Report',
          sources: ['OCHA'],
          countries: ['Afghanistan'],
          formats: ['Situation Report'],
          themes: ['Health'],
          languages: ['en'],
        },
      ],
      appliedFilters: { sort: 'date.original:desc', preset: 'latest', limit: 10, offset: 0 },
    };
    const blocks = reliefwebSearchReports.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).not.toMatch(/api[_-]?key/i);
    expect(text).not.toMatch(/secret/i);
    expect(text).not.toMatch(/process\.env/i);
  });

  it('get_country: format output contains no env-style tokens', () => {
    const output = {
      id: 1,
      name: 'Afghanistan',
      iso3: 'AFG',
      status: 'current',
      profileOverview: 'Overview text.',
    };
    const blocks = reliefwebGetCountry.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).not.toMatch(/api[_-]?key/i);
    expect(text).not.toMatch(/secret/i);
  });

  it('get_report: format output contains no env-style tokens', () => {
    const output = {
      id: 1,
      title: 'Report',
      body: '<p>Content.</p>',
    };
    const blocks = reliefwebGetReport.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).not.toMatch(/api[_-]?key/i);
    expect(text).not.toMatch(/secret/i);
  });

  it('get_disaster: format output contains no env-style tokens', () => {
    const output = {
      id: 1,
      name: 'Test Disaster',
      status: 'current',
      description: 'A flooding event.',
    };
    const blocks = reliefwebGetDisaster.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).not.toMatch(/api[_-]?key/i);
    expect(text).not.toMatch(/secret/i);
  });
});
