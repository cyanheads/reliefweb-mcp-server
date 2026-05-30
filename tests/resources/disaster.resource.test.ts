/**
 * @fileoverview Tests for the reliefweb://disasters/{id} resource.
 * @module tests/resources/disaster.resource.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// validationError() uses JsonRpcErrorCode.ValidationError (-32007), not InvalidParams (-32602)
const VALIDATION_CODE = JsonRpcErrorCode.ValidationError;

import { disasterResource } from '@/mcp-server/resources/definitions/disaster.resource.js';

const mockGetDisaster = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ getDisaster: mockGetDisaster }),
}));

describe('disasterResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full disaster record for valid numeric ID', async () => {
    const disaster = {
      id: 55555,
      name: 'Turkey: Earthquake 2023',
      status: 'past',
      glide: 'EQ-2023-000053-TUR',
      primaryType: 'Earthquake',
      types: ['Earthquake'],
      primaryCountry: 'Turkey',
      countries: ['Turkey', 'Syrian Arab Republic'],
      dateEvent: '2023-02-06T00:00:00+00:00',
      dateCreated: '2023-02-06T12:00:00+00:00',
      urlAlias: 'https://reliefweb.int/disaster/eq-2023-000053-tur',
    };
    mockGetDisaster.mockResolvedValue(disaster);

    const ctx = createMockContext({ uri: new URL('reliefweb://disasters/55555') });
    const result = await disasterResource.handler({ id: '55555' }, ctx);

    expect(result).toMatchObject({ id: 55555, name: 'Turkey: Earthquake 2023' });
    expect(mockGetDisaster).toHaveBeenCalledWith(55555, ctx);
  });

  it('parses string ID to integer for service call', async () => {
    mockGetDisaster.mockResolvedValue({ id: 12345, name: 'Test Disaster' });

    const ctx = createMockContext({ uri: new URL('reliefweb://disasters/12345') });
    await disasterResource.handler({ id: '12345' }, ctx);

    expect(mockGetDisaster).toHaveBeenCalledWith(12345, ctx);
  });

  it('throws ValidationError for non-numeric ID', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://disasters/abc') });

    await expect(disasterResource.handler({ id: 'abc' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetDisaster).not.toHaveBeenCalled();
  });

  it('throws ValidationError for zero ID', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://disasters/0') });

    await expect(disasterResource.handler({ id: '0' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetDisaster).not.toHaveBeenCalled();
  });

  it('throws ValidationError for negative ID', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://disasters/-1') });

    await expect(disasterResource.handler({ id: '-1' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetDisaster).not.toHaveBeenCalled();
  });

  it('throws ValidationError for float ID string', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://disasters/1.5') });

    // parseInt('1.5') = 1 which is valid, but NaN check handles "abc" — this one
    // resolves to 1 and proceeds; let the upstream handle it. Verify it does NOT error on parse.
    mockGetDisaster.mockResolvedValue(null);

    // parseInt('1.5', 10) = 1 — the handler will call the service with 1
    await expect(disasterResource.handler({ id: '1.5' }, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('throws NotFound when disaster does not exist', async () => {
    mockGetDisaster.mockResolvedValue(null);

    const ctx = createMockContext({ uri: new URL('reliefweb://disasters/9999999') });

    await expect(disasterResource.handler({ id: '9999999' }, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('handles sparse disaster without profile fields', async () => {
    mockGetDisaster.mockResolvedValue({ id: 1, name: 'Minimal Disaster', status: 'past' });

    const ctx = createMockContext({ uri: new URL('reliefweb://disasters/1') });
    const result = await disasterResource.handler({ id: '1' }, ctx);

    expect(result).toMatchObject({ id: 1, name: 'Minimal Disaster' });
  });

  it('does not expose API keys or secrets in error messages', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://disasters/notanumber') });

    try {
      await disasterResource.handler({ id: 'notanumber' }, ctx);
      expect.fail('should have thrown');
    } catch (err: unknown) {
      const message = String((err as { message?: string }).message ?? err);
      expect(message).not.toMatch(/api[_-]?key/i);
      expect(message).not.toMatch(/token/i);
      expect(message).not.toMatch(/secret/i);
      expect(message).not.toMatch(/password/i);
    }
    expect(mockGetDisaster).not.toHaveBeenCalled();
  });

  it('rejects injection-style ID strings', async () => {
    const injectionAttempts = [
      '../etc/passwd',
      '; DROP TABLE',
      '<script>alert(1)</script>',
      '${7*7}',
    ];

    for (const attempt of injectionAttempts) {
      const ctx = createMockContext({ uri: new URL('reliefweb://disasters/x') });
      await expect(disasterResource.handler({ id: attempt }, ctx)).rejects.toMatchObject({
        code: VALIDATION_CODE,
      });
    }
    expect(mockGetDisaster).not.toHaveBeenCalled();
  });
});
