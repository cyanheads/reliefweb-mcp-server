/**
 * @fileoverview Classification and message-building for ReliefWeb HTTP failures — folds
 * ReliefWeb's own JSON error text into the thrown error so it survives to the tool error
 * response, and tells a rejected query apart from a service problem.
 * @module services/reliefweb/upstream-errors
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { httpErrorFromResponse } from '@cyanheads/mcp-ts-core/utils';

/**
 * ReliefWeb answers a malformed query with a precise 400 — the unrecognized sort field,
 * the invalid filter key, the rejected date format. `httpErrorFromResponse` classifies the
 * status correctly but emits a fixed `"ReliefWeb returned HTTP <status>."` message with no
 * override, and the tool error text path renders only `message` plus `data.recovery.hint`.
 * Anything left in `data` — including the captured `body` — never reaches `content[]`, so
 * the detail is folded into the message here and mirrored onto `data.upstreamMessage` for
 * the tool layer to quote.
 */
export async function upstreamHttpError(
  response: Response,
  data: Record<string, unknown>,
): Promise<McpError> {
  const error = await httpErrorFromResponse(response, { service: 'ReliefWeb', data });
  const detail = parseReliefWebErrorMessage(error.data?.body);
  if (!detail) return error;
  return new McpError(error.code, `${error.message} ${detail}`, {
    ...error.data,
    upstreamMessage: detail,
  });
}

/**
 * True when ReliefWeb rejected the request itself rather than failing to serve it. These
 * are the caller's to fix: an identical retry is rejected identically, so they must not
 * carry the wait-and-retry guidance that a 5xx, timeout, or rate-limit block earns. Auth
 * and rate-limit statuses stay on the service contract — neither is a query the caller
 * can correct, though both still surface ReliefWeb's own explanation in the message.
 */
export function isRejectedQueryError(err: unknown): boolean {
  if (!(err instanceof McpError)) return false;
  return (
    err.code === JsonRpcErrorCode.InvalidParams ||
    err.code === JsonRpcErrorCode.InvalidRequest ||
    err.code === JsonRpcErrorCode.ValidationError
  );
}

/** ReliefWeb's own explanation of a failure, when `upstreamHttpError` captured one. */
function upstreamDetail(err: unknown): string | undefined {
  const detail = err instanceof McpError ? err.data?.upstreamMessage : undefined;
  return typeof detail === 'string' && detail.length > 0 ? detail : undefined;
}

/**
 * Tool-facing message for a rejected query, quoting ReliefWeb's explanation when it sent
 * one. `subject` names what was being queried (e.g. `'reports'`).
 */
export function rejectedQueryMessage(subject: string, err: unknown): string {
  const detail = upstreamDetail(err);
  return detail
    ? `ReliefWeb rejected the ${subject} query: ${detail}`
    : `ReliefWeb rejected the ${subject} query.`;
}

/**
 * Tool-facing message for a service-side failure, appending ReliefWeb's explanation when it
 * sent one. A 403 names an unapproved appname and a 429 names the limit that was hit — the
 * error text path renders only `message` plus the recovery hint, so a detail left anywhere
 * in `data` is invisible to a client reading `content[]`.
 */
export function upstreamErrorMessage(message: string, err: unknown): string {
  const detail = upstreamDetail(err);
  return detail ? `${message} ${detail}` : message;
}

/** Extracts `error.message` from ReliefWeb's JSON error envelope, when the body carries one. */
function parseReliefWebErrorMessage(body: unknown): string | undefined {
  if (typeof body !== 'string' || !body.trimStart().startsWith('{')) return;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    return typeof message === 'string' && message.trim().length > 0 ? message.trim() : undefined;
  } catch {
    return;
  }
}
