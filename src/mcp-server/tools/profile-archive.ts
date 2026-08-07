/**
 * @fileoverview Shared curated-list wiring for the two curated-profile tools
 * (`reliefweb_get_country`, `reliefweb_get_disaster`). Those tools return only the active
 * half of each curated list; this module pins the input selector, the output page, the
 * pagination arithmetic, and the renderers for both halves, so the two tools page an archive
 * and present a list the same way.
 *
 * Two selectors live on those tools and they are deliberately different words for different
 * axes: `sections` (from `document-sections.ts`) names which parts of the record to return,
 * while `archive` names one curated list and replaces the record with a page of that list's
 * archived entries. They are alternative modes — supplying both is an error, not a merge.
 * @module mcp-server/tools/profile-archive
 */

import { z } from '@cyanheads/mcp-ts-core';
import type { ProfileArchiveEntry, ProfileArchiveList } from '@/services/reliefweb/types.js';
import { PROFILE_ARCHIVE_LISTS } from '@/services/reliefweb/types.js';

/** Upper bound on one archive page. Keeps a page bounded regardless of how deep the archive runs. */
export const ARCHIVE_MAX_LIMIT = 100;

/** Default archive page size — a readable page that leaves room for the record's own fields. */
export const ARCHIVE_DEFAULT_LIMIT = 25;

/**
 * The response mode. Extends the two modes `document-sections.ts` resolves (`full`,
 * `outline`) with the third a curated-profile tool can answer in.
 */
export const PROFILE_KIND = z
  .enum(['full', 'outline', 'archive'])
  .describe(
    "full when the record — or the sections asked for — is returned in whole; outline when the record exceeded the response budget and only its section index is returned; archive when the call asked for a page of one curated list's archived entries, which is returned in place of the record.",
  );

const ARCHIVE_LIST = z.enum(PROFILE_ARCHIVE_LISTS);

const ArchivePageShape = z.object({
  list: ARCHIVE_LIST.describe('The curated list this page was read from.'),
  total: z.number().describe('Total archived entries in that list for this record.'),
  shown: z.number().describe('Number of entries in this page.'),
  offset: z.number().describe('Zero-based index of the first entry in this page.'),
  nextOffset: z
    .number()
    .optional()
    .describe(
      'Offset to send back to read the next page. Absent when this page reaches the end of the archive.',
    ),
  entries: z
    .array(
      z
        .object({
          title: z.string().describe('Entry title.'),
          url: z.string().describe('Entry URL.'),
          date: z
            .string()
            .optional()
            .describe('Publication date, carried by appeals and response plans.'),
        })
        .describe('One archived entry.'),
    )
    .describe("The archived entries in this page, in ReliefWeb's own archive order."),
});

/** One page of archived entries, as it appears on `output`. */
export type ArchivePage = z.infer<typeof ArchivePageShape>;

/**
 * The archive arm of `output`. Present only on an archive-mode call; the record's own
 * fields carry identity metadata alongside it so a page is attributable to its record.
 */
export const ARCHIVE_PAGE = ArchivePageShape.optional().describe(
  "One page of a curated list's archived entries, returned in place of the record.",
);

/**
 * The `archive` selector input. `subject` names the record type in prose (e.g. `'country'`)
 * so each tool reads naturally without the two tools drifting in behavior.
 */
export function archiveInput(subject: string) {
  return z
    .object({
      list: ARCHIVE_LIST.describe(
        'Which curated list to page. The archived entries of that list are the ones the profile itself leaves out.',
      ),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe(
          'Zero-based index of the first archived entry to return. Send back the nextOffset from the previous page to continue.',
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(ARCHIVE_MAX_LIMIT)
        .default(ARCHIVE_DEFAULT_LIMIT)
        .describe(`Maximum archived entries in one page (1-${ARCHIVE_MAX_LIMIT}).`),
    })
    .optional()
    .describe(
      `Archive mode: return a page of one curated list's ARCHIVED entries instead of the ${subject} record. ` +
        'The response carries the record identity, the selected list, and total / shown / offset, plus a next offset while more entries remain. ' +
        'Mutually exclusive with sections — sections slices the record, archive replaces it — and a call supplying both is rejected. ' +
        'A record over the response budget still answers an archive call with the page: a page is bounded by limit and carries none of the record prose, so it never outlines.',
    );
}

/** Rejection text for a call that supplied both selectors. Shared so both tools say the same thing. */
export const SELECTOR_CONFLICT =
  "sections and archive are alternative modes and cannot be combined: sections returns named parts of the record, archive returns a page of one curated list's archived entries in place of the record. Send one or the other.";

/**
 * Slices the archive into a bounded page. `nextOffset` is present only while entries remain
 * past this page, so its absence is the end-of-archive signal rather than something the
 * caller has to derive from `total`. An offset past the end is a real, honest answer — an
 * empty page carrying the true total — not an error.
 */
export function archivePage(
  list: ProfileArchiveList,
  entries: ProfileArchiveEntry[],
  offset: number,
  limit: number,
): ArchivePage {
  const page = entries.slice(offset, offset + limit);
  const next = offset + page.length;
  return {
    list,
    total: entries.length,
    shown: page.length,
    offset,
    ...(next < entries.length ? { nextOffset: next } : {}),
    entries: page,
  };
}

/**
 * Renders the archive arm. Keyed on `archive` presence, never on `kind`, for the reason
 * `renderOutline` in `document-sections.ts` spells out: the arm's own field decides whether
 * it renders, and the `format-parity` linter pins `kind` to one enum member, so it cannot
 * flag a branch on that member.
 */
export function renderArchive(result: { archive?: ArchivePage | undefined }): Array<{
  text: string;
  type: 'text';
}> {
  const page = result.archive;
  if (!page) return [];
  const lines = [
    `\n## Archive — ${page.list}`,
    `**Total archived:** ${page.total} · **Shown:** ${page.shown} · **Offset:** ${page.offset}`,
    page.nextOffset === undefined
      ? '**Next offset:** none — this page reaches the end of the archive.'
      : `**Next offset:** ${page.nextOffset}`,
  ];
  if (page.entries.length === 0) {
    lines.push(
      page.total === 0
        ? '\nThis list has no archived entries.'
        : `\nNo archived entries at this offset — the archive holds ${page.total}, so the last one is at offset ${page.total - 1}.`,
    );
  }
  for (const entry of page.entries) {
    lines.push(`- [${entry.title}](${entry.url})${entry.date ? ` (${entry.date})` : ''}`);
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

/**
 * Renders the three curated link lists a country and a disaster both carry, in their active
 * half. Lives here so the two profile tools cannot present the same list differently — the
 * same guarantee the archive wiring above gives their archived half. Each list is keyed on
 * its own presence, so a sparse profile simply omits it.
 */
export function curatedLinkLines(result: {
  appealsResponsePlans?:
    | Array<{ date?: string | undefined; title: string; url: string }>
    | undefined;
  keyContent?: Array<{ title: string; url: string }> | undefined;
  usefulLinks?: Array<{ title: string; url: string }> | undefined;
}): string[] {
  const lines: string[] = [];
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
  return lines;
}
