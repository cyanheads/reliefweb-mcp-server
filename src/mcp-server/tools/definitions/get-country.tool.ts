/**
 * @fileoverview Fetch a ReliefWeb country profile by ISO3 code.
 * @module mcp-server/tools/definitions/get-country
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

export const reliefwebGetCountry = tool('reliefweb_get_country', {
  title: 'Get ReliefWeb Country Profile',
  description:
    'Fetch a country profile from ReliefWeb by ISO3 code, including overview, humanitarian situation summary, ' +
    'key content links, active appeals and response plans, and useful external links. ' +
    'Country profiles are curated by OCHA editors and provide the authoritative situation summary for humanitarian responders.',
  annotations: { readOnlyHint: true },
  input: z.object({
    iso3: z
      .string()
      .length(3)
      .describe(
        "ISO 3166-1 alpha-3 country code (e.g., SYR, AFG, UKR). Used to look up the country's ReliefWeb profile.",
      ),
  }),
  output: z.object({
    id: z.number().describe('ReliefWeb numeric country ID.'),
    name: z.string().describe('Country name.'),
    iso3: z.string().optional().describe('ISO 3166-1 alpha-3 code.'),
    status: z.string().optional().describe('Humanitarian situation status.'),
    urlAlias: z.string().optional().describe('Canonical ReliefWeb URL for this country page.'),
    profileOverview: z
      .string()
      .optional()
      .describe('Situation overview text from the ReliefWeb editorial team.'),
    keyContent: z
      .array(
        z.object({
          title: z.string().describe('Link title.'),
          url: z.string().describe('Link URL.'),
        }),
      )
      .optional()
      .describe('Curated key content links maintained by ReliefWeb editors.'),
    appealsResponsePlans: z
      .array(
        z.object({
          title: z.string().describe('Appeal or response plan title.'),
          url: z.string().describe('Link URL.'),
          date: z.string().optional().describe('Publication date.'),
        }),
      )
      .optional()
      .describe('Active humanitarian appeals and response plans for this country.'),
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
      when: 'No country profile found for the given ISO3 code.',
      recovery:
        'Verify the ISO3 code is a valid ISO 3166-1 alpha-3 code (e.g., SYR, AFG, UKR). Use reliefweb_list_countries to browse available country codes.',
    },
  ],

  async handler(input, ctx) {
    const iso3 = input.iso3.trim().toUpperCase();
    ctx.log.info('reliefweb_get_country', { iso3 });
    const country = await getReliefWebService().getCountry(iso3, ctx);
    if (!country) {
      throw ctx.fail(
        'not_found',
        `No country profile found for ISO3 code "${iso3}". Verify the code is valid or use reliefweb_list_countries.`,
        { ...ctx.recoveryFor('not_found') },
      );
    }
    return country;
  },

  format: (result) => {
    const lines: string[] = [`# ${result.name}`];
    lines.push(`**ID:** ${result.id}`);
    if (result.iso3) lines.push(`**ISO3:** ${result.iso3}`);
    if (result.status) lines.push(`**Status:** ${result.status}`);
    if (result.urlAlias) lines.push(`**URL:** ${result.urlAlias}`);
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
