/**
 * @fileoverview End-to-end check that a ReliefWeb failure reaching the client through a
 * `reliefweb_get_*` tool or a `reliefweb://` resource carries no raw upstream response and
 * no request URL in its error `data`. Runs the real service against a mocked fetch.
 * @module tests/tools/upstream-error-data.tool.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createInMemoryStorage,
  createMockContext,
  type FetchMockHarness,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportResource } from '@/mcp-server/resources/definitions/report.resource.js';
import { reliefwebGetReport } from '@/mcp-server/tools/definitions/get-report.tool.js';
import { initReliefWebService } from '@/services/reliefweb/reliefweb-service.js';
import { contractError } from '../helpers/contract-error.js';

const APP_NAME = 'secret-operator-appname';

const UPSTREAM_DETAIL = 'The search backend is temporarily unavailable. Please try again later.';

const RW_503 = JSON.stringify({
  status: 503,
  time: 31,
  error: { type: 'ServiceUnavailableHttpException', message: UPSTREAM_DETAIL },
});

/** Asserts a client-visible error `data` carries no raw response and no request URL. */
function expectNoRawResponse(data: Record<string, unknown> | undefined): void {
  expect(data).toBeDefined();
  for (const key of ['body', 'responseBody', 'statusText', 'statusCode', 'url']) {
    expect(data).not.toHaveProperty(key);
  }
  const serialized = JSON.stringify(data);
  expect(serialized).not.toContain(APP_NAME);
  expect(serialized).not.toContain('api.reliefweb.int');
  expect(serialized).not.toContain('ServiceUnavailableHttpException');
}

describe('ReliefWeb 503 on a single-record fetch', () => {
  let http: FetchMockHarness;

  beforeEach(() => {
    vi.stubEnv('RELIEFWEB_APP_NAME', APP_NAME);
    vi.useFakeTimers();
    initReliefWebService({} as never, createInMemoryStorage());
    http = createFetchMock([
      {
        method: 'GET',
        match: /^https:\/\/api\.reliefweb\.int\/v2\/reports\/1\?/,
        respond: new Response(RW_503, {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'content-type': 'application/json' },
        }),
      },
    ]);
    http.install();
  });

  afterEach(() => {
    http.restore();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('reliefweb_get_report returns an error envelope with no raw response or URL in data', async () => {
    const pending = contractError(reliefwebGetReport, { id: 1 });
    await vi.runAllTimersAsync();
    const error = await pending;

    expect(http.calls.length).toBeGreaterThan(1);
    expect(error.message).toContain(UPSTREAM_DETAIL);
    expect(error.data?.upstreamMessage).toBe(UPSTREAM_DETAIL);
    expectNoRawResponse(error.data);
  });

  /** The resource handler factory forwards the thrown `data` as the JSON-RPC error `data`, adding only `requestId`. */
  it('reliefweb://reports/{id} throws an error whose data carries no raw response or URL', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://reports/1') });
    const pending = Promise.resolve(reportResource.handler({ id: '1' }, ctx)).catch(
      (e: unknown) => e,
    );
    await vi.runAllTimersAsync();
    const err = await pending;

    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).message).toContain(UPSTREAM_DETAIL);
    expectNoRawResponse((err as McpError).data);
  });
});
