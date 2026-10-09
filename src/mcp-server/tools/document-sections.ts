/**
 * @fileoverview Shared outline-on-overflow wiring for the five by-ID detail tools
 * (`reliefweb_get_report`, `reliefweb_get_disaster`, `reliefweb_get_country`,
 * `reliefweb_get_job`, `reliefweb_get_training`). The mechanism itself is the framework
 * primitive (`outlineOnOverflow` / `selectSections` / `formatOutline` from
 * `@cyanheads/mcp-ts-core/utils`); this module only pins the input field, the output
 * arms, and the renderer so all five tools behave identically.
 * @module mcp-server/tools/document-sections
 */

import { z } from '@cyanheads/mcp-ts-core';
import type { OutlinePayload } from '@cyanheads/mcp-ts-core/utils';
import {
  formatOutline,
  OUTLINE_VARIANT,
  outlineOnOverflow,
  selectSections,
} from '@cyanheads/mcp-ts-core/utils';

/**
 * MCP content blocks, taken from the framework's own outline renderer. Derived rather
 * than imported from `@modelcontextprotocol/sdk` — the SDK reaches this project only
 * through the framework, so naming it directly would be an undeclared dependency.
 */
type ContentBlocks = ReturnType<typeof formatOutline>;

/**
 * The `kind` discriminator. `tool()` requires `output` to be a flat `z.object`, so the
 * full and outline modes are optional arms of one object rather than union branches.
 */
export const OUTLINE_KIND = z
  .enum(['full', 'outline'])
  .describe(
    'full when the record — or the sections asked for — is returned in whole; outline when the record exceeded the response budget and only its section index is returned.',
  );

/**
 * The outline arm's section index — the framework's own entry schema, with the element
 * description `describe-on-fields` wants on an array of objects.
 */
export const OUTLINE_SECTIONS = z
  .array(
    OUTLINE_VARIANT.shape.sections.element.describe(
      'One retrievable section of the record: its name and its serialized size.',
    ),
  )
  .describe(
    'Every section of the record, largest first. Pass the names back in `sections` to retrieve them.',
  )
  .optional();

/**
 * The outline arm's re-call notice, from the framework's outline variant. Named
 * `outlineNotice` rather than `notice` in `output` because it belongs to one arm of a flat
 * two-mode object, not to the record.
 */
export const OUTLINE_NOTICE = OUTLINE_VARIANT.shape.notice
  .describe('How to re-call this tool for specific sections of the record.')
  .optional();

/**
 * The `sections` selector input. `subject` names the record type in prose
 * (e.g. `'report'`), so each tool reads naturally without drifting in behavior. `alsoNote`
 * appends a tool-specific sentence — the curated-profile tools use it to separate this
 * selector from their `archive` selector, which the other tools do not have.
 */
export function sectionsInput(subject: string, alsoNote = '') {
  return z
    .array(z.string().describe('A section name exactly as the outline response spelled it.'))
    .optional()
    .describe(
      `Sections of the ${subject} record to return, named by the sections[].name values an outline response lists. ` +
        'Omit for the whole record, or for a section outline when the record is over the response budget. ' +
        'Records are sparse, so a name this record does not carry is rejected with the names it does. ' +
        "Identity metadata — the record's ID, its name, and its canonical URL — comes back alongside whatever is requested. " +
        'The call is self-contained — the record is re-fetched and sliced, so no prior call has to be repeated.' +
        alsoNote,
    );
}

/**
 * The document when it fits, an outline when it does not, or the requested slice when
 * `sections` was supplied. Selection re-fetches rather than remembering: the upstream
 * lookup is deterministic on the ID, so the outline call and the selection call see the
 * same record. Budget is the framework default, identical across all five tools — a
 * per-tool threshold would make the same overflow behave differently by record type.
 */
export function documentOrOutline<T extends object>(
  doc: T,
  sections: string[] | undefined,
  alwaysKeep: string[],
): OutlineArm<T> {
  /**
   * Both helpers are pure top-level key operations, but declare the index signature
   * TypeScript never infers for an `interface`. The cast is the only bridge; the record
   * comes back typed as the document it went in as.
   */
  const record = doc as unknown as Record<string, unknown>;
  if (sections?.length) {
    return {
      ...(selectSections(record, sections, { alwaysKeep }) as Partial<T>),
      kind: 'full' as const,
    };
  }
  const result = outlineOnOverflow(record);
  if (result.kind === 'outline') {
    return { kind: 'outline', sections: result.sections, outlineNotice: result.notice };
  }
  return { ...(result as unknown as Partial<T>), kind: 'full' as const };
}

/** What {@link documentOrOutline} returns: the record (or a slice of it), or its outline. */
export type OutlineArm<T> =
  | (Partial<T> & { kind: 'full' })
  | {
      kind: 'outline';
      outlineNotice: OutlinePayload['notice'];
      sections: OutlinePayload['sections'];
    };

/**
 * Renders the outline arm. Keyed on `sections` presence, never on `kind`: each arm's own
 * fields decide whether it renders, so every mode reaches `content[]` complete. Branching
 * on `kind` would drop the untaken arms, and the `format-parity` linter only partly
 * guards that — it walks one synthetic sample carrying every optional field at once, but
 * pins `kind` to a single enum member, so it flags a branch on any other member and
 * passes a branch on that one. The per-mode tests are what close the gap.
 *
 * The mode line carries `kind` onto `content[]` so the markdown surface says which mode
 * produced it, same as `structuredContent` does; it renders verbatim and is typed as a
 * plain string so a tool that adds a mode of its own still renders through here. Nothing
 * unvalidated reaches it — every caller's `kind` comes from its own `output` enum, which
 * `tool()` enforces at compile time and re-parses at runtime.
 */
export function renderOutline(result: {
  kind: string;
  outlineNotice?: string | undefined;
  sections?: Array<{ bytes: number; name: string }> | undefined;
}): ContentBlocks {
  if (!result.sections) return [];
  return [
    { type: 'text', text: `**Mode:** ${result.kind}` },
    ...formatOutline({
      kind: 'outline',
      sections: result.sections,
      notice: result.outlineNotice ?? '',
    }),
  ];
}
