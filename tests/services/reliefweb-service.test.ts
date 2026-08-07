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
            iso3: 'SYR',
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

    await makeService().searchReports({ country: 'SYR' }, createMockContext());

    const filter = lastPostedQuery().filter;
    expect(filter).toEqual({ field: 'country.iso3', value: 'SYR' });
    expect(JSON.stringify(filter)).not.toContain('primary_country');
  });

  it('searchDisasters filters country on country.iso3 (any tagged country), not primary_country.iso3', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchDisasters({ country: 'SYR' }, createMockContext());

    const filter = lastPostedQuery().filter;
    expect(filter).toEqual({ field: 'country.iso3', value: 'SYR' });
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

  // Issue #12: sort is threaded through searchJobs / searchTraining, with training
  // defaulting to soonest-starting (date.start:asc) and jobs to newest (date.created:desc).
  it('searchTraining defaults sort to date.start:asc (soonest-starting)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(makeOkResponse(emptyPage));

    await makeService().searchTraining({}, createMockContext());

    expect(lastPostedQuery().sort).toEqual(['date.start:asc']);
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

    await makeService().searchReports({ country: 'TUV' }, createMockContext());

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
            iso3: 'SYR',
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
