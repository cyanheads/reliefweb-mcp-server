/**
 * @fileoverview Pagination arithmetic and the empty-page notice shared by the search and
 * list tools.
 * @module mcp-server/tools/pagination
 */

/**
 * Offset of the last reachable page for a result set of `totalCount` at `limit` per page.
 * Page-aligned, so the returned offset is one an unchanged `limit` can actually be paged
 * to. Zero when the set fits in a single page.
 */
export function lastPageOffset(totalCount: number, limit: number): number {
  return Math.max(0, Math.floor((totalCount - 1) / limit) * limit);
}

/**
 * Notice for an empty page that is empty only because the offset ran past the end. Keying
 * an empty-result message on `items.length === 0` alone describes a query that matched
 * thousands of records as one that matched nothing, and sends the caller off to loosen
 * filters that were never the problem — so this branch names the count and the offset that
 * reaches the last page instead. `subject` is the plural noun for what was queried
 * (e.g. `'reports'`).
 */
export function pagedPastEndNotice(args: {
  subject: string;
  offset: number;
  totalCount: number;
  limit: number;
}): string {
  const { subject, offset, totalCount, limit } = args;
  return (
    `Offset ${offset} is past the end of this result set — ${totalCount} ${subject} matched, ` +
    `so the last page starts at offset ${lastPageOffset(totalCount, limit)}. ` +
    'The filters are fine; re-run with an offset inside that range.'
  );
}
