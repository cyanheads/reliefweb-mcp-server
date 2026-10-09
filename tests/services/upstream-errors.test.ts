/**
 * @fileoverview Tests for ReliefWeb upstream-error handling — folding ReliefWeb's own
 * error text into the thrown message, and telling a rejected query apart from a service
 * failure so the two carry different recovery advice.
 * @module tests/services/upstream-errors.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { describe, expect, it } from 'vitest';
import {
  isRejectedQueryError,
  rejectedQueryMessage,
  upstreamErrorMessage,
  upstreamHttpError,
} from '@/services/reliefweb/upstream-errors.js';

/**
 * Minimal non-OK `Response` stand-in. `httpErrorFromResponse` reads `status`,
 * `statusText`, `url`, `text()`, and `headers.get('retry-after')`.
 */
function makeErrorResponse(
  status: number,
  body: string,
  statusText = '',
  retryAfter: string | null = null,
): Response {
  return {
    ok: false,
    status,
    statusText,
    url: 'https://api.reliefweb.int/v2/reports?appname=secret-operator-appname',
    text: async () => body,
    headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
  } as unknown as Response;
}

/** The raw-response and status keys `httpErrorFromResponse` writes that never reach `data`. */
const RAW_RESPONSE_KEYS = ['body', 'responseBody', 'status', 'statusText', 'statusCode', 'url'];

const RW_503 = JSON.stringify({
  status: 503,
  time: 31,
  error: {
    type: 'ServiceUnavailableHttpException',
    message: 'The search backend is temporarily unavailable. Please try again later.',
  },
});

const RW_400 = JSON.stringify({
  status: 400,
  time: 2,
  error: {
    type: 'UnexpectedValueException',
    message:
      "Unrecognized sort field 'bogus.field'. Check the entity information for available fields.",
  },
});

describe('upstreamHttpError', () => {
  it('folds the ReliefWeb error message into the thrown message so it reaches the text path', async () => {
    const err = await upstreamHttpError(makeErrorResponse(400, RW_400, 'Bad Request'), {
      contentType: 'reports',
    });

    expect(err).toBeInstanceOf(McpError);
    expect(err.message).toContain('ReliefWeb returned HTTP 400');
    expect(err.message).toContain("Unrecognized sort field 'bogus.field'");
  });

  it('mirrors the parsed message onto data.upstreamMessage for the tool layer to quote', async () => {
    const err = await upstreamHttpError(makeErrorResponse(400, RW_400), { contentType: 'reports' });

    expect(err.data?.upstreamMessage).toBe(
      "Unrecognized sort field 'bogus.field'. Check the entity information for available fields.",
    );
  });

  it('keeps httpErrorFromResponse classification — a 400 is InvalidParams, not ServiceUnavailable', async () => {
    const err = await upstreamHttpError(makeErrorResponse(400, RW_400), { contentType: 'reports' });

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
  });

  it('preserves the caller-supplied data fields alongside the parsed message', async () => {
    const err = await upstreamHttpError(makeErrorResponse(400, RW_400), {
      contentType: 'reports',
      id: 7,
    });

    expect(err.data).toMatchObject({ contentType: 'reports', id: 7 });
  });

  it('leaves a 5xx on the service contract with no upstreamMessage', async () => {
    const err = await upstreamHttpError(makeErrorResponse(503, 'Service Unavailable'), {
      contentType: 'reports',
    });

    expect(err.code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect(err.data?.upstreamMessage).toBeUndefined();
  });

  it('leaves the message unchanged when the body is not a ReliefWeb JSON envelope', async () => {
    const err = await upstreamHttpError(makeErrorResponse(400, '<html>blocked</html>'), {
      contentType: 'reports',
    });

    expect(err.message).toBe('ReliefWeb returned HTTP 400.');
    expect(err.data?.upstreamMessage).toBeUndefined();
  });

  it('leaves the message unchanged when the JSON envelope carries no error message', async () => {
    const err = await upstreamHttpError(makeErrorResponse(400, '{"status":400}'), {
      contentType: 'reports',
    });

    expect(err.data?.upstreamMessage).toBeUndefined();
  });

  it('leaves the message unchanged when the body is malformed JSON', async () => {
    const err = await upstreamHttpError(makeErrorResponse(400, '{"error":{'), {
      contentType: 'reports',
    });

    expect(err.data?.upstreamMessage).toBeUndefined();
  });
});

/**
 * `error.data` reaches the client as `structuredContent.error.data` (tools) or the JSON-RPC
 * error `data` (resource reads). ReliefWeb's raw response text stays on the logged cause.
 */
describe('upstreamHttpError — client-visible data', () => {
  it('a 503 with a JSON error envelope carries no raw response, only the parsed explanation', async () => {
    const err = await upstreamHttpError(
      makeErrorResponse(503, RW_503, 'Service Unavailable', '120'),
      { contentType: 'reports', id: 1 },
    );

    expect(err.code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect(err.message).toBe(
      'ReliefWeb returned HTTP 503 Service Unavailable. The search backend is temporarily unavailable. Please try again later.',
    );
    expect(err.data).toEqual({
      contentType: 'reports',
      id: 1,
      retryAfter: '120',
      upstreamMessage: 'The search backend is temporarily unavailable. Please try again later.',
    });
  });

  it('a 400 with a JSON error envelope carries no raw response, only the parsed explanation', async () => {
    const err = await upstreamHttpError(makeErrorResponse(400, RW_400, 'Bad Request'), {
      contentType: 'reports',
    });

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(err.message).toContain("Unrecognized sort field 'bogus.field'");
    expect(err.data).toEqual({
      contentType: 'reports',
      upstreamMessage:
        "Unrecognized sort field 'bogus.field'. Check the entity information for available fields.",
    });
  });

  it('a failure with no parseable explanation carries no raw response either', async () => {
    const err = await upstreamHttpError(
      makeErrorResponse(503, '<html>upstream proxy detail</html>', 'Service Unavailable'),
      { contentType: 'reports', id: 1 },
    );

    expect(err.message).toBe('ReliefWeb returned HTTP 503 Service Unavailable.');
    expect(err.data).toEqual({ contentType: 'reports', id: 1 });
  });

  it('keeps the 501 retryable: false verdict so withRetry fails it fast', async () => {
    const err = await upstreamHttpError(makeErrorResponse(501, RW_503, 'Not Implemented'), {
      contentType: 'reports',
    });

    expect(err.data?.retryable).toBe(false);
    for (const key of RAW_RESPONSE_KEYS) expect(err.data).not.toHaveProperty(key);
  });

  it('never carries the request URL or its appname', async () => {
    const err = await upstreamHttpError(makeErrorResponse(503, RW_503), { contentType: 'reports' });

    expect(JSON.stringify(err.data)).not.toContain('secret-operator-appname');
    expect(JSON.stringify(err.data)).not.toContain('api.reliefweb.int');
  });

  it.each([
    [503, RW_503],
    [400, RW_400],
  ])(
    'keeps the framework error, raw body included, on cause for the log (%i)',
    async (status, body) => {
      const err = await upstreamHttpError(makeErrorResponse(status, body), {
        contentType: 'reports',
      });

      expect(err.cause).toBeInstanceOf(McpError);
      const cause = err.cause as McpError;
      expect(cause.code).toBe(err.code);
      expect(cause.data).toMatchObject({ status, body, contentType: 'reports' });
    },
  );
});

describe('isRejectedQueryError', () => {
  it.each([
    ['InvalidParams (400)', JsonRpcErrorCode.InvalidParams],
    ['InvalidRequest (4xx other)', JsonRpcErrorCode.InvalidRequest],
    ['ValidationError (422)', JsonRpcErrorCode.ValidationError],
  ])('classifies %s as a rejected query', (_label, code) => {
    expect(isRejectedQueryError(new McpError(code, 'nope'))).toBe(true);
  });

  it.each([
    ['ServiceUnavailable (5xx)', JsonRpcErrorCode.ServiceUnavailable],
    ['Timeout', JsonRpcErrorCode.Timeout],
    ['RateLimited (429)', JsonRpcErrorCode.RateLimited],
    ['Unauthorized (401)', JsonRpcErrorCode.Unauthorized],
    ['Forbidden (403)', JsonRpcErrorCode.Forbidden],
  ])('leaves %s on the service contract', (_label, code) => {
    expect(isRejectedQueryError(new McpError(code, 'nope'))).toBe(false);
  });

  it('returns false for a non-McpError throw', () => {
    expect(isRejectedQueryError(new Error('socket hang up'))).toBe(false);
    expect(isRejectedQueryError(undefined)).toBe(false);
  });
});

describe('rejectedQueryMessage', () => {
  it('quotes the upstream explanation when one was captured', () => {
    const err = new McpError(JsonRpcErrorCode.InvalidParams, 'ReliefWeb returned HTTP 400.', {
      upstreamMessage: "Invalid filter field 'bogus'.",
    });

    expect(rejectedQueryMessage('reports', err)).toBe(
      "ReliefWeb rejected the reports query: Invalid filter field 'bogus'.",
    );
  });

  it('falls back to a bare statement when ReliefWeb sent no explanation', () => {
    const err = new McpError(JsonRpcErrorCode.InvalidParams, 'ReliefWeb returned HTTP 400.');

    expect(rejectedQueryMessage('training', err)).toBe('ReliefWeb rejected the training query.');
  });
});

describe('upstreamErrorMessage', () => {
  it('appends the upstream explanation so a 403 names the real cause in the text path', () => {
    const err = new McpError(JsonRpcErrorCode.Forbidden, 'ReliefWeb returned HTTP 403.', {
      upstreamMessage: 'You are not using an approved appname.',
    });

    expect(upstreamErrorMessage('ReliefWeb API error while searching reports.', err)).toBe(
      'ReliefWeb API error while searching reports. You are not using an approved appname.',
    );
  });

  it('leaves the tool message alone when the failure carried no upstream text', () => {
    const message = 'ReliefWeb API error while listing sources.';

    expect(upstreamErrorMessage(message, new Error('socket hang up'))).toBe(message);
    expect(
      upstreamErrorMessage(message, new McpError(JsonRpcErrorCode.ServiceUnavailable, 'down')),
    ).toBe(message);
  });
});
