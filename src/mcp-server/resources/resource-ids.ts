/**
 * @fileoverview Numeric-ID parsing for the URI-templated resources.
 * @module mcp-server/resources/resource-ids
 */

import { validationError } from '@cyanheads/mcp-ts-core/errors';

/** A positive base-10 integer and nothing else — no sign, no separator, no leading zero. */
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

/**
 * Reads a ReliefWeb record ID out of a URI segment, requiring the whole segment to be one.
 * `parseInt` stops at the first character it cannot read, so `4221539junk` used to resolve
 * to report 4221539 and `1.5` to record 1 — a malformed URI silently served a different
 * record than the one requested, with nothing in the response to say so. `subject` names
 * the record type for the rejection message (e.g. `'report'`).
 */
export function parseResourceId(value: string, subject: string): number {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    throw validationError(
      `Invalid ${subject} ID "${value}". The whole ID must be digits only, exactly as ReliefWeb writes it — no leading zero, sign, decimal point, exponent, whitespace, or trailing characters.`,
      { id: value },
    );
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) {
    throw validationError(
      `The ${subject} ID "${value}" is larger than any ReliefWeb record ID and cannot be represented exactly.`,
      { id: value },
    );
  }
  return id;
}
