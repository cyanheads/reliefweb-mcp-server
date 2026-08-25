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

  it('rejects an ID with trailing junk instead of serving the numeric prefix', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/4221539junk') });

    await expect(reportResource.handler({ id: '4221539junk' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it('throws ValidationError for a float ID string', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/1.5') });

    await expect(reportResource.handler({ id: '1.5' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it('rejects scientific notation rather than reading its leading digit', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/1e3') });

    await expect(reportResource.handler({ id: '1e3' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it('names the rejected ID and what a valid one looks like', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/4221539junk') });

    const err = (await Promise.resolve(reportResource.handler({ id: '4221539junk' }, ctx)).catch(
      (e: unknown) => e,
    )) as Error;

    expect(err.message).toContain('4221539junk');
    expect(err.message).toContain('digits only');
  });

  it('rejects a zero-padded ID, naming the leading zero as the reason', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/004221539') });

    const err = (await Promise.resolve(reportResource.handler({ id: '004221539' }, ctx)).catch(
      (e: unknown) => e,
    )) as Error & { code?: number };

    expect(err.code).toBe(VALIDATION_CODE);
    expect(err.message).toContain('leading zero');
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

  it('rejects an all-digit ID past the exact-integer range instead of querying a rounded one', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/9007199254740993') });

    const err = (await Promise.resolve(
      reportResource.handler({ id: '9007199254740993' }, ctx),
    ).catch((e: unknown) => e)) as Error & { code?: number };

    expect(err.code).toBe(VALIDATION_CODE);
    expect(err.message).toContain('9007199254740993');
    expect(err.message).toContain('larger than any ReliefWeb record ID');
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it('rejects a thousand-digit ID rather than resolving it to Infinity', async () => {
    const oversized = '9'.repeat(1000);
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/x') });

    const err = (await Promise.resolve(reportResource.handler({ id: oversized }, ctx)).catch(
      (e: unknown) => e,
    )) as Error & { code?: number };

    expect(err.code).toBe(VALIDATION_CODE);
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it('still resolves the largest exactly-representable ID', async () => {
    mockGetReport.mockResolvedValue({ id: 9007199254740991, title: 'Boundary' });
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/9007199254740991') });

    await reportResource.handler({ id: '9007199254740991' }, ctx);

    expect(mockGetReport).toHaveBeenCalledWith(9007199254740991, ctx);
  });
});
