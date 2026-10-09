/**
 * @fileoverview Tests for the reliefweb_get_report tool.
 * @module tests/tools/get-report.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebGetReport } from '@/mcp-server/tools/definitions/get-report.tool.js';
import { contractError } from '../helpers/contract-error.js';

const mockGetReport = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ getReport: mockGetReport }),
}));

/** Over the 24,000-byte outline budget, across two sections that both survive selection. */
function oversizedReport() {
  return {
    id: 1234567,
    title: 'Syria Flash Update',
    dateOriginal: '2024-03-15T00:00:00+00:00',
    urlAlias: 'https://reliefweb.int/report/syrian-arab-republic/test',
    headlineSummary: 'Situation deteriorating.',
    body: 'b'.repeat(30_000),
  };
}

function textOf(blocks: ReturnType<NonNullable<typeof reliefwebGetReport.format>>): string {
  return blocks.map((b) => (b as { text?: string }).text ?? '').join('\n');
}

describe('reliefwebGetReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full report data on success', async () => {
    const report = {
      id: 1234567,
      title: 'Syria Flash Update',
      dateOriginal: '2024-03-15T00:00:00+00:00',
      dateCreated: '2024-03-16T00:00:00+00:00',
      primaryCountry: 'Syrian Arab Republic',
      countries: ['Syrian Arab Republic'],
      sources: ['OCHA'],
      formats: ['Situation Report'],
      themes: ['Refugees and Internally Displaced Persons'],
      languages: ['en'],
      urlAlias: 'https://reliefweb.int/report/syrian-arab-republic/test',
      body: '<p>Full body content here.</p>',
    };
    mockGetReport.mockResolvedValue(report);

    const ctx = createMockContext({ errors: reliefwebGetReport.errors });
    const input = reliefwebGetReport.input.parse({ id: 1234567 });
    const result = await reliefwebGetReport.handler(input, ctx);

    expect(result).toMatchObject({ kind: 'full', id: 1234567, title: 'Syria Flash Update' });
    expect(result.body).toBe('<p>Full body content here.</p>');
    expect(result.sections).toBeUndefined();
  });

  it('outlines every section with its real byte size when the record is over budget', async () => {
    const report = oversizedReport();
    mockGetReport.mockResolvedValue(report);

    const ctx = createMockContext({ errors: reliefwebGetReport.errors });
    const input = reliefwebGetReport.input.parse({ id: 1234567 });
    const result = await reliefwebGetReport.handler(input, ctx);

    expect(result.kind).toBe('outline');
    expect(result.body).toBeUndefined();

    const names = result.sections?.map((s) => s.name);
    expect(names?.slice().sort()).toEqual(Object.keys(report).sort());
    // Largest first, and each size is the section's own serialized length.
    expect(names?.[0]).toBe('body');
    for (const section of result.sections ?? []) {
      const value = report[section.name as keyof typeof report];
      expect(section.bytes).toBe(JSON.stringify(value).length);
    }
    expect(result.outlineNotice).toMatch(/sections:\[\.\.\.\]/);
  });

  it('returns exactly the sections asked for plus identity metadata', async () => {
    mockGetReport.mockResolvedValue(oversizedReport());

    const ctx = createMockContext({ errors: reliefwebGetReport.errors });
    const input = reliefwebGetReport.input.parse({ id: 1234567, sections: ['headlineSummary'] });
    const result = await reliefwebGetReport.handler(input, ctx);

    expect(Object.keys(result).sort()).toEqual(
      ['headlineSummary', 'id', 'kind', 'title', 'urlAlias'].sort(),
    );
    expect(result.kind).toBe('full');
    expect(result.headlineSummary).toBe('Situation deteriorating.');
    expect(result.body).toBeUndefined();
  });

  it('honours a sections selection that names the oversized body', async () => {
    mockGetReport.mockResolvedValue(oversizedReport());

    const ctx = createMockContext({ errors: reliefwebGetReport.errors });
    const input = reliefwebGetReport.input.parse({ id: 1234567, sections: ['body'] });
    const result = await reliefwebGetReport.handler(input, ctx);

    expect(result.body).toHaveLength(30_000);
    expect(result.dateOriginal).toBeUndefined();
  });

  it('rejects a section this record does not carry and names the ones it does', async () => {
    mockGetReport.mockResolvedValue({
      id: 1234567,
      title: 'Binary-only map',
      urlAlias: 'https://reliefweb.int/map/test',
      fileUrls: ['https://reliefweb.int/attachments/map.pdf'],
    });

    const err = await contractError(reliefwebGetReport, { id: 1234567, sections: ['body'] });

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(err.message).toContain('Unknown section: body.');
    expect(err.message).toContain('Available sections: id, title, urlAlias, fileUrls.');
    expect(err.data).toMatchObject({
      unmatched: ['body'],
      available: ['id', 'title', 'urlAlias', 'fileUrls'],
    });
  });

  it('throws not_found when report does not exist', async () => {
    mockGetReport.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetReport.errors });
    const input = reliefwebGetReport.input.parse({ id: 9999999 });

    await expect(reliefwebGetReport.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('handles sparse report without body', async () => {
    const report = { id: 111, title: 'Binary-only Report' };
    mockGetReport.mockResolvedValue(report);

    const ctx = createMockContext({ errors: reliefwebGetReport.errors });
    const input = reliefwebGetReport.input.parse({ id: 111 });
    const result = await reliefwebGetReport.handler(input, ctx);

    expect(result.id).toBe(111);
    expect(result.kind).toBe('full');
    expect(result.body).toBeUndefined();
  });

  it('formats output including dateCreated and id', () => {
    const output = {
      kind: 'full' as const,
      id: 1234567,
      title: 'Full Report',
      dateOriginal: '2024-01-15T00:00:00+00:00',
      dateCreated: '2024-01-16T00:00:00+00:00',
      primaryCountry: 'Afghanistan',
      countries: ['Afghanistan'],
      sources: ['UNHCR'],
      formats: ['Assessment'],
      themes: ['Health'],
      languages: ['en'],
      urlAlias: 'https://reliefweb.int/report/afghanistan/test',
      fileUrls: ['https://example.com/doc.pdf'],
      headlineSummary: 'Situation deteriorating.',
      body: '<p>Full content.</p>',
    };
    const text = textOf(reliefwebGetReport.format!(output));
    expect(text).toContain('1234567');
    expect(text).toContain('Full Report');
    expect(text).toContain('2024-01-15');
    expect(text).toContain('2024-01-16');
    expect(text).toContain('Afghanistan');
    expect(text).toContain('UNHCR');
    expect(text).toContain('Full content.');
    expect(text).toContain('**Mode:** full');
  });

  it('renders every outline field into content[] so it matches structuredContent', () => {
    const output = {
      kind: 'outline' as const,
      sections: [
        { name: 'body', bytes: 30_002 },
        { name: 'title', bytes: 20 },
      ],
      outlineNotice: 'Re-call with sections:[...] — e.g. body, title.',
    };
    const text = textOf(reliefwebGetReport.format!(output));
    expect(text).toContain('**Mode:** outline');
    expect(text).toContain('body');
    expect(text).toContain('30002');
    expect(text).toContain('title');
    expect(text).toContain('20');
    expect(text).toContain(output.outlineNotice);
  });

  it('formats sparse report without body gracefully', () => {
    const output = { kind: 'full' as const, id: 999, title: 'No Body' };
    const text = textOf(reliefwebGetReport.format!(output));
    expect(text).toContain('999');
    expect(text).toContain('No Body');
    expect(text).not.toContain('undefined');
  });
});
