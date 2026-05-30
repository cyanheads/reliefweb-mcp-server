/**
 * @fileoverview Tests for the reliefweb://reports/{id} resource.
 * @module tests/resources/report.resource.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// validationError() uses JsonRpcErrorCode.ValidationError (-32007), not InvalidParams (-32602)
const VALIDATION_CODE = JsonRpcErrorCode.ValidationError;

import { reportResource } from '@/mcp-server/resources/definitions/report.resource.js';

const mockGetReport = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ getReport: mockGetReport }),
}));

describe('reportResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full report for valid numeric ID', async () => {
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

    const ctx = createMockContext({ uri: new URL('reliefweb://reports/1234567') });
    const result = await reportResource.handler({ id: '1234567' }, ctx);

    expect(result).toMatchObject({ id: 1234567, title: 'Syria Flash Update' });
    expect(mockGetReport).toHaveBeenCalledWith(1234567, ctx);
  });

  it('parses string ID to integer for service call', async () => {
    mockGetReport.mockResolvedValue({ id: 42, title: 'Test Report' });

    const ctx = createMockContext({ uri: new URL('reliefweb://reports/42') });
    await reportResource.handler({ id: '42' }, ctx);

    expect(mockGetReport).toHaveBeenCalledWith(42, ctx);
  });

  it('throws ValidationError for non-numeric ID', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/abc') });

    await expect(reportResource.handler({ id: 'abc' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it('throws ValidationError for zero ID', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/0') });

    await expect(reportResource.handler({ id: '0' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it('throws ValidationError for negative ID', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/-5') });

    await expect(reportResource.handler({ id: '-5' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it('throws NotFound when report does not exist', async () => {
    mockGetReport.mockResolvedValue(null);

    const ctx = createMockContext({ uri: new URL('reliefweb://reports/9999999') });

    await expect(reportResource.handler({ id: '9999999' }, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('handles sparse report without body or optional fields', async () => {
    mockGetReport.mockResolvedValue({ id: 111, title: 'Binary-only Report' });

    const ctx = createMockContext({ uri: new URL('reliefweb://reports/111') });
    const result = await reportResource.handler({ id: '111' }, ctx);

    expect(result).toMatchObject({ id: 111, title: 'Binary-only Report' });
  });

  it('does not expose API keys or secrets in error messages', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/notanumber') });

    try {
      await reportResource.handler({ id: 'notanumber' }, ctx);
      expect.fail('should have thrown');
    } catch (err: unknown) {
      const message = String((err as { message?: string }).message ?? err);
      expect(message).not.toMatch(/api[_-]?key/i);
      expect(message).not.toMatch(/token/i);
      expect(message).not.toMatch(/secret/i);
      expect(message).not.toMatch(/password/i);
    }
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it('rejects path-traversal and injection-style ID strings', async () => {
    const injectionAttempts = [
      '../etc/passwd',
      '../../secrets',
      '; DROP TABLE reports',
      '<script>alert(1)</script>',
    ];

    for (const attempt of injectionAttempts) {
      const ctx = createMockContext({ uri: new URL('reliefweb://reports/x') });
      await expect(reportResource.handler({ id: attempt }, ctx)).rejects.toMatchObject({
        code: VALIDATION_CODE,
      });
    }
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it('handles oversized ID string gracefully', async () => {
    const oversized = '9'.repeat(1000);
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/x') });

    // parseInt on a very large number string may produce Infinity or a large int
    // The handler either calls service with a huge number or rejects — either way it should not crash
    mockGetReport.mockResolvedValue(null);
    // If it doesn't throw ValidationError, it throws NotFound (parsed as big int, not found)
    await expect(reportResource.handler({ id: oversized }, ctx)).rejects.toBeDefined();
  });
});
