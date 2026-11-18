/**
 * @fileoverview Service-level tests for ReliefWebService — covers API response
 * envelope shapes and normalization that the tool-layer mocks cannot reach.
 * @module tests/services/reliefweb-service.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
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

/**
 * Non-OK Response stand-in. Beyond `makeOkResponse`'s fields, the error path also reads
 * `statusText`, `url`, and the `retry-after` header.
 */
function makeErrorResponse(status: number, body: string, statusText = ''): Response {
  return {
    ok: false,
    status,
    statusText,
    url: 'https://api.reliefweb.int/v2/reports',
    text: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

function makeService(): ReliefWebService {
  const storage = createInMemoryStorage();
  return new ReliefWebService({} as never, storage);
}

// ─── Issue #3: GET endpoint returns data array, not single object ─────────────

describe('domain request regressions', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unmocked request'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('preserves training detail cost and delivery language independently of listing language', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeOkResponse({
        data: [
          {
            id: 1,
            fields: {
              title: 'Course',
              cost: 'free',
              language: [{ code: 'en' }],
              training_language: [{ code: 'fr' }, {}, { code: 'en' }],
              body: 'Body',
            },
          },
        ],
      }),
    );
    expect(await makeService().getTraining(1, createMockContext())).toEqual({
      id: 1,
      title: 'Course',
      cost: 'free',
      languages: ['en'],
      trainingLanguages: ['fr', 'en'],
      body: 'Body',
    });
  });

  it.each(['detail', 'archive'])('uses analysis for disaster %s GETs', async (mode) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeOkResponse({ data: [{ id: 1, fields: { name: 'Archived', status: 'alert-archive' } }] }),
    );
    const service = makeService();
    if (mode === 'detail') await service.getDisaster(1, createMockContext());
    else await service.getDisasterArchive(1, 'keyContent', createMockContext());
    expect(new URL(String(vi.mocked(fetch).mock.calls[0]?.[0])).searchParams.get('preset')).toBe(
      'analysis',
    );
  });

  it.each([undefined, 0, -1])(
    'preserves disaster ID %s with an empty result',
    async (disasterId) => {
      vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse({ data: [], totalCount: 0 }));
      const result = await makeService().searchReports(
        { ...(disasterId !== undefined ? { disasterId } : {}) },
        createMockContext(),
      );
      const query = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
      expect(query.filter).toEqual(
        disasterId === undefined ? undefined : { field: 'disaster.id', value: disasterId },
      );
      expect(result).toEqual({ items: [], totalCount: 0 });
    },
  );

  it('keeps nonempty raw filters nested with named conditions', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse({ data: [], totalCount: 0 }));
    await makeService().searchReports(
      {
        disasterId: 0,
        rawFilter: {
          operator: 'OR',
          conditions: [
            { field: 'country.iso3', value: 'SYR' },
            { field: 'country.iso3', value: 'TUR' },
          ],
        },
      },
      createMockContext(),
    );
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).filter).toEqual({
      operator: 'AND',
      conditions: [
        { field: 'disaster.id', value: 0 },
        {
          operator: 'OR',
          conditions: [
            { field: 'country.iso3', value: 'SYR' },
            { field: 'country.iso3', value: 'TUR' },
          ],
        },
      ],
    });
  });

  it.each(['reports', 'countries'] as const)(
    'keeps %s detail retrieval preset unchanged',
    async (contentType) => {
      vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse({ data: [] }));
      const service = makeService();
      if (contentType === 'reports') await service.getReport(1, createMockContext());
      else await service.getCountry('SYR', createMockContext());
      expect(new URL(String(vi.mocked(fetch).mock.calls[0]?.[0])).searchParams.has('preset')).toBe(
        false,
      );
      if (contentType === 'countries') {
        expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({
          filter: { field: 'iso3.exact', value: 'syr' },
          profile: 'full',
          limit: 1,
        });
      }
    },
  );

  it.each(['detail', 'archive'])('preserves disaster %s HTTP 404 misses', async (mode) => {
    vi.mocked(fetch).mockResolvedValueOnce(makeErrorResponse(404, ''));
    const service = makeService();
    expect(
      await (mode === 'detail'
        ? service.getDisaster(999999999, createMockContext())
        : service.getDisasterArchive(999999999, 'keyContent', createMockContext())),
    ).toBeNull();
  });

  it('requests and normalizes training delivery metadata with distinct filters', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeOkResponse({
        data: [
          {
            id: 1,
            fields: {
              title: 'Course',
              cost: 'free',
              language: [{ code: 'en' }],
              training_language: [{ code: 'fr' }],
            },
          },
          { id: 2, fields: { title: 'Sparse' } },
        ],
        totalCount: 2,
      }),
    );
    const result = await makeService().searchTraining(
      { cost: 'free', trainingLanguage: 'fr', language: 'en' },
      createMockContext(),
    );
    const query = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(query.fields.include).toEqual(
      expect.arrayContaining(['cost', 'training_language.code']),
    );
    expect(query.filter.conditions).toEqual(
      expect.arrayContaining([
        { field: 'cost', value: 'free' },
        { field: 'training_language.code', value: 'fr' },
        { field: 'language.code', value: 'en' },
      ]),
    );
    expect(result.items).toEqual([
      { id: 1, title: 'Course', cost: 'free', languages: ['en'], trainingLanguages: ['fr'] },
      { id: 2, title: 'Sparse' },
    ]);
  });

  it.each([0, 2000])(
    'keeps training pagination caller-controlled at offset %s with new filters',
    async (offset) => {
      vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse({ data: [], totalCount: 1000 }));
      const result = await makeService().searchTraining(
        { cost: 'fee-based', trainingLanguage: 'fr', limit: 1000, offset },
        createMockContext(),
      );
      const query = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
      expect(query.limit).toBe(1000);
      expect(query.offset).toBe(offset);
      expect(query.filter).toEqual({
        operator: 'AND',
        conditions: [
          { field: 'cost', value: 'fee-based' },
          { field: 'training_language.code', value: 'fr' },
        ],
      });
      expect(result).toEqual({ items: [], totalCount: 1000 });
    },
  );
});

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

  it('keeps only the active set from { title, active, archive } profile sub-fields (drops archive)', async () => {
    const apiResponse = {
      count: 1,
      data: [
        {
          id: 10001,
          type: 'countries',
          fields: {
            id: 10001,
            name: 'Syrian Arab Republic',
            iso3: 'syr',
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
                archive: [
                  { url: 'https://reliefweb.int/hrp-old', title: 'HRP 2019', date: '2019-01-01' },
                ],
              },
              useful_links: {
                title: 'Useful Links',
                active: [{ url: 'https://ocha.org/syria', title: 'OCHA Syria' }],
                archive: [{ url: 'https://ocha.org/syria-old', title: 'OCHA Syria (archived)' }],
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
    expect(result?.iso3).toBe('SYR');
    expect(result?.profileOverview).toBe('Syria crisis overview.');
    // key_content: active only (2) — archive dropped
    expect(result?.keyContent).toEqual([
      { title: 'Key Update 1', url: 'https://reliefweb.int/key1' },
      { title: 'Key Update 2', url: 'https://reliefweb.int/key2' },
    ]);
    expect(JSON.stringify(result?.keyContent)).not.toContain('key-archive');
    // appeals_response_plans: active only — archive dropped
    expect(result?.appealsResponsePlans).toHaveLength(1);
    expect(result?.appealsResponsePlans?.[0]).toMatchObject({
      title: 'HRP 2024',
      date: '2024-01-01',
    });
    expect(JSON.stringify(result?.appealsResponsePlans)).not.toContain('HRP 2019');
    // useful_links: active only — archive dropped
    expect(result?.usefulLinks).toEqual([{ title: 'OCHA Syria', url: 'https://ocha.org/syria' }]);
    expect(JSON.stringify(result?.usefulLinks)).not.toContain('archived');
  });

  it('drops a large archive entirely — active-only keeps the payload bounded (issue #9)', async () => {
    const bigKeyArchive = Array.from({ length: 500 }, (_, i) => ({
      url: `https://reliefweb.int/key-archive-${i}`,
      title: `Archived Key Content ${i}`,
    }));
    const bigAppealArchive = Array.from({ length: 120 }, (_, i) => ({
      url: `https://reliefweb.int/appeal-archive-${i}`,
      title: `Archived Appeal ${i}`,
      date: '2015-01-01',
    }));
    const apiResponse = {
      count: 1,
      data: [
        {
          id: 10001,
          type: 'countries',
          fields: {
            id: 10001,
            name: 'Syrian Arab Republic',
            iso3: 'syr',
            status: 'current',
            profile: {
              key_content: {
                title: 'Key Content',
                active: [
                  { url: 'https://reliefweb.int/key1', title: 'Key Update 1' },
                  { url: 'https://reliefweb.int/key2', title: 'Key Update 2' },
                  { url: 'https://reliefweb.int/key3', title: 'Key Update 3' },
                ],
                archive: bigKeyArchive,
              },
              appeals_response_plans: {
                title: 'Appeals & Response Plans',
                active: [
                  { url: 'https://reliefweb.int/hrp', title: 'HRP 2024', date: '2024-01-01' },
                ],
                archive: bigAppealArchive,
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

    // 3 active survive a 500-entry archive; 1 active appeal survives 120 archived.
    expect(result?.keyContent).toHaveLength(3);
    expect(result?.appealsResponsePlans).toHaveLength(1);
    // Not one archived entry leaks into the normalized output.
    expect(JSON.stringify(result)).not.toContain('archive-');
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

  it('drops active entries with no linkable URL or title, and dates only what upstream dates', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      makeOkResponse({
        data: [
          {
            id: 999,
            fields: {
              name: 'Sparse Country',
              profile: {
                key_content: {
                  active: [
                    { url: 'https://example.org/ok', title: 'Linkable' },
                    { url: 'https://example.org/no-title', title: '' },
                    { url: '', title: 'No URL' },
                  ],
                },
                appeals_response_plans: {
                  active: [{ url: 'https://example.org/plan', title: 'Undated plan' }],
                },
                useful_links: { active: [{ title: 'No URL either' }] },
              },
            },
          },
        ],
      }),
    );

    const result = await makeService().getCountry('MIN', createMockContext());

    expect(result?.keyContent).toEqual([{ title: 'Linkable', url: 'https://example.org/ok' }]);
    expect(result?.appealsResponsePlans).toEqual([
      { title: 'Undated plan', url: 'https://example.org/plan' },
    ]);
    expect(result).not.toHaveProperty('usefulLinks');
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

  it('keeps only the active set from { title, active, archive } profile sub-fields (drops archive)', async () => {
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
                archive: [{ url: 'https://reliefweb.int/key-old', title: 'Archived Key' }],
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
                archive: [
                  {
                    url: 'https://reliefweb.int/appeal-old',
                    title: 'Old Appeal 2021',
                    date: '2021-01-01',
                  },
                ],
              },
              useful_links: {
                title: 'Useful Links',
                active: [{ url: 'https://unhcr.org/turkey', title: 'UNHCR Response' }],
                archive: [{ url: 'https://unhcr.org/turkey-old', title: 'UNHCR (archived)' }],
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
    expect(JSON.stringify(result?.keyContent)).not.toContain('key-old');
    expect(result?.appealsResponsePlans).toHaveLength(1);
    expect(result?.appealsResponsePlans?.[0]).toMatchObject({ date: '2023-02-20' });
    expect(JSON.stringify(result?.appealsResponsePlans)).not.toContain('Old Appeal');
    expect(result?.usefulLinks).toHaveLength(1);
    expect(JSON.stringify(result?.usefulLinks)).not.toContain('archived');
  });
});

describe('ReliefWebService.getDisaster — description and profile overview', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const linkTail = '\n### Useful Links\n\n- [Situation map](https://example.org/map)';

  it.each([
    {
      shape: 'an overview identical to the description is dropped and flagged',
      description: 'Same text.',
      overview: 'Same text.',
      expected: { description: 'Same text.', profileOverviewSameAsDescription: true },
    },
    {
      shape: 'an overview the description extends is kept',
      description: `Text.${linkTail}`,
      overview: 'Text.',
      expected: { description: `Text.${linkTail}`, profileOverview: 'Text.' },
    },
    {
      shape: 'an overview differing only in whitespace is kept',
      description: 'Text.',
      overview: 'Text.\n',
      expected: { description: 'Text.', profileOverview: 'Text.\n' },
    },
    {
      shape: 'a description without an overview carries no flag',
      description: 'Text.',
      overview: undefined,
      expected: { description: 'Text.' },
    },
    {
      shape: 'an overview without a description is kept',
      description: undefined,
      overview: 'Text.',
      expected: { profileOverview: 'Text.' },
    },
    {
      shape: 'a record with neither text carries no flag',
      description: undefined,
      overview: undefined,
      expected: {},
    },
  ])('$shape', async ({ description, overview, expected }) => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      makeOkResponse({
        data: [
          {
            id: 7,
            fields: {
              name: 'Disaster',
              ...(description === undefined ? {} : { description }),
              ...(overview === undefined ? {} : { profile: { overview } }),
            },
          },
        ],
      }),
    );

    const result = await makeService().getDisaster(7, createMockContext());

    expect(result).toEqual({ id: 7, name: 'Disaster', ...expected });
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

// ─── Issues #8, #10, #11: outgoing POST-body request shape ────────────────────
// The tool-layer tests mock ReliefWebService entirely, so a regression in the
// filter field names is only catchable here, at the service boundary that builds
// the actual ReliefWeb query.

describe('ReliefWebService — search request shape', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const emptyPage = {
    count: 0,
    data: [],
    status: 200,
    time: 0.01,
    totalCount: 0,
    self: 'https://api.reliefweb.int/v2/x',
  };

  /** Parse the JSON POST body sent to the ReliefWeb API on the most recent fetch call. */
  function lastPostedQuery(): {
    filter?: unknown;
    query?: { value?: string; fields?: string[]; operator?: string };
    sort?: string[];
    preset?: string;
  } {
    const call = vi.mocked(globalThis.fetch).mock.calls.at(-1);
    const init = call?.[1] as RequestInit | undefined;
    return JSON.parse(String(init?.body)) as {
      filter?: unknown;
      query?: { value?: string; fields?: string[]; operator?: string };
      sort?: string[];
      preset?: string;
    };
  }

  it('searchReports filters country on country.iso3 (any tagged country), not primary_country.iso3', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchReports({ country: ['SYR'] }, createMockContext());

    const filter = lastPostedQuery().filter;
    expect(filter).toEqual({ field: 'country.iso3.exact', value: 'syr' });
    expect(JSON.stringify(filter)).not.toContain('primary_country');
  });

  it('searchDisasters filters country on country.iso3 (any tagged country), not primary_country.iso3', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchDisasters({ country: ['SYR'] }, createMockContext());

    const filter = lastPostedQuery().filter;
    expect(filter).toEqual({ field: 'country.iso3.exact', value: 'syr' });
    expect(JSON.stringify(filter)).not.toContain('primary_country');
  });

  it('listSources text search queries the name and shortname fields', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().listSources({ text: 'WFP' }, createMockContext());

    const query = lastPostedQuery().query;
    expect(query?.value).toBe('WFP');
    expect(query?.fields).toEqual(['name', 'shortname']);
  });

  it('listCountries crisis_only filters status on ongoing, not the legacy alert/current alias', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().listCountries({ crisisOnly: true }, createMockContext());

    const filter = lastPostedQuery().filter;
    expect(filter).toMatchObject({ field: 'status', value: ['ongoing'] });
    expect(JSON.stringify(filter)).not.toContain('alert');
    expect(JSON.stringify(filter)).not.toContain('current');
  });

  /**
   * Issues #12, #37: sort is threaded through searchJobs / searchTraining, with training
   * defaulting to soonest-starting, then newest-posted for undated listings
   * (date.start:asc, date.created:desc), and jobs to newest (date.created:desc).
   */
  it('searchTraining defaults sort to soonest-starting, then newest-posted for undated listings', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchTraining({}, createMockContext());

    expect(lastPostedQuery().sort).toEqual(['date.start:asc', 'date.created:desc']);
  });

  it('searchTraining threads an explicit sort into the query', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchTraining({ sort: 'date.start:desc' }, createMockContext());

    expect(lastPostedQuery().sort).toEqual(['date.start:desc']);
  });

  it('searchJobs defaults sort to date.created:desc (newest postings)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchJobs({}, createMockContext());

    expect(lastPostedQuery().sort).toEqual(['date.created:desc']);
  });

  it('searchJobs threads an explicit sort into the query', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchJobs({ sort: 'date.closing:asc' }, createMockContext());

    expect(lastPostedQuery().sort).toEqual(['date.closing:asc']);
  });

  // Issue #18: the jobs and training archives sit behind preset=analysis; reports have
  // no archived class, so their query stays on latest whatever the caller asks for.
  it('searchJobs sends preset=analysis when includeArchived is set', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchJobs({ includeArchived: true }, createMockContext());

    expect(lastPostedQuery().preset).toBe('analysis');
  });

  it('searchJobs defaults to preset=latest — open postings only', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchJobs({}, createMockContext());

    expect(lastPostedQuery().preset).toBe('latest');
  });

  it('searchTraining sends preset=analysis when includeArchived is set', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchTraining({ includeArchived: true }, createMockContext());

    expect(lastPostedQuery().preset).toBe('analysis');
  });

  it('searchTraining defaults to preset=latest — current listings only', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchTraining({}, createMockContext());

    expect(lastPostedQuery().preset).toBe('latest');
  });

  it('searchReports always sends preset=latest — reports have no archived class', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchReports({ country: ['TUV'] }, createMockContext());

    expect(lastPostedQuery().preset).toBe('latest');
  });

  it('threads already-resolved date bounds into the range filter verbatim (issue #21)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchReports(
      { dateFrom: '2026-07-01T00:00:00+00:00', dateTo: '2026-07-31T23:59:59+00:00' },
      createMockContext(),
    );

    expect(lastPostedQuery().filter).toEqual({
      field: 'date.original',
      value: { from: '2026-07-01T00:00:00+00:00', to: '2026-07-31T23:59:59+00:00' },
    });
  });
});

// ─── Issue #20: upstream 400 detail survives the service boundary ─────────────

describe('ReliefWebService — theme, career category, and job type filters', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeOkResponse({ data: [], totalCount: 0 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** Every condition of the last posted filter, whether it went alone or inside an AND. */
  function postedConditions(): unknown[] {
    const body = vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1]?.body;
    const filter = JSON.parse(String(body)).filter as { conditions?: unknown[] };
    return filter.conditions ?? [filter];
  }

  it('filters one report theme on the whole-tag theme.name.exact field', async () => {
    await makeService().searchReports({ theme: 'Coordination' }, createMockContext());

    expect(postedConditions()).toEqual([{ field: 'theme.name.exact', value: 'Coordination' }]);
  });

  it('sends several report themes as an array every report must carry', async () => {
    await makeService().searchReports({ theme: 'Gender,Mine Action' }, createMockContext());

    expect(postedConditions()).toEqual([
      { field: 'theme.name.exact', value: ['Gender', 'Mine Action'], operator: 'AND' },
    ]);
  });

  it('filters job themes and career categories on their exact fields, several all required', async () => {
    await makeService().searchJobs(
      { theme: 'Health,Gender', careerCategory: 'Information Management' },
      createMockContext(),
    );

    const conditions = postedConditions();
    expect(conditions).toHaveLength(2);
    expect(conditions).toContainEqual({
      field: 'career_categories.name.exact',
      value: 'Information Management',
    });
    expect(conditions).toContainEqual({
      field: 'theme.name.exact',
      value: ['Health', 'Gender'],
      operator: 'AND',
    });
  });

  it('sends several job career categories as an array every posting must carry', async () => {
    await makeService().searchJobs(
      { careerCategory: 'Human Resources,Other' },
      createMockContext(),
    );

    expect(postedConditions()).toEqual([
      {
        field: 'career_categories.name.exact',
        value: ['Human Resources', 'Other'],
        operator: 'AND',
      },
    ]);
  });

  it('filters one job type on type.name as a scalar', async () => {
    await makeService().searchJobs({ jobType: 'Consultancy' }, createMockContext());

    expect(postedConditions()).toEqual([{ field: 'type.name', value: 'Consultancy' }]);
  });

  it('sends several job types as an OR array — a posting carries one type — archive included', async () => {
    await makeService().searchJobs(
      { jobType: 'Consultancy,Internship', includeArchived: true },
      createMockContext(),
    );

    expect(postedConditions()).toEqual([
      { field: 'type.name', value: ['Consultancy', 'Internship'], operator: 'OR' },
    ]);
    const body = vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1]?.body;
    expect(JSON.parse(String(body)).preset).toBe('analysis');
  });

  it('filters training career categories on the exact field, several all required', async () => {
    await makeService().searchTraining(
      { careerCategory: 'Human Resources,Other' },
      createMockContext(),
    );

    expect(postedConditions()).toContainEqual({
      field: 'career_categories.name.exact',
      value: ['Human Resources', 'Other'],
      operator: 'AND',
    });
  });
});

describe('ReliefWebService — upstream error classification', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const rejectedSortBody = JSON.stringify({
    status: 400,
    error: {
      type: 'UnexpectedValueException',
      message:
        "Unrecognized sort field 'bogus.field'. Check the entity information for available fields.",
    },
  });

  it('a POST 400 throws InvalidParams carrying the ReliefWeb message, not a generic ServiceUnavailable', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      makeErrorResponse(400, rejectedSortBody, 'Bad Request'),
    );

    const err = await makeService()
      .searchReports({ sort: 'bogus.field:desc' }, createMockContext())
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(JsonRpcErrorCode.InvalidParams);
    expect((err as McpError).message).toContain("Unrecognized sort field 'bogus.field'");
    expect((err as McpError).data).toMatchObject({
      upstreamMessage:
        "Unrecognized sort field 'bogus.field'. Check the entity information for available fields.",
    });
  });

  it('a GET 400 gets the same treatment as the POST path', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeErrorResponse(400, rejectedSortBody));

    const err = await makeService()
      .getReport(1, createMockContext())
      .catch((e: unknown) => e);

    expect((err as McpError).code).toBe(JsonRpcErrorCode.InvalidParams);
    expect((err as McpError).message).toContain("Unrecognized sort field 'bogus.field'");
  });

  it('does not retry a rejected query — one call, no burnt quota', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeErrorResponse(400, rejectedSortBody));

    await makeService()
      .searchReports({ sort: 'bogus.field:desc' }, createMockContext())
      .catch(() => undefined);

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledOnce();
  });

  /**
   * `error.data` is forwarded to the client as `structuredContent.error.data`, and every
   * ReliefWeb request URL carries the operator's `appname` in its query string. Neither the
   * service's own data payload nor `httpErrorFromResponse` may put it there.
   */
  it.each([
    ['POST', (s: ReliefWebService) => s.searchReports({ country: ['SYR'] }, createMockContext())],
    ['GET', (s: ReliefWebService) => s.getReport(1, createMockContext())],
  ])('the %s error path keeps the request URL and its appname off error.data', async (_, call) => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'secret-operator-appname');
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      url: 'https://api.reliefweb.int/v2/reports?appname=secret-operator-appname',
      text: async () => rejectedSortBody,
      headers: { get: () => null },
    } as unknown as Response);

    const err = (await call(makeService()).catch((e: unknown) => e)) as McpError;

    expect(err).toBeInstanceOf(McpError);
    expect(err.data?.url).toBeUndefined();
    expect(JSON.stringify(err.data ?? {})).not.toContain('secret-operator-appname');
  });
});

// ─── Issue #14: job/training detail fetch ────────────────────────────────────

describe('ReliefWebService.getJob / getTraining — archived-reachable detail fetch', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** The POST body and URL of the most recent fetch call. */
  function lastCall(): { body: Record<string, unknown>; url: string } {
    const call = vi.mocked(globalThis.fetch).mock.calls.at(-1);
    const init = call?.[1] as RequestInit | undefined;
    return {
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      url: String(call?.[0]),
    };
  }

  function pageWith(fields: Record<string, unknown>, id: number) {
    return {
      count: 1,
      data: [{ id, type: 'jobs', fields }],
      status: 200,
      time: 0.01,
      totalCount: 1,
      self: 'https://api.reliefweb.int/v2/jobs',
    };
  }

  const emptyPage = {
    count: 0,
    data: [],
    status: 200,
    time: 0.01,
    totalCount: 0,
    self: 'https://api.reliefweb.int/v2/jobs',
  };

  it('getJob queries the search endpoint under preset=analysis so expired postings resolve', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      makeOkResponse(pageWith({ id: 4221508 }, 4221508)),
    );

    await makeService().getJob(4221508, createMockContext());

    const { body, url } = lastCall();
    expect(url).toContain('/v2/jobs?');
    // Not the item endpoint — `GET /v2/jobs/{id}` answers 404 for an expired posting.
    expect(url).not.toContain('/v2/jobs/4221508');
    expect(body.filter).toEqual({ field: 'id', value: 4221508 });
    expect(body.preset).toBe('analysis');
    expect(body.profile).toBe('full');
    expect(body.limit).toBe(1);
  });

  it('getJob normalizes body, how_to_apply, status, and both URLs', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      makeOkResponse(
        pageWith(
          {
            id: 4221508,
            title: 'Program Manager',
            status: 'expired',
            body: '<p>Duties.</p>',
            how_to_apply: '<p>Send a CV.</p>',
            date: {
              created: '2026-07-15T10:09:12+00:00',
              closing: '2026-08-03T00:00:00+00:00',
              changed: '2026-08-04T00:04:02+00:00',
            },
            source: [{ shortname: 'Qatar Charity', name: 'Qatar Charity' }],
            country: [{ name: 'Kenya', iso3: 'ken' }],
            career_categories: [{ name: 'Program/Project Management' }],
            experience: [{ name: '10+ years' }],
            type: [{ name: 'Job' }],
            url: 'https://reliefweb.int/node/4221508',
            url_alias: 'https://reliefweb.int/job/4221508/program-manager',
          },
          4221508,
        ),
      ),
    );

    const job = await makeService().getJob(4221508, createMockContext());

    expect(job).toMatchObject({
      id: 4221508,
      title: 'Program Manager',
      status: 'expired',
      body: '<p>Duties.</p>',
      howToApply: '<p>Send a CV.</p>',
      dateChanged: '2026-08-04T00:04:02+00:00',
      dateClosing: '2026-08-03T00:00:00+00:00',
      careerCategories: ['Program/Project Management'],
      experienceLevels: ['10+ years'],
      url: 'https://reliefweb.int/node/4221508',
      urlAlias: 'https://reliefweb.int/job/4221508/program-manager',
    });
  });

  it('getTraining normalizes registration, event link, cost, fee, cities, and training languages', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      makeOkResponse(
        pageWith(
          {
            id: 4188583,
            title: 'Security Risk Management',
            status: 'expired',
            body: '<p>Course content.</p>',
            how_to_register: '<p>Email us.</p>',
            event_url: 'https://www.separinternational.com/training',
            cost: 'fee-based',
            fee_information: '$1,400.00 plus VAT',
            city: [{ name: 'Deventer' }],
            type: [{ name: 'Training/Workshop' }],
            format: [{ name: 'on-site' }],
            language: [{ code: 'en', name: 'English' }],
            training_language: [{ code: 'en', name: 'English' }],
            date: {
              start: '2026-07-20T00:00:00+00:00',
              end: '2026-07-23T00:00:00+00:00',
              registration: '2026-07-17T00:00:00+00:00',
              created: '2025-11-27T00:59:46+00:00',
            },
            url: 'https://reliefweb.int/node/4188583',
            url_alias: 'https://reliefweb.int/training/4188583/srm',
          },
          4188583,
        ),
      ),
    );

    const training = await makeService().getTraining(4188583, createMockContext());

    expect(training).toMatchObject({
      id: 4188583,
      status: 'expired',
      body: '<p>Course content.</p>',
      howToRegister: '<p>Email us.</p>',
      eventUrl: 'https://www.separinternational.com/training',
      cost: 'fee-based',
      feeInformation: '$1,400.00 plus VAT',
      cities: ['Deventer'],
      types: ['Training/Workshop'],
      formats: ['on-site'],
      languages: ['en'],
      trainingLanguages: ['en'],
      dateCreated: '2025-11-27T00:59:46+00:00',
      url: 'https://reliefweb.int/node/4188583',
    });

    const { body, url } = lastCall();
    expect(url).toContain('/v2/training?');
    expect(body.preset).toBe('analysis');
  });

  it('returns null when the ID matches nothing, so the tool can raise not_found', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    const ctx = createMockContext();
    await expect(makeService().getJob(99999999, ctx)).resolves.toBeNull();
    await expect(makeService().getTraining(99999999, ctx)).resolves.toBeNull();
  });

  it('leaves a sparse record sparse rather than inventing empty sections', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      makeOkResponse(pageWith({ id: 7, title: 'Bare Posting' }, 7)),
    );

    const job = await makeService().getJob(7, createMockContext());

    expect(job).toEqual({ id: 7, title: 'Bare Posting' });
  });
});

// ─── Issue #15: archived curated-profile entries are reachable ────────────────

describe('ReliefWebService.getCountryArchive / getDisasterArchive — archived halves', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** A profile whose archive halves are deeper than its active ones, as SYR's really is. */
  const profile = {
    overview: 'Syria crisis overview.',
    key_content: {
      title: 'Key Content',
      active: [{ url: 'https://reliefweb.int/key-active', title: 'Active Key' }],
      archive: [
        { url: 'https://reliefweb.int/key-a1', title: 'Archived Key 1' },
        { url: 'https://reliefweb.int/key-a2', title: 'Archived Key 2' },
        { url: 'https://reliefweb.int/key-a3', title: 'Archived Key 3' },
      ],
    },
    appeals_response_plans: {
      title: 'Appeals & Response Plans',
      active: [{ url: 'https://reliefweb.int/hrp', title: 'HRP 2024', date: '2024-01-01' }],
      archive: [
        { url: 'https://reliefweb.int/hrp-2019', title: 'HRP 2019', date: '2019-01-01' },
        { url: 'https://reliefweb.int/hrp-2018', title: 'HRP 2018', date: '2018-01-01' },
      ],
    },
    useful_links: {
      title: 'Useful Links',
      active: [{ url: 'https://ocha.org/syria', title: 'OCHA Syria' }],
    },
  };

  function countryPage() {
    return {
      count: 1,
      data: [
        {
          id: 10001,
          type: 'countries',
          fields: {
            id: 10001,
            name: 'Syrian Arab Republic',
            iso3: 'syr',
            status: 'current',
            url_alias: 'https://reliefweb.int/country/syr',
            profile,
          },
        },
      ],
      status: 200,
      time: 0.05,
      totalCount: 1,
      self: 'https://api.reliefweb.int/v2/countries',
    };
  }

  it('returns the archived half of the named list, not the active half', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(countryPage()));

    const result = await makeService().getCountryArchive('SYR', 'keyContent', createMockContext());

    expect(result?.entries.map((e) => e.title)).toEqual([
      'Archived Key 1',
      'Archived Key 2',
      'Archived Key 3',
    ]);
    expect(result).toMatchObject({ id: 10001, iso3: 'SYR', name: 'Syrian Arab Republic' });
  });

  it('carries the publication date on archived appeals and response plans', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(countryPage()));

    const result = await makeService().getCountryArchive(
      'SYR',
      'appealsResponsePlans',
      createMockContext(),
    );

    expect(result?.entries).toEqual([
      { title: 'HRP 2019', url: 'https://reliefweb.int/hrp-2019', date: '2019-01-01' },
      { title: 'HRP 2018', url: 'https://reliefweb.int/hrp-2018', date: '2018-01-01' },
    ]);
  });

  it('returns an empty list — not null — for a list upstream gives no archive for', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(countryPage()));

    const result = await makeService().getCountryArchive('SYR', 'usefulLinks', createMockContext());

    expect(result?.entries).toEqual([]);
    expect(result?.id).toBe(10001);
  });

  it('drops archived entries that carry no linkable URL or title', async () => {
    const page = countryPage();
    page.data[0]!.fields.profile = {
      ...profile,
      key_content: {
        title: 'Key Content',
        active: [],
        archive: [
          { url: 'https://reliefweb.int/ok', title: 'Linkable' },
          { url: 'https://reliefweb.int/no-title', title: '' },
          { url: '', title: 'No URL' },
        ],
      },
    };
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(page));

    const result = await makeService().getCountryArchive('SYR', 'keyContent', createMockContext());

    expect(result?.entries).toEqual([{ title: 'Linkable', url: 'https://reliefweb.int/ok' }]);
  });

  it('returns null for an unknown country so the tool can raise not_found', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      makeOkResponse({
        count: 0,
        data: [],
        status: 200,
        time: 0.01,
        totalCount: 0,
        self: 'https://api.reliefweb.int/v2/countries',
      }),
    );

    await expect(
      makeService().getCountryArchive('ZZZ', 'keyContent', createMockContext()),
    ).resolves.toBeNull();
  });

  it('reads a disaster archive off the identically-shaped disaster profile', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      makeOkResponse({
        data: [
          {
            id: 51470,
            type: 'disasters',
            fields: {
              id: 51470,
              name: 'Major Disaster',
              status: 'ongoing',
              url_alias: 'https://reliefweb.int/disaster/major',
              profile,
            },
          },
        ],
      }),
    );

    const result = await makeService().getDisasterArchive(51470, 'keyContent', createMockContext());

    expect(result).toMatchObject({ id: 51470, name: 'Major Disaster' });
    expect(result?.entries).toHaveLength(3);
    expect(result?.entries[0]).toEqual({
      title: 'Archived Key 1',
      url: 'https://reliefweb.int/key-a1',
    });
  });

  it('returns null for an unknown disaster so the tool can raise not_found', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse({ data: [] }));

    await expect(
      makeService().getDisasterArchive(9999999, 'keyContent', createMockContext()),
    ).resolves.toBeNull();
  });
});

// ─── Issue #41: identifiers a record hands to the next call ──────────────────

describe('ReliefWebService — identifiers that link a record to the next call', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** Records in the envelope the search and item endpoints share. */
  function page(...records: Array<{ id: number } & Record<string, unknown>>): Response {
    return makeOkResponse({
      count: records.length,
      totalCount: records.length,
      data: records.map((fields) => ({ id: fields.id, fields })),
    });
  }

  /** The field selection the most recent POST asked ReliefWeb for. */
  function requestedFields(): string[] {
    const init = vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1] as RequestInit | undefined;
    return (JSON.parse(String(init?.body)) as { fields: { include: string[] } }).fields.include;
  }

  /** As ReliefWeb sends them: lowercase ISO3 codes, and disaster entries carrying a status. */
  const upstreamCountries = {
    primary_country: { name: 'Afghanistan', iso3: 'afg' },
    country: [
      { name: 'Afghanistan', iso3: 'afg' },
      { name: 'Pakistan', iso3: 'pak' },
    ],
  };
  const upstreamDisasters = [
    {
      id: 52467,
      name: 'Afghanistan: Earthquake - Nov 2025',
      glide: 'EQ-2025-000202-AFG',
      status: 'ongoing',
    },
    { id: 52001, name: 'Afghanistan: Floods - Jul 2025', status: 'past' },
  ];
  const linkedDisasters = [
    { id: 52467, name: 'Afghanistan: Earthquake - Nov 2025', glide: 'EQ-2025-000202-AFG' },
    { id: 52001, name: 'Afghanistan: Floods - Jul 2025' },
  ];

  it('selects ISO3 codes and linked disasters on report search and returns them normalized', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      page({
        id: 4186055,
        title: 'Flash Update',
        ...upstreamCountries,
        disaster: upstreamDisasters,
      }),
    );

    const { items } = await makeService().searchReports({}, createMockContext());

    expect(requestedFields()).toEqual(
      expect.arrayContaining([
        'primary_country.iso3',
        'country.iso3',
        'disaster.id',
        'disaster.name',
        'disaster.glide',
      ]),
    );
    expect(items[0]).toMatchObject({
      primaryCountry: 'Afghanistan',
      primaryCountryIso3: 'AFG',
      countries: ['Afghanistan', 'Pakistan'],
      countryIso3s: ['AFG', 'PAK'],
    });
    expect(items[0]?.disasters).toEqual(linkedDisasters);
  });

  it('returns the same identifiers on the full report record', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      page({
        id: 4186055,
        title: 'Flash Update',
        body: 'Body.',
        ...upstreamCountries,
        disaster: upstreamDisasters,
      }),
    );

    const report = await makeService().getReport(4186055, createMockContext());

    expect(report).toMatchObject({
      body: 'Body.',
      primaryCountryIso3: 'AFG',
      countryIso3s: ['AFG', 'PAK'],
    });
    expect(report?.disasters).toEqual(linkedDisasters);
  });

  it('omits each identifier upstream does not carry instead of inventing one', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      page(
        { id: 1, title: 'No links at all' },
        {
          id: 2,
          title: 'Names without codes',
          primary_country: { name: 'Afghanistan' },
          country: [{ name: 'Afghanistan' }],
          disaster: [{ name: 'Disaster with no ID' }, { id: 7 }],
        },
      ),
    );

    const { items } = await makeService().searchReports({}, createMockContext());

    expect(items[1]).toMatchObject({ primaryCountry: 'Afghanistan', countries: ['Afghanistan'] });
    for (const item of items) {
      expect(item).not.toHaveProperty('primaryCountryIso3');
      expect(item).not.toHaveProperty('countryIso3s');
      expect(item).not.toHaveProperty('disasters');
    }
  });

  it('selects ISO3 codes on disaster search and returns them uppercased beside the names', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      page({ id: 52467, name: 'Afghanistan: Earthquake - Nov 2025', ...upstreamCountries }),
    );

    const { items } = await makeService().searchDisasters({}, createMockContext());

    expect(requestedFields()).toEqual(
      expect.arrayContaining(['primary_country.iso3', 'country.iso3']),
    );
    expect(items[0]).toMatchObject({
      primaryCountry: 'Afghanistan',
      primaryCountryIso3: 'AFG',
      countries: ['Afghanistan', 'Pakistan'],
      countryIso3s: ['AFG', 'PAK'],
    });
  });

  it('carries ISO3 codes and curated report IDs on the full disaster record', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      page({
        id: 52467,
        name: 'Afghanistan: Earthquake - Nov 2025',
        ...upstreamCountries,
        profile: {
          key_content: {
            active: [{ title: 'Flash Update', url: 'https://reliefweb.int/node/4236883' }],
          },
          useful_links: {
            active: [{ title: 'Partner page', url: 'https://example.org/response' }],
          },
        },
      }),
    );

    const disaster = await makeService().getDisaster(52467, createMockContext());

    expect(disaster).toMatchObject({ primaryCountryIso3: 'AFG', countryIso3s: ['AFG', 'PAK'] });
    expect(disaster?.keyContent).toEqual([
      { title: 'Flash Update', url: 'https://reliefweb.int/node/4236883', reportId: 4236883 },
    ]);
    expect(disaster?.usefulLinks).toEqual([
      { title: 'Partner page', url: 'https://example.org/response' },
    ]);
  });

  it('carries ISO3 codes on a disaster archive page identity and report IDs on its entries', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      page({
        id: 52467,
        name: 'Afghanistan: Earthquake - Nov 2025',
        ...upstreamCountries,
        profile: {
          appeals_response_plans: {
            archive: [
              {
                title: 'Flash Appeal',
                url: 'https://reliefweb.int/node/2611439/edit',
                date: '2025-11-20',
              },
            ],
          },
        },
      }),
    );

    const archive = await makeService().getDisasterArchive(
      52467,
      'appealsResponsePlans',
      createMockContext(),
    );

    expect(archive).toMatchObject({ primaryCountryIso3: 'AFG', countryIso3s: ['AFG', 'PAK'] });
    expect(archive?.entries).toEqual([
      {
        title: 'Flash Appeal',
        url: 'https://reliefweb.int/node/2611439/edit',
        date: '2025-11-20',
        reportId: 2611439,
      },
    ]);
  });

  it('lists countries with the ISO3 code uppercased — ReliefWeb sends it lowercase', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      page({ id: 13, name: 'Afghanistan', iso3: 'afg' }, { id: 14, name: 'Unlisted territory' }),
    );

    const { items } = await makeService().listCountries({}, createMockContext());

    expect(items[0]?.iso3).toBe('AFG');
    expect(items[1]).not.toHaveProperty('iso3');
  });

  it('carries report IDs on every active curated list of a country profile', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      page({
        id: 13,
        name: 'Afghanistan',
        iso3: 'afg',
        profile: {
          key_content: {
            active: [{ title: 'Key update', url: 'https://reliefweb.int/node/4236883' }],
          },
          appeals_response_plans: {
            active: [
              {
                title: 'HRP 2025',
                url: 'https://reliefweb.int/node/2611439/edit',
                date: '2025-01-15',
              },
            ],
          },
          useful_links: {
            active: [
              { title: 'Node link', url: 'https://reliefweb.int/node/4100001' },
              { title: 'External', url: 'https://example.org/afghanistan' },
            ],
          },
        },
      }),
    );

    const country = await makeService().getCountry('AFG', createMockContext());

    expect(country?.keyContent).toEqual([
      { title: 'Key update', url: 'https://reliefweb.int/node/4236883', reportId: 4236883 },
    ]);
    expect(country?.appealsResponsePlans).toEqual([
      {
        title: 'HRP 2025',
        url: 'https://reliefweb.int/node/2611439/edit',
        date: '2025-01-15',
        reportId: 2611439,
      },
    ]);
    expect(country?.usefulLinks).toEqual([
      { title: 'Node link', url: 'https://reliefweb.int/node/4100001', reportId: 4100001 },
      { title: 'External', url: 'https://example.org/afghanistan' },
    ]);
  });

  /** Each URL shape a curated list carries, and the report ID it yields. */
  const urlForms: Array<[url: string, reportId: number | undefined]> = [
    ['https://reliefweb.int/node/4236883', 4236883],
    ['https://reliefweb.int/node/2611439/edit', 2611439],
    ['https://fts.unocha.org/countries/3/summary/2026', undefined],
    ['https://reliefweb.int/report/haiti/saison-cyclonique-2013', undefined],
    ['https://reliefweb.int/organization/institut-pasteur-de-madagascar', undefined],
    ['https://reliefweb.int/updates?advanced-search=%28D52586%29', undefined],
    ['http://reliefweb.int/node/4236883', undefined],
    ['https://www.reliefweb.int/node/4236883', undefined],
    ['https://reliefweb.int/node/4236883/', undefined],
    ['https://reliefweb.int/node/4236883?ref=key', undefined],
    ['https://reliefweb.int/node/4236883/edit/extra', undefined],
    ['https://reliefweb.int/node/0', undefined],
    ['https://reliefweb.int/node/12a', undefined],
    ['https://reliefweb.int/node/99999999999999999999', undefined],
    ['https://example.org/go?to=https://reliefweb.int/node/4236883', undefined],
  ];

  it('reads a report ID from a ReliefWeb node link, with or without /edit, and from no other URL', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      page({
        id: 13,
        name: 'Afghanistan',
        iso3: 'afg',
        profile: {
          key_content: {
            archive: urlForms.map(([url], i) => ({ title: `Entry ${i}`, url })),
          },
        },
      }),
    );

    const archive = await makeService().getCountryArchive('AFG', 'keyContent', createMockContext());

    expect(archive?.entries.map((entry) => [entry.url, entry.reportId])).toEqual(urlForms);
    for (const entry of archive?.entries ?? []) {
      if (entry.reportId === undefined) expect(entry).not.toHaveProperty('reportId');
    }
  });

  /** Job and training records tag countries but name no primary one. */
  const upstreamTaggedCountries = { country: upstreamCountries.country };

  it.each(['searchJobs', 'searchTraining'] as const)(
    '%s selects country ISO3 codes and returns them uppercased beside the names',
    async (method) => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        page({ id: 4221508, title: 'Program Manager', ...upstreamTaggedCountries }),
      );

      const { items } = await makeService()[method]({}, createMockContext());

      expect(requestedFields()).toEqual(expect.arrayContaining(['country.name', 'country.iso3']));
      expect(items[0]).toMatchObject({
        countries: ['Afghanistan', 'Pakistan'],
        countryIso3s: ['AFG', 'PAK'],
      });
    },
  );

  it.each(['getJob', 'getTraining'] as const)(
    '%s carries the country ISO3 codes on the full record',
    async (method) => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        page({ id: 4221508, title: 'Program Manager', body: 'Body.', ...upstreamTaggedCountries }),
      );

      const record = await makeService()[method](4221508, createMockContext());

      expect(record).toMatchObject({
        body: 'Body.',
        countries: ['Afghanistan', 'Pakistan'],
        countryIso3s: ['AFG', 'PAK'],
      });
    },
  );

  it.each(['searchJobs', 'searchTraining'] as const)(
    '%s omits the ISO3 codes when no tagged country carries one',
    async (method) => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        page(
          { id: 1, title: 'Online course, no country' },
          { id: 2, title: 'Names without codes', country: [{ name: 'Kenya' }] },
        ),
      );

      const { items } = await makeService()[method]({}, createMockContext());

      expect(items[1]).toMatchObject({ countries: ['Kenya'] });
      for (const item of items) expect(item).not.toHaveProperty('countryIso3s');
    },
  );
});

// ─── Issues #37, #39, #43: country filters, country lookup, training default scope ───

describe('ReliefWebService — country filters, country lookup, and training scope', () => {
  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeOkResponse({ count: 0, data: [], totalCount: 0, status: 200, time: 1, self: 'x' }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** The JSON body of the most recent POST to ReliefWeb. */
  function posted(): Record<string, unknown> & { filter?: unknown; sort?: string[] } {
    return JSON.parse(String(vi.mocked(fetch).mock.lastCall?.[1]?.body));
  }

  type CountrySearch = (s: ReliefWebService, country: string[]) => Promise<unknown>;
  const SEARCHES: [string, CountrySearch][] = [
    ['searchReports', (s, country) => s.searchReports({ country }, createMockContext())],
    ['searchDisasters', (s, country) => s.searchDisasters({ country }, createMockContext())],
    ['searchJobs', (s, country) => s.searchJobs({ country }, createMockContext())],
    ['searchTraining', (s, country) => s.searchTraining({ country }, createMockContext())],
  ];

  it.each(SEARCHES)(
    '%s sends one country code as a scalar country.iso3.exact condition, lower-cased',
    async (_name, search) => {
      await search(makeService(), ['SYR']);
      expect(posted().filter).toEqual({ field: 'country.iso3.exact', value: 'syr' });
    },
  );

  it.each(SEARCHES)('%s requires every listed country with operator AND', async (_name, search) => {
    await search(makeService(), ['SYR', 'AFG']);
    expect(posted().filter).toEqual({
      field: 'country.iso3.exact',
      value: ['syr', 'afg'],
      operator: 'AND',
    });
  });

  it.each(SEARCHES)(
    '%s reaches codes that are English stopwords (ARE, AND) through the exact field',
    async (_name, search) => {
      await search(makeService(), ['ARE', 'AND']);
      expect(posted().filter).toEqual({
        field: 'country.iso3.exact',
        value: ['are', 'and'],
        operator: 'AND',
      });
    },
  );

  it('searchTraining sends an explicit start bound as a plain date.start range', async () => {
    await makeService().searchTraining(
      { dateStartFrom: '2026-01-01T00:00:00+00:00' },
      createMockContext(),
    );
    expect(posted().filter).toEqual({
      field: 'date.start',
      value: { from: '2026-01-01T00:00:00+00:00' },
    });
  });

  it('listCountries sends no full-text query when no text is given', async () => {
    await makeService().listCountries(
      { crisisOnly: true, limit: 5, offset: 10 },
      createMockContext(),
    );
    expect(posted()).not.toHaveProperty('query');
    expect(posted()).toMatchObject({ sort: ['name:asc'], limit: 5, offset: 10 });
  });

  it('listCountries matches text against name and short name, every word required', async () => {
    await makeService().listCountries(
      { text: 'South Sudan', crisisOnly: true },
      createMockContext(),
    );
    expect(posted()).toMatchObject({
      query: { value: 'South Sudan', operator: 'AND', fields: ['name', 'shortname'] },
      filter: { field: 'status', value: ['ongoing'], operator: 'OR' },
      sort: ['name:asc'],
    });
  });

  it('searchTraining ORs the missing start date into the default scope', async () => {
    await makeService().searchTraining(
      { upcomingOrUndatedFrom: '2026-11-18T03:55:04+00:00' },
      createMockContext(),
    );
    expect(posted().filter).toEqual({
      operator: 'OR',
      conditions: [
        { field: 'date.start', value: { from: '2026-11-18T03:55:04+00:00' } },
        { field: 'date.start', negate: true },
      ],
    });
  });
});
