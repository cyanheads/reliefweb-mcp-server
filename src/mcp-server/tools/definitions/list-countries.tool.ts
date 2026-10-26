/**
 * @fileoverview List all countries tracked by ReliefWeb, optionally filtered by crisis status.
 * @module mcp-server/tools/definitions/list-countries
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline, markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { limitSchema, resolveLimit, SEARCH_MAX_LIMIT } from '@/mcp-server/tools/limits.js';
import { pagedPastEndNotice } from '@/mcp-server/tools/pagination.js';
import { renderPlainTextNotice } from '@/mcp-server/tools/plain-text-notice.js';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';
import {
  isRejectedQueryError,
  rejectedQueryMessage,
  upstreamErrorMessage,
} from '@/services/reliefweb/upstream-errors.js';

export const reliefwebListCountries = tool('reliefweb_list_countries', {
  title: 'List ReliefWeb Countries',
  description:
    'List all countries and territories tracked by ReliefWeb, optionally filtered to active humanitarian situations. ' +
    'Returns ISO3 codes and status for each entry — use the ISO3 code with reliefweb_get_country to fetch a full profile. ' +
    'Set crisis_only=true to limit results to countries with active humanitarian situations.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    crisis_only: z
      .boolean()
      .optional()
      .describe(
        'When true, filters to countries with an active humanitarian situation (status ongoing). Default false returns all countries.',
      ),
    limit: limitSchema(SEARCH_MAX_LIMIT)
      .default(100)
      .describe(
        'Number of results to return (1–1000, default 100). Larger integers are clamped to 1000 with a notice when clamping is enabled; otherwise they are rejected. Each call counts against the 1,000-calls/day quota.',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based offset for pagination. Use with limit and the totalCount enrichment field to page through results.',
      ),
  }),
  output: z.object({
    items: z
      .array(
        z
          .object({
            id: z.number().describe('ReliefWeb numeric country ID.'),
            name: z.string().describe('Country or territory name.'),
            iso3: z
              .string()
              .optional()
              .describe('ISO 3166-1 alpha-3 code for use with reliefweb_get_country.'),
            status: z
              .string()
              .optional()
              .describe(
                'Humanitarian situation status: ongoing (active crisis) or normal (non-crisis).',
              ),
            urlAlias: z
              .string()
              .optional()
              .describe('Canonical ReliefWeb URL for this country page.'),
          })
          .describe('A country or territory tracked by ReliefWeb.'),
      )
      .describe('Countries tracked by ReliefWeb.'),
  }),
  enrichmentTrailer: { notice: { render: renderPlainTextNotice } },
  enrichment: {
    totalCount: z.number().describe('Total countries matching the filter before pagination.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Discloses requested and applied limits when clamped. For empty pages, names the match count and last reachable offset when records matched; otherwise echoes filters and suggests how to broaden.',
      ),
  },
  errors: [
    {
      reason: 'invalid_query',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'ReliefWeb rejected the request as malformed rather than failing to serve it.',
      recovery:
        'Correct the value named in the error message and call again; an unchanged retry is rejected identically.',
    },
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The ReliefWeb API was unreachable, timed out, or returned a server error.',
      recovery:
        'Wait a moment and retry. If the message names a configuration or quota problem — an unapproved appname, or the 1,000 calls/day limit — that must be resolved before any retry can succeed.',
    },
  ],

  async handler(requestedInput, ctx) {
    const { limit, notice } = resolveLimit(
      requestedInput.limit,
      SEARCH_MAX_LIMIT,
      'reliefweb_list_countries',
      ctx,
    );
    const input = { ...requestedInput, limit };
    ctx.log.info('reliefweb_list_countries', {
      crisisOnly: input.crisis_only,
      limit: input.limit,
    });
    const result = await getReliefWebService()
      .listCountries(
        {
          ...(input.crisis_only != null ? { crisisOnly: input.crisis_only } : {}),
          limit: input.limit,
          offset: input.offset,
        },
        ctx,
      )
      .catch((err: unknown) => {
        if (isRejectedQueryError(err)) {
          throw ctx.fail('invalid_query', rejectedQueryMessage('countries', err), undefined, {
            cause: err,
          });
        }
        throw ctx.fail(
          'upstream_error',
          upstreamErrorMessage('ReliefWeb API error while listing countries.', err),
          undefined,
          { cause: err },
        );
      });

    ctx.enrich.total(result.totalCount);

    if (result.items.length === 0 && result.totalCount > 0) {
      notice(
        pagedPastEndNotice({
          subject: 'countries',
          offset: input.offset,
          totalCount: result.totalCount,
          limit: input.limit,
        }),
      );
    } else if (result.items.length === 0) {
      notice(
        input.crisis_only
          ? 'No countries with an active humanitarian situation found (crisis_only=true). Set crisis_only=false to list all tracked countries.'
          : 'No countries returned. ReliefWeb always tracks a non-empty country list, so an unfiltered zero-match result points at an upstream problem — retry, and treat a repeat as a service failure rather than a query to correct.',
      );
    }

    return { items: result.items };
  },

  format: (result) => {
    const lines: string[] = [];
    for (const item of result.items) {
      const parts: string[] = [`**${escapeMarkdownInline(item.name)}**`];
      if (item.iso3) parts.push(`(${escapeMarkdownInline(item.iso3)})`);
      parts.push(`[${item.id}]`);
      if (item.status) parts.push(`— ${escapeMarkdownInline(item.status)}`);
      if (item.urlAlias) parts.push(`— ${markdownLink(item.urlAlias, item.urlAlias)}`);
      lines.push(`- ${parts.join(' ')}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
