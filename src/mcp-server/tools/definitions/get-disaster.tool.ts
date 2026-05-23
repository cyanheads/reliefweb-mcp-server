/**
 * @fileoverview Fetch a single ReliefWeb disaster record by ID with full details.
 * @module mcp-server/tools/definitions/get-disaster
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

export const reliefwebGetDisaster = tool('reliefweb_get_disaster', {
  title: 'Get ReliefWeb Disaster',
  description:
    'Fetch a disaster record by ReliefWeb numeric ID including description, affected countries, GLIDE number, ' +
    'profile overview, key content links, and active appeals or response plans. ' +
    'Use after reliefweb_search_disasters to retrieve full details.',
  annotations: { readOnlyHint: true },
  input: z.object({
    id: z
      .number()
      .int()
      .positive()
      .describe('ReliefWeb numeric disaster ID. Obtained from reliefweb_search_disasters results.'),
  }),
  output: z.object({
    id: z.number().describe('ReliefWeb numeric disaster ID.'),
    name: z.string().describe('Disaster name.'),
    status: z.string().optional().describe('Disaster status (alert, current, past, archive).'),
    glide: z.string().optional().describe('GLIDE number for cross-system correlation.'),
    dateEvent: z.string().optional().describe('Event date (ISO 8601), when available.'),
    dateCreated: z.string().optional().describe('ReliefWeb index date (ISO 8601).'),
    primaryCountry: z.string().optional().describe('Primary affected country.'),
    countries: z.array(z.string()).optional().describe('All countries tagged on this disaster.'),
    types: z.array(z.string()).optional().describe('Disaster type names.'),
    primaryType: z.string().optional().describe('Primary disaster type.'),
    urlAlias: z.string().optional().describe('Canonical ReliefWeb URL for this disaster.'),
    description: z.string().optional().describe('Full disaster description text.'),
    profileOverview: z
      .string()
      .optional()
      .describe('Profile overview text from the ReliefWeb editorial team.'),
    keyContent: z
      .array(
        z.object({
          title: z.string().describe('Link title.'),
          url: z.string().describe('Link URL.'),
        }),
      )
      .optional()
      .describe('Curated key content links from the ReliefWeb editorial team.'),
    appealsResponsePlans: z
      .array(
        z.object({
          title: z.string().describe('Appeal or response plan title.'),
          url: z.string().describe('Link URL.'),
          date: z.string().optional().describe('Publication date.'),
        }),
      )
      .optional()
      .describe('Active appeals and response plans linked to this disaster.'),
    usefulLinks: z
      .array(
        z.object({
          title: z.string().describe('Link title.'),
          url: z.string().describe('Link URL.'),
        }),
      )
      .optional()
      .describe('Useful external links curated by ReliefWeb editors.'),
  }),
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No disaster found with the given ID.',
      recovery:
        'Verify the ID is a valid ReliefWeb numeric disaster ID from reliefweb_search_disasters results.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('reliefweb_get_disaster', { id: input.id });
    const disaster = await getReliefWebService().getDisaster(input.id, ctx);
    if (!disaster) {
      throw ctx.fail(
        'not_found',
        `No disaster found with ID ${input.id}. Verify the ID from reliefweb_search_disasters.`,
        { ...ctx.recoveryFor('not_found') },
      );
    }
    return disaster;
  },

  format: (result) => {
    const lines: string[] = [`# ${result.name}`];
    lines.push(`**ID:** ${result.id}`);
    if (result.status) lines.push(`**Status:** ${result.status}`);
    if (result.glide) lines.push(`**GLIDE:** ${result.glide}`);
    if (result.primaryType) lines.push(`**Primary type:** ${result.primaryType}`);
    if (result.types?.length) lines.push(`**Types:** ${result.types.join(', ')}`);
    if (result.dateEvent) lines.push(`**Event date:** ${result.dateEvent}`);
    if (result.dateCreated) lines.push(`**Indexed:** ${result.dateCreated}`);
    if (result.primaryCountry) lines.push(`**Primary country:** ${result.primaryCountry}`);
    if (result.countries?.length) lines.push(`**Countries:** ${result.countries.join(', ')}`);
    if (result.urlAlias) lines.push(`**URL:** ${result.urlAlias}`);
    if (result.description) lines.push(`\n## Description\n\n${result.description}`);
    if (result.profileOverview) lines.push(`\n## Overview\n\n${result.profileOverview}`);
    if (result.keyContent?.length) {
      lines.push('\n## Key Content');
      for (const kc of result.keyContent) lines.push(`- [${kc.title}](${kc.url})`);
    }
    if (result.appealsResponsePlans?.length) {
      lines.push('\n## Appeals & Response Plans');
      for (const ap of result.appealsResponsePlans) {
        lines.push(`- [${ap.title}](${ap.url})${ap.date ? ` (${ap.date})` : ''}`);
      }
    }
    if (result.usefulLinks?.length) {
      lines.push('\n## Useful Links');
      for (const ul of result.usefulLinks) lines.push(`- [${ul.title}](${ul.url})`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
