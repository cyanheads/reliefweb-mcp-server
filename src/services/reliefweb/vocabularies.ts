/**
 * @fileoverview Closed-vocabulary filter values for ReliefWeb — the verified value sets
 * for report `format.name` and disaster `status`, resolution of a caller's spelling to the
 * canonical one, and the rejection message naming what is valid.
 * @module services/reliefweb/vocabularies
 */

/**
 * Complete `format.name` vocabulary for reports, ordered by corpus size. Verified against
 * the API's own `format.name` facet, whose per-value counts sum to the unfiltered
 * `totalCount` under every preset — so this is the closed set, not a sample.
 */
export const REPORT_FORMATS = [
  'News and Press Release',
  'Situation Report',
  'Map',
  'Infographic',
  'Analysis',
  'Other',
  'Assessment',
  'Manual and Guideline',
  'Appeal',
  'UN Document',
  'Evaluation and Lessons Learned',
] as const;

/**
 * Complete `status` vocabulary for disasters, verified the same way. `alert-archive` is
 * reachable only under the `analysis` preset — the `latest` preset's facet returns just
 * `alert`, `ongoing`, and `past` — so asking for it without `include_archived: true`
 * legitimately matches nothing.
 */
export const DISASTER_STATUSES = ['alert', 'ongoing', 'past', 'alert-archive'] as const;

/** Outcome of resolving caller-supplied tokens against a closed vocabulary. */
export interface VocabularyResolution {
  /** Tokens that matched no vocabulary entry, in the caller's own spelling. */
  unmatched: string[];
  /**
   * Canonical spelling of every token, comma-joined in the caller's order. Absent when the
   * input was blank, omitted, or nothing but separators, and when any token failed to match
   * — a partial value would silently drop the filter the caller asked for.
   */
  value?: string;
}

/**
 * Comparison key for a vocabulary entry or a caller's token: lower-cased, `&` read as
 * `and`, every other non-alphanumeric run dropped. `format.name` is an analyzed field
 * upstream, so `"News & Press Release"`, `"News  and  Press  Release"`, and
 * `"news-and-press-release"` all return the same 644k reports as the canonical spelling;
 * the key keeps those spellings resolving instead of rejecting them. It also makes the
 * hyphen in `alert-archive` optional, which upstream is strict about.
 */
function matchKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Resolves a caller's filter value to the vocabulary's canonical spelling. Matching is done
 * here, on `matchKey`-normalized tokens, rather than by a schema-level `z.enum`, which does
 * exact single-literal matching and would reject every spelling variant that works today.
 *
 * `multiValue` splits on commas and resolves each token independently, for the fields the
 * service sends upstream as an array. The canonical value is what callers must send to the
 * service and echo in `appliedFilters`, so both response paths report the query that ran.
 */
export function resolveVocabulary(
  value: string | undefined,
  vocabulary: readonly string[],
  options: { multiValue?: boolean } = {},
): VocabularyResolution {
  const trimmed = value?.trim();
  if (!trimmed) return { unmatched: [] };

  const tokens = options.multiValue
    ? trimmed
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
    : [trimmed];

  const canonical: string[] = [];
  const unmatched: string[] = [];
  for (const token of tokens) {
    const key = matchKey(token);
    const match = key ? vocabulary.find((entry) => matchKey(entry) === key) : undefined;
    if (match) canonical.push(match);
    else unmatched.push(token);
  }

  if (unmatched.length > 0 || canonical.length === 0) return { unmatched };
  return { value: canonical.join(','), unmatched };
}

/**
 * Rejection message for tokens outside a closed vocabulary. Names every valid value inline:
 * a typo previously travelled to ReliefWeb and came back as an empty page whose notice
 * advised broadening the search, which sends the caller to loosen filters that were never
 * the problem.
 */
export function unknownValueMessage(
  field: string,
  unmatched: readonly string[],
  vocabulary: readonly string[],
): string {
  const quoted = unmatched.map((token) => `"${token}"`).join(', ');
  const noun = unmatched.length === 1 ? 'value' : 'values';
  return (
    `Unknown ${field} ${noun} ${quoted}. Valid values: ${vocabulary.join(', ')}. ` +
    'Matching ignores case, spacing, and punctuation.'
  );
}
