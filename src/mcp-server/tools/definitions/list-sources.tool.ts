/**
 * @fileoverview Browse source organizations that contribute content to ReliefWeb.
 * @module mcp-server/tools/definitions/list-sources
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

export const reliefwebListSources = tool('reliefweb_list_sources', {
  title: 'List ReliefWeb Sources',
  description:
    'Browse source organizations that contribute content to ReliefWeb, optionally filtered by name text or organization type. ' +
    'Returns short names, types, and URLs. ' +
    'Use the shortname value with the source filter in reliefweb_search_reports, reliefweb_search_jobs, and reliefweb_search_training.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    text: z
      .string()
      .optional()
      .describe('Full-text search query. Matches against organization name and short name.'),
    type: z
      .string()
      .optional()
      .describe(
        'Organization type (e.g., Government, International Organization, NGO, Academia). Filters on type.name.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(10)
      .describe(
        'Number of results to return (1–1000, default 10). Each call counts against the 1,000-calls/day quota.',
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
            id: z.number().describe('ReliefWeb numeric source ID.'),
            name: z.string().describe('Full organization name.'),
            shortname: z
              .string()
              .optional()
              .describe(
                'Organization short name — use this value in the source filter for other search tools.',
              ),
            types: z.array(z.string()).optional().describe('Organization type names.'),
            url: z.string().optional().describe('Organization ReliefWeb profile URL.'),
            homepage: z.string().optional().describe('Organization website URL.'),
          })
          .describe('A source organization contributing content to ReliefWeb.'),
      )
      .describe('Source organizations contributing content to ReliefWeb.'),
  }),
  enrichment: {
    totalCount: z.number().describe('Total sources matching the query before pagination.'),
  },

  async handler(input, ctx) {
    ctx.log.info('reliefweb_list_sources', {
      text: input.text,
      type: input.type,
      limit: input.limit,
    });

    const result = await getReliefWebService().listSources(
      {
        ...(input.text?.trim() ? { text: input.text } : {}),
        ...(input.type?.trim() ? { type: input.type } : {}),
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
      const namePart = item.shortname ? `**${item.shortname}** — ${item.name}` : `**${item.name}**`;
      const typePart = item.types?.length ? ` (${item.types.join(', ')})` : '';
      lines.push(`- ${namePart} [${item.id}]${typePart}`);
      if (item.homepage) lines.push(`  Website: ${item.homepage}`);
      if (item.url) lines.push(`  ReliefWeb: ${item.url}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
