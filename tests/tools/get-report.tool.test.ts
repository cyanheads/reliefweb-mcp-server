/**
 * @fileoverview Tests for the reliefweb_get_report tool.
 * @module tests/tools/get-report.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebGetReport } from '@/mcp-server/tools/definitions/get-report.tool.js';

const mockGetReport = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ getReport: mockGetReport }),
}));

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

    expect(result).toMatchObject({ id: 1234567, title: 'Syria Flash Update' });
    expect(result.body).toBe('<p>Full body content here.</p>');
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
    expect(result.body).toBeUndefined();
  });

  it('formats output including dateCreated and id', () => {
    const output = {
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
    const blocks = reliefwebGetReport.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('1234567');
    expect(text).toContain('Full Report');
    expect(text).toContain('2024-01-15');
    expect(text).toContain('2024-01-16');
    expect(text).toContain('Afghanistan');
    expect(text).toContain('UNHCR');
    expect(text).toContain('Full content.');
  });

  it('formats sparse report without body gracefully', () => {
    const output = { id: 999, title: 'No Body' };
    const blocks = reliefwebGetReport.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('999');
    expect(text).toContain('No Body');
    expect(text).not.toContain('undefined');
  });
});
