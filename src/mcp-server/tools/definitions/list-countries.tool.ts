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
    'List the countries and territories tracked by ReliefWeb, with the ISO3 code and humanitarian status of each. Set text to look a country up by name (text: "Syria" returns SYR) instead of reading the full listing, and crisis_only=true to keep countries with an active humanitarian situation. Use the ISO3 code with reliefweb_get_country and in the country filter of the search tools.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    text: z
      .string()
      .optional()
      .describe(
        'Country name to look up. Matches whole words of the ReliefWeb country name and short name (Syria, DR Congo), ignoring case and accents; every word must match, so a partial word or an exonym finds nothing (Syr, Ivory Coast). When it misses, list without text and read the full listing. Blank is omitted.',
      ),
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
              .describe('ISO 3166-1 alpha-3 code, uppercase, for use with reliefweb_get_country.'),
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
    effectiveQuery: z
      .string()
      .optional()
      .describe('The text lookup the query ran, trimmed. Absent when no text was given.'),
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
        'Correct the value named in the error message and call again; an unchanged retry is rejected identically. Malformed text is another possible cause: use plain keywords, balanced parentheses, and complete boolean expressions in text.',
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
    const text = input.text?.trim();
    ctx.log.info('reliefweb_list_countries', {
      text,
      crisisOnly: input.crisis_only,
      limit: input.limit,
    });
    const result = await getReliefWebService()
      .listCountries(
        {
          ...(text ? { text } : {}),
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
    if (text) ctx.enrich.echo(text);

    if (result.items.length === 0 && result.totalCount > 0) {
      notice(
        pagedPastEndNotice({
          subject: 'countries',
          offset: input.offset,
          totalCount: result.totalCount,
          limit: input.limit,
        }),
      );
    } else if (result.items.length === 0 && text) {
      const scope = input.crisis_only ? ' among countries with crisis_only=true' : '';
      const widen = input.crisis_only ? ', set crisis_only=false,' : '';
      notice(
        `No ReliefWeb country name or short name matched text="${text}"${scope}. Text matches whole words and needs every one, so try the official name or one distinctive word of it${widen} or list without text and read the full listing.`,
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
