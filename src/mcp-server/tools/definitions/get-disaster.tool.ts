/**
 * @fileoverview Fetch a single ReliefWeb disaster record by ID with full details.
 * Oversized records return a section outline instead, which a `sections` re-call resolves;
 * an `archive` call returns a bounded page of one curated list's archived entries in place
 * of the record.
 * @module mcp-server/tools/definitions/get-disaster
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
const DISASTER_IDENTITY = ['id', 'name', 'urlAlias'];

/** Separates the two selectors where a caller reading only the schema would meet them. */
const SECTIONS_VS_ARCHIVE =
  ' This names parts of the record itself and never reaches archived entries — use archive for those.';

/**
 * Every field the full arm can carry. Declared required here and made `.partial()` in
 * `output` so the outline arm — which carries none of them — is a valid response too.
 */
const DisasterFields = z.object({
  id: z.number().describe('ReliefWeb numeric disaster ID.'),
  name: z.string().describe('Disaster name.'),
  status: z.string().describe('Disaster status: alert, ongoing, past, or alert-archive.'),
  glide: z.string().describe('GLIDE number for cross-system correlation.'),
  dateEvent: z.string().describe('Event date (ISO 8601), when available.'),
  dateCreated: z.string().describe('ReliefWeb index date (ISO 8601).'),
  primaryCountry: z.string().describe('Primary affected country.'),
  countries: z.array(z.string()).describe('All countries tagged on this disaster.'),
  types: z.array(z.string()).describe('Disaster type names.'),
  primaryType: z.string().describe('Primary disaster type.'),
  urlAlias: z.string().describe('Canonical ReliefWeb URL for this disaster.'),
  description: z.string().describe('Full disaster description text.'),
  profileOverview: z.string().describe('Profile overview text from the ReliefWeb editorial team.'),
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
      'Currently-active curated key content links from the ReliefWeb editorial team — the present curated set. The archived entries are reachable with archive: { list: "keyContent" }.',
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
      'Currently-active appeals and response plans linked to this disaster — the present set. The archived entries are reachable with archive: { list: "appealsResponsePlans" }.',
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

const DisasterOutput = z.object({
  kind: PROFILE_KIND,
  ...DisasterFields.partial().shape,
  sections: OUTLINE_SECTIONS,
  outlineNotice: OUTLINE_NOTICE,
  archive: ARCHIVE_PAGE,
});

export const reliefwebGetDisaster = tool('reliefweb_get_disaster', {
  title: 'Get ReliefWeb Disaster',
  description:
    'Fetch a disaster record by ReliefWeb numeric ID including description, affected countries, GLIDE number, ' +
    'profile overview, key content links, and active appeals or response plans. ' +
    'Use after reliefweb_search_disasters to retrieve full details. ' +
    'Each curated list also has an archive, which the record leaves out. ' +
    "Two alternative selectors, at most one per call: sections names parts of the record to return, archive pages one list's archived entries in place of the record. " +
    'Description and profile overview can together run to tens of KB for major disasters. A record over the response budget ' +
    'comes back as a section outline naming every section and its byte size. Nothing is truncated on any path.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    id: z
      .number()
      .int()
      .positive()
      .describe('ReliefWeb numeric disaster ID. Obtained from reliefweb_search_disasters results.'),
    sections: sectionsInput('disaster', SECTIONS_VS_ARCHIVE),
    archive: archiveInput('disaster'),
  }),
  output: DisasterOutput,
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No disaster found with the given ID.',
      recovery:
        'Verify the ID is a valid ReliefWeb numeric disaster ID from reliefweb_search_disasters results.',
    },
    {
      reason: 'selector_conflict',
      code: JsonRpcErrorCode.ValidationError,
      when: 'The call supplied both sections and archive, which select different things.',
      recovery:
        "Send sections to slice the record, or archive to page one curated list's archived entries — not both in one call.",
    },
  ],

  async handler(input, ctx) {
    if (input.archive && input.sections?.length) {
      throw ctx.fail('selector_conflict', SELECTOR_CONFLICT, {
        ...ctx.recoveryFor('selector_conflict'),
      });
    }
    ctx.log.info('reliefweb_get_disaster', {
      id: input.id,
      sections: input.sections,
      archive: input.archive?.list,
    });

    if (input.archive) {
      const { list, offset, limit } = input.archive;
      const found = await getReliefWebService().getDisasterArchive(input.id, list, ctx);
      if (!found) {
        throw ctx.fail(
          'not_found',
          `No disaster found with ID ${input.id}. Verify the ID from reliefweb_search_disasters.`,
          { ...ctx.recoveryFor('not_found') },
        );
      }
      const { entries, ...identity } = found;
      return {
        ...identity,
        kind: 'archive' as const,
        archive: archivePage(list, entries, offset, limit),
      };
    }

    const disaster = await getReliefWebService().getDisaster(input.id, ctx);
    if (!disaster) {
      throw ctx.fail(
        'not_found',
        `No disaster found with ID ${input.id}. Verify the ID from reliefweb_search_disasters.`,
        { ...ctx.recoveryFor('not_found') },
      );
    }
    return documentOrOutline(disaster, input.sections, DISASTER_IDENTITY);
  },

  format: (result) => [
    ...(result.id != null ? renderDisaster(result) : []),
    ...renderOutline(result),
    ...renderArchive(result),
  ],
});

/**
 * Renders the full arm — keyed on `id` presence by the caller, never on `kind`, so the
 * parity walk (one synthetic sample carrying every optional field at once) reaches both
 * arms.
 */
function renderDisaster(result: z.infer<typeof DisasterOutput>) {
  const lines: string[] = [`# ${result.name ?? `Disaster ${result.id}`}`];
  lines.push(`**ID:** ${result.id}`);
  lines.push(`**Mode:** ${result.kind}`);
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
  lines.push(...curatedLinkLines(result));
  return [{ type: 'text' as const, text: lines.join('\n') }];
}
