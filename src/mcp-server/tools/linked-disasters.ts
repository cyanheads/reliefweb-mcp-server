/**
 * @fileoverview The disasters a report is linked to, as both report tools return them
 * (`reliefweb_search_reports`, `reliefweb_get_report`). One schema and one renderer, so a
 * report's disasters read the same in a search row and in the full record.
 * @module mcp-server/tools/linked-disasters
 */

import { z } from '@cyanheads/mcp-ts-core';
import { escapeMarkdownInline } from '@cyanheads/mcp-ts-core/utils';

/** A report's `disasters` field. Each tool marks it optional the way its own schema does. */
export const LINKED_DISASTERS = z
  .array(
    z
      .object({
        id: z
          .number()
          .describe(
            'ReliefWeb disaster ID — pass it to reliefweb_get_disaster, or as disaster_id to reliefweb_search_reports for the reports on the same disaster.',
          ),
        name: z.string().describe('Disaster name.'),
        glide: z.string().optional().describe('GLIDE number, when the disaster has one.'),
      })
      .describe('A disaster this report is linked to.'),
  )
  .describe('Disasters ReliefWeb links this report to. Absent when the report links none.');

/** The `**Disasters:**` line: each name with its ID and, when it has one, its GLIDE number. */
export function linkedDisastersLine(
  disasters: Array<{ glide?: string | undefined; id: number; name: string }>,
): string {
  const entries = disasters.map(
    (d) =>
      `${escapeMarkdownInline(d.name)} (ID ${d.id}${d.glide ? `, GLIDE ${escapeMarkdownInline(d.glide)}` : ''})`,
  );
  return `**Disasters:** ${entries.join('; ')}`;
}
