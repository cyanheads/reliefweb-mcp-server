/**
 * @fileoverview Startup limit policy and per-call clamping with composable notices.
 * @module mcp-server/tools/limits
 */
import { type Context, z } from '@cyanheads/mcp-ts-core';
import { createCounter } from '@cyanheads/mcp-ts-core/utils';
import { getLimitConfig } from '@/config/server-config.js';

/** ReliefWeb's ceiling for a search or reference-list page. */
export const SEARCH_MAX_LIMIT = 1000;

const clampLimits = getLimitConfig().clampLimits;
let clamps: ReturnType<typeof createCounter> | undefined;

/** Positive integer schema; the startup switch controls only its upper bound. */
export function limitSchema(maximum: number) {
  const schema = z.number().int().min(1);
  return clampLimits ? schema : schema.max(maximum);
}

/** Applies the page ceiling before work and composes its disclosure with later guidance. */
export function resolveLimit(requested: number, maximum: number, tool: string, ctx: Context) {
  const limit = clampLimits ? Math.min(requested, maximum) : requested;
  const clampNotice =
    limit < requested ? `Requested limit ${requested}; applied limit ${limit}.` : undefined;
  if (clampNotice) {
    ctx.log.info('ReliefWeb page limit clamped', { tool, requested, applied: limit });
    clamps ??= createCounter(
      'reliefweb.limit.clamps',
      'Page limits reduced to the supported ceiling',
      '{clamps}',
    );
    clamps.add(1, { tool, maximum });
  }
  const notice = (message?: string) => {
    const text = [clampNotice, message].filter(Boolean).join(' ');
    if (text) ctx.enrich.notice(text);
  };
  notice();
  return { limit, notice };
}
