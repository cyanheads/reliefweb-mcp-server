/**
 * @fileoverview Service-level tests for ReliefWebService — covers API response
 * envelope shapes and normalization that the tool-layer mocks cannot reach.
 * @module tests/services/reliefweb-service.test
 */

import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal fetch Response-like object. */
function makeOkResponse(body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    text: async () => text,
  } as Response;
}

function makeService(): ReliefWebService {
  const storage = createInMemoryStorage();
  return new ReliefWebService({} as never, storage);
}

// ─── Issue #3: GET endpoint returns data array, not single object ─────────────

describe('ReliefWebService.getReport — GET array envelope', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('unwraps the first element from the data array returned by the GET endpoint', async () => {
    const apiResponse = {
      count: 1,
      data: [
        {
          id: 4212515,
          type: 'reports',
          href: 'https://api.reliefweb.int/v2/reports/4212515',
          fields: {
            id: 4212515,
            title: 'Syria Flash Update #42',
            body: '<p>Full body content.</p>',
            url_alias: 'https://reliefweb.int/report/syrian-arab-republic/test',
          },
        },
      ],
      status: 200,
      time: 0.05,
      totalCount: 1,
      self: 'https://api.reliefweb.int/v2/reports/4212515',
    };

    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(apiResponse));

    const ctx = createMockContext();
    const service = makeService();
    const result = await service.getReport(4212515, ctx);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(4212515);
    expect(result?.title).toBe('Syria Flash Update #42');
    expect(result?.body).toBe('<p>Full body content.</p>');
  });

  it('returns null when data array is empty', async () => {
    const apiResponse = {
      count: 0,
      data: [],
      status: 200,
      time: 0.01,
      totalCount: 0,
      self: 'https://api.reliefweb.int/v2/reports/9999999',
    };

    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(apiResponse));

    const ctx = createMockContext();
    const service = makeService();
    const result = await service.getReport(9999999, ctx);

    expect(result).toBeNull();
  });

  it('returns null on HTTP 404', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 404 } as Response);

    const ctx = createMockContext();
    const service = makeService();
    const result = await service.getReport(9999999, ctx);

    expect(result).toBeNull();
  });
});

describe('ReliefWebService.getDisaster — GET array envelope', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('unwraps the first element from the data array returned by the GET endpoint', async () => {
    const apiResponse = {
      count: 1,
      data: [
        {
          id: 55555,
          type: 'disasters',
          href: 'https://api.reliefweb.int/v2/disasters/55555',
          fields: {
            id: 55555,
            name: 'Turkey: Earthquake 2023',
            status: 'past',
            glide: 'EQ-2023-000053-TUR',
          },
        },
      ],
      status: 200,
      time: 0.05,
      totalCount: 1,
      self: 'https://api.reliefweb.int/v2/disasters/55555',
    };

    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(apiResponse));

    const ctx = createMockContext();
    const service = makeService();
    const result = await service.getDisaster(55555, ctx);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(55555);
    expect(result?.name).toBe('Turkey: Earthquake 2023');
    expect(result?.status).toBe('past');
  });
});

// ─── Issue #4: Profile sub-fields are { title, active, archive } objects ──────

describe('ReliefWebService.getCountry — profile sub-field normalization', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('extracts active links from nested { title, active, archive } profile sub-fields', async () => {
    const apiResponse = {
      count: 1,
      data: [
        {
          id: 10001,
          type: 'countries',
          fields: {
            id: 10001,
            name: 'Syrian Arab Republic',
            iso3: 'SYR',
            status: 'current',
            profile: {
              overview: 'Syria crisis overview.',
              key_content: {
                title: 'Key Content',
                active: [
                  { url: 'https://reliefweb.int/key1', title: 'Key Update 1' },
                  { url: 'https://reliefweb.int/key2', title: 'Key Update 2' },
                ],
                archive: [{ url: 'https://reliefweb.int/key-archive', title: 'Archive Item' }],
              },
              appeals_response_plans: {
                title: 'Appeals & Response Plans',
                active: [
                  { url: 'https://reliefweb.int/hrp', title: 'HRP 2024', date: '2024-01-01' },
                ],
              },
              useful_links: {
                title: 'Useful Links',
                active: [{ url: 'https://ocha.org/syria', title: 'OCHA Syria' }],
              },
            },
          },
        },
      ],
      status: 200,
      time: 0.05,
      totalCount: 1,
      self: 'https://api.reliefweb.int/v2/countries',
    };

    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(apiResponse));

    const ctx = createMockContext();
    const service = makeService();
    const result = await service.getCountry('SYR', ctx);

    expect(result).not.toBeNull();
    expect(result?.profileOverview).toBe('Syria crisis overview.');
    // key_content: active (2) + archive (1) = 3 items
    expect(result?.keyContent).toHaveLength(3);
    expect(result?.keyContent?.[0]).toEqual({
      title: 'Key Update 1',
      url: 'https://reliefweb.int/key1',
    });
    expect(result?.keyContent?.[2]).toEqual({
      title: 'Archive Item',
      url: 'https://reliefweb.int/key-archive',
    });
    // appeals_response_plans: active only
    expect(result?.appealsResponsePlans).toHaveLength(1);
    expect(result?.appealsResponsePlans?.[0]).toMatchObject({
      title: 'HRP 2024',
      date: '2024-01-01',
    });
    // useful_links: active only
    expect(result?.usefulLinks).toHaveLength(1);
    expect(result?.usefulLinks?.[0]).toEqual({
      title: 'OCHA Syria',
      url: 'https://ocha.org/syria',
    });
  });

  it('handles country with no profile data', async () => {
    const apiResponse = {
      count: 1,
      data: [{ id: 999, type: 'countries', fields: { id: 999, name: 'Minimal Country' } }],
      status: 200,
      time: 0.01,
      totalCount: 1,
      self: 'https://api.reliefweb.int/v2/countries',
    };

    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(apiResponse));

    const ctx = createMockContext();
    const service = makeService();
    const result = await service.getCountry('MIN', ctx);

    expect(result).not.toBeNull();
    expect(result?.keyContent).toBeUndefined();
    expect(result?.appealsResponsePlans).toBeUndefined();
    expect(result?.usefulLinks).toBeUndefined();
  });
});

describe('ReliefWebService.getDisaster — profile sub-field normalization', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('extracts active links from nested { title, active, archive } profile sub-fields', async () => {
    const apiResponse = {
      count: 1,
      data: [
        {
          id: 55555,
          type: 'disasters',
          fields: {
            id: 55555,
            name: 'Turkey: Earthquake 2023',
            status: 'past',
            profile: {
              overview: 'Overview text.',
              key_content: {
                title: 'Key Content',
                active: [{ url: 'https://reliefweb.int/key', title: 'Key Update' }],
              },
              appeals_response_plans: {
                title: 'Appeals',
                active: [
                  {
                    url: 'https://reliefweb.int/appeal',
                    title: 'Flash Appeal 2023',
                    date: '2023-02-20',
                  },
                ],
              },
              useful_links: {
                title: 'Useful Links',
                active: [{ url: 'https://unhcr.org/turkey', title: 'UNHCR Response' }],
              },
            },
          },
        },
      ],
      status: 200,
      time: 0.05,
      totalCount: 1,
      self: 'https://api.reliefweb.int/v2/disasters/55555',
    };

    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(apiResponse));

    const ctx = createMockContext();
    const service = makeService();
    const result = await service.getDisaster(55555, ctx);

    expect(result).not.toBeNull();
    expect(result?.profileOverview).toBe('Overview text.');
    expect(result?.keyContent).toHaveLength(1);
    expect(result?.keyContent?.[0]).toEqual({
      title: 'Key Update',
      url: 'https://reliefweb.int/key',
    });
    expect(result?.appealsResponsePlans).toHaveLength(1);
    expect(result?.appealsResponsePlans?.[0]).toMatchObject({ date: '2023-02-20' });
    expect(result?.usefulLinks).toHaveLength(1);
  });
});

// ─── Issue #5: RawSourceFields.type is a single object, not an array ─────────

describe('ReliefWebService.listSources — type field normalization', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('populates types array from single-object type field', async () => {
    const apiResponse = {
      count: 1,
      data: [
        {
          id: 1111,
          type: 'sources',
          fields: {
            id: 1111,
            name: 'Médecins Sans Frontières',
            shortname: 'MSF',
            type: { name: 'Non-governmental Organization' },
            url: 'https://reliefweb.int/organization/msf',
            homepage: 'https://www.msf.org',
          },
        },
      ],
      status: 200,
      time: 0.05,
      totalCount: 1,
      self: 'https://api.reliefweb.int/v2/sources',
    };

    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(apiResponse));

    const ctx = createMockContext();
    const service = makeService();
    const result = await service.listSources({}, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.types).toEqual(['Non-governmental Organization']);
  });

  it('leaves types undefined when type field is absent', async () => {
    const apiResponse = {
      count: 1,
      data: [
        {
          id: 999,
          type: 'sources',
          fields: { id: 999, name: 'Minimal Source' },
        },
      ],
      status: 200,
      time: 0.01,
      totalCount: 1,
      self: 'https://api.reliefweb.int/v2/sources',
    };

    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(apiResponse));

    const ctx = createMockContext();
    const service = makeService();
    const result = await service.listSources({}, ctx);

    expect(result.items[0]?.types).toBeUndefined();
  });
});
