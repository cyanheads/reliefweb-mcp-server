/**
 * @fileoverview Render plain-text notices while preserving their structured values.
 * @module mcp-server/tools/plain-text-notice
 */
import { escapeMarkdownInline } from '@cyanheads/mcp-ts-core/utils';

/** Encodes the notice at the content boundary; enrichment retains the original text. */
export function renderPlainTextNotice(notice: string): string {
  return escapeMarkdownInline(notice)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}
