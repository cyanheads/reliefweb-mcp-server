/**
 * @fileoverview List all countries tracked by ReliefWeb, optionally filtered by crisis status.
 * @module mcp-server/tools/definitions/list-countries
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

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
        'When true, filters to countries with an active humanitarian situation (status alert or current). Default false returns all countries.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(100)
      .describe(
        'Number of results to return (1–1000, default 100). Each call counts against the 1,000-calls/day quota.',
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
                'Humanitarian situation status. Active situations have status alert or current.',
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
  enrichment: {
    totalCount: z.number().describe('Total countries matching the filter before pagination.'),
  },

  async handler(input, ctx) {
    ctx.log.info('reliefweb_list_countries', {
      crisisOnly: input.crisis_only,
      limit: input.limit,
    });
    const result = await getReliefWebService().listCountries(
      {
        ...(input.crisis_only != null ? { crisisOnly: input.crisis_only } : {}),
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );
    ctx.enrich.total(result.totalCount);
    return { items: result.items };
  },

  format: (result) => {
    const lines: string[] = [];
    for (const item of result.items) {
      const parts: string[] = [`**${item.name}**`];
      if (item.iso3) parts.push(`(${item.iso3})`);
      parts.push(`[${item.id}]`);
      if (item.status) parts.push(`— ${item.status}`);
      if (item.urlAlias) parts.push(`— ${item.urlAlias}`);
      lines.push(`- ${parts.join(' ')}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
