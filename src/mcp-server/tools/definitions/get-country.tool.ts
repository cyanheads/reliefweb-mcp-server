/**
 * @fileoverview Fetch a ReliefWeb country profile by ISO3 code. Oversized profiles return a
 * section outline instead, which a `sections` re-call resolves; an `archive` call returns a
 * bounded page of one curated list's archived entries in place of the profile.
 * @module mcp-server/tools/definitions/get-country
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  documentOrOutline,
  OUTLINE_NOTICE,
  OUTLINE_SECTIONS,
  renderOutline,
  sectionsInput,
} from '@/mcp-server/tools/document-sections.js';
import {
  ARCHIVE_PAGE,
  archiveInput,
  archivePage,
  curatedLinkLines,
  PROFILE_KIND,
  renderArchive,
  SELECTOR_CONFLICT,
} from '@/mcp-server/tools/profile-archive.js';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

/** Kept on every `sections` selection so a slice is still attributable to its record. */
const COUNTRY_IDENTITY = ['id', 'name', 'iso3', 'urlAlias'];

/** Separates the two selectors where a caller reading only the schema would meet them. */
const SECTIONS_VS_ARCHIVE =
  ' This names parts of the profile itself and never reaches archived entries — use archive for those.';

/**
 * Every field the full arm can carry. Declared required here and made `.partial()` in
 * `output` so the outline and archive arms — which carry none of the profile body — are
 * valid responses too.
 */
const CountryFields = z.object({
  id: z.number().describe('ReliefWeb numeric country ID.'),
  name: z.string().describe('Country name.'),
  iso3: z.string().describe('ISO 3166-1 alpha-3 code.'),
  status: z.string().describe('Humanitarian situation status.'),
  urlAlias: z.string().describe('Canonical ReliefWeb URL for this country page.'),
  profileOverview: z
    .string()
    .describe('Situation overview text from the ReliefWeb editorial team.'),
  keyContent: z
    .array(
      z
        .object({
          title: z.string().describe('Link title.'),
          url: z.string().describe('Link URL.'),
        })
        .describe('A curated key content link.'),
    )
    .describe(
      'Currently-active curated key content links maintained by ReliefWeb editors — the present curated set. The archived entries are reachable with archive: { list: "keyContent" }.',
    ),
  appealsResponsePlans: z
    .array(
      z
        .object({
          title: z.string().describe('Appeal or response plan title.'),
          url: z.string().describe('Link URL.'),
          date: z.string().optional().describe('Publication date.'),
        })
        .describe('An appeal or response plan entry.'),
    )
    .describe(
      'Currently-active humanitarian appeals and response plans for this country — the present set. The archived entries are reachable with archive: { list: "appealsResponsePlans" }.',
    ),
  usefulLinks: z
    .array(
      z
        .object({
          title: z.string().describe('Link title.'),
          url: z.string().describe('Link URL.'),
        })
        .describe('A useful external link.'),
    )
    .describe(
      'Currently-active useful external links curated by ReliefWeb editors — the present set. The archived entries are reachable with archive: { list: "usefulLinks" }.',
    ),
});

const CountryOutput = z.object({
  kind: PROFILE_KIND,
  ...CountryFields.partial().shape,
  sections: OUTLINE_SECTIONS,
  outlineNotice: OUTLINE_NOTICE,
  archive: ARCHIVE_PAGE,
});

export const reliefwebGetCountry = tool('reliefweb_get_country', {
  title: 'Get ReliefWeb Country Profile',
  description:
    'Fetch a country profile from ReliefWeb by ISO3 code, including overview, humanitarian situation summary, ' +
    'key content links, active appeals and response plans, and useful external links. ' +
    'Country profiles are curated by OCHA editors and provide the authoritative situation summary for humanitarian responders. ' +
    'Each curated list also has an archive — thousands of entries deep for a long-running crisis — which the profile leaves out. ' +
    "Two alternative selectors, at most one per call: sections names parts of the profile to return, archive pages one list's archived entries in place of the profile. " +
    'A profile over the response budget comes back as a section outline naming every section and its byte size. Nothing is truncated on any path.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    iso3: z
      .string()
      .length(3)
      .describe(
        "ISO 3166-1 alpha-3 country code (e.g., SYR, AFG, UKR). Used to look up the country's ReliefWeb profile.",
      ),
    sections: sectionsInput('country', SECTIONS_VS_ARCHIVE),
    archive: archiveInput('country'),
  }),
  output: CountryOutput,
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No country profile found for the given ISO3 code.',
      recovery:
        'Verify the ISO3 code is a valid ISO 3166-1 alpha-3 code (e.g., SYR, AFG, UKR). Use reliefweb_list_countries to browse available country codes.',
    },
    {
      reason: 'selector_conflict',
      code: JsonRpcErrorCode.ValidationError,
      when: 'The call supplied both sections and archive, which select different things.',
      recovery:
        "Send sections to slice the profile, or archive to page one curated list's archived entries — not both in one call.",
    },
  ],

  async handler(input, ctx) {
    const iso3 = input.iso3.trim().toUpperCase();
    if (input.archive && input.sections?.length) {
      throw ctx.fail('selector_conflict', SELECTOR_CONFLICT);
    }
    ctx.log.info('reliefweb_get_country', {
      iso3,
      sections: input.sections,
      archive: input.archive?.list,
    });

    if (input.archive) {
      const { list, offset, limit } = input.archive;
      const found = await getReliefWebService().getCountryArchive(iso3, list, ctx);
      if (!found) {
        throw ctx.fail(
          'not_found',
          `No country profile found for ISO3 code "${iso3}". Verify the code is valid or use reliefweb_list_countries.`,
        );
      }
      const { entries, ...identity } = found;
      return {
        ...identity,
        kind: 'archive' as const,
        archive: archivePage(list, entries, offset, limit),
      };
    }

    const country = await getReliefWebService().getCountry(iso3, ctx);
    if (!country) {
      throw ctx.fail(
        'not_found',
        `No country profile found for ISO3 code "${iso3}". Verify the code is valid or use reliefweb_list_countries.`,
      );
    }
    return documentOrOutline(country, input.sections, COUNTRY_IDENTITY);
  },

  format: (result) => [
    ...(result.id != null ? renderCountry(result) : []),
    ...renderOutline(result),
    ...renderArchive(result),
  ],
});

/**
 * Renders the record arm — keyed on `id` presence by the caller, never on `kind`, so the
 * parity walk (one synthetic sample carrying every optional field at once) reaches every
 * arm.
 */
function renderCountry(result: z.infer<typeof CountryOutput>) {
  const lines: string[] = [`# ${result.name ?? `Country ${result.id}`}`];
  lines.push(`**ID:** ${result.id}`);
  lines.push(`**Mode:** ${result.kind}`);
  if (result.iso3) lines.push(`**ISO3:** ${result.iso3}`);
  if (result.status) lines.push(`**Status:** ${result.status}`);
  if (result.urlAlias) lines.push(`**URL:** ${result.urlAlias}`);
  if (result.profileOverview) lines.push(`\n## Overview\n\n${result.profileOverview}`);
  lines.push(...curatedLinkLines(result));
  return [{ type: 'text' as const, text: lines.join('\n') }];
}
