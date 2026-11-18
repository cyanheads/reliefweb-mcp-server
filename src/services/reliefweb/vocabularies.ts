/**
 * @fileoverview Closed-vocabulary filter values for ReliefWeb — the verified value sets for
 * report `format.name`, disaster `status`, training `cost`, `theme.name`,
 * `career_categories.name`, and job `type.name`; resolution of a caller's spelling to the
 * canonical one; and the rejection message naming what is valid.
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

/** Complete training cost vocabulary; listings without cost metadata remain unclassified. */
export const TRAINING_COSTS = ['free', 'fee-based'] as const;

/**
 * Complete `theme.name` vocabulary, shared by reports and jobs, ordered by report count and
 * verified against the facet the same way. Reports carry all 20; jobs carry 17 (never
 * Contributions, Humanitarian Financing, or Logistics and Telecommunications), so those three
 * resolve on jobs and honestly return an empty page.
 */
export const THEMES = [
  'Protection and Human Rights',
  'Health',
  'Food and Nutrition',
  'Shelter and Non-Food Items',
  'Water Sanitation Hygiene',
  'Agriculture',
  'Coordination',
  'Education',
  'Contributions',
  'Recovery and Reconstruction',
  'Peacekeeping and Peacebuilding',
  'Logistics and Telecommunications',
  'Disaster Management',
  'Safety and Security',
  'Climate Change and Environment',
  'Gender',
  'Camp Coordination and Camp Management',
  'Mine Action',
  'HIV/Aids',
  'Humanitarian Financing',
] as const;

/**
 * Complete `career_categories.name` vocabulary, shared by jobs and training, ordered by job
 * count. Jobs carry all 12; training carries 11 (never Legal/Compliance).
 */
export const CAREER_CATEGORIES = [
  'Program/Project Management',
  'Monitoring and Evaluation',
  'Administration/Finance',
  'Advocacy/Communications',
  'Human Resources',
  'Logistics/Procurement',
  'Donor Relations/Grants Management',
  'Information Management',
  'Information and Communications Technology',
  'Other',
  'Medical/Clinical',
  'Legal/Compliance',
] as const;

/**
 * Complete job `type.name` vocabulary, the same five values on open and archived postings.
 * A posting carries at most one type, so several values only make sense combined with OR.
 */
export const JOB_TYPES = [
  'Job',
  'Consultancy',
  'Internship',
  'Tender/RFPs/EOIs',
  'Volunteer Opportunity',
] as const;

/** How {@link resolveVocabulary} reads a caller's value beyond whole canonical names. */
export interface VocabularyOptions {
  /**
   * Abbreviations that each name one entry, keyed by the abbreviation and matched on the same
   * case-, spacing-, and punctuation-blind key as the entries.
   */
  aliases?: Readonly<Record<string, string>>;
  /** Split on commas and resolve each value, for fields the service sends as an array. */
  multiValue?: boolean;
  /** Also resolve words that pick out one entry — see `resolveWords`. */
  wordMatch?: boolean;
}

/**
 * Theme matching, shared by every tool that filters on theme: comma-separated themes, the
 * standard cluster abbreviations, and the word rule.
 */
export const THEME_MATCHING = {
  aliases: {
    WASH: 'Water Sanitation Hygiene',
    CCCM: 'Camp Coordination and Camp Management',
    NFI: 'Shelter and Non-Food Items',
  },
  multiValue: true,
  wordMatch: true,
} as const satisfies VocabularyOptions & {
  aliases: Readonly<Record<string, (typeof THEMES)[number]>>;
};

/** Career-category matching, shared by jobs and training. */
export const CAREER_CATEGORY_MATCHING = {
  aliases: {
    ICT: 'Information and Communications Technology',
    'M&E': 'Monitoring and Evaluation',
    HR: 'Human Resources',
  },
  multiValue: true,
  wordMatch: true,
} as const satisfies VocabularyOptions & {
  aliases: Readonly<Record<string, (typeof CAREER_CATEGORIES)[number]>>;
};

/** Job-type matching: comma-separated types and the word rule (`Tender`, `Volunteer`). */
export const JOB_TYPE_MATCHING = {
  multiValue: true,
  wordMatch: true,
} as const satisfies VocabularyOptions;

/** Outcome of resolving caller-supplied tokens against a closed vocabulary. */
export interface VocabularyResolution {
  /** Tokens that matched no vocabulary entry, in the caller's own spelling. */
  unmatched: string[];
  /**
   * Canonical spelling of every token, comma-joined in the caller's order — or, under
   * `wordMatch`, the one entry a list's words pick out together. Absent when the input was
   * blank, omitted, or nothing but separators, and when any token failed to match — a
   * partial value would silently drop the filter the caller asked for.
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

/** A name's or a caller's words: lower-cased alphanumeric runs, with `and` dropped. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && word !== 'and');
}

/** Every word in the vocabulary, mapped to the entries that contain it. */
function wordOwners(vocabulary: readonly string[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const entry of vocabulary) {
    // A word repeated inside one name (Camp … Camp) still belongs to that name alone.
    for (const word of new Set(wordsOf(entry))) {
      const entries = owners.get(word);
      if (entries) entries.push(entry);
      else owners.set(word, [entry]);
    }
  }
  return owners;
}

/**
 * The one entry that `text`'s words pick out, or `undefined`. ReliefWeb's analyzed name
 * fields match a record when each word of the value appears in any of its tags, so a value
 * returns exactly one entry's records — and no records carrying only other tags — when all of
 * its words lie inside that entry and at least one of them lies in no other. That is the rule
 * here, so every word-form that is correct today keeps resolving, while a word shared by two
 * names (`Food`), words drawn from two names (`Food Security`, `Health Protection`), and
 * words whose only home is shared (`Coordination Management`, which today also returns
 * Coordination ∩ Disaster Management) are rejected rather than sent to the exact field under
 * one guessed name.
 */
function resolveWords(
  text: string,
  owners: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  const homes: (readonly string[])[] = [];
  let owner: string | undefined;
  for (const word of wordsOf(text)) {
    const entries = owners.get(word);
    if (!entries) return;
    const [first] = entries;
    if (entries.length === 1 && first !== owner) {
      if (owner !== undefined) return;
      owner = first;
    }
    homes.push(entries);
  }
  const resolved = owner;
  if (resolved === undefined) return;
  return homes.every((entries) => entries.includes(resolved)) ? resolved : undefined;
}

/**
 * Resolves a caller's filter value to the vocabulary's canonical spelling. Matching is done
 * here, on `matchKey`-normalized tokens, rather than by a schema-level `z.enum`, which does
 * exact single-literal matching and would reject every spelling variant that works today.
 *
 * `multiValue` splits on commas and resolves each value independently, for the fields the
 * service sends upstream as an array. Each value resolves to the entry with the same key,
 * else an alias with the same key, else — with `wordMatch` — the entry its words pick out.
 * Under `wordMatch`, a comma list whose words together pick out one entry is that entry:
 * upstream reads commas as word breaks, so `Food, Nutrition` has always meant Food and
 * Nutrition alone. The canonical value is what callers must send to the service and echo in
 * `appliedFilters`, so both response paths report the query that ran.
 */
export function resolveVocabulary(
  value: string | undefined,
  vocabulary: readonly string[],
  options: VocabularyOptions = {},
): VocabularyResolution {
  const trimmed = value?.trim();
  if (!trimmed) return { unmatched: [] };

  const tokens = options.multiValue
    ? trimmed
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
    : [trimmed];

  const byKey = new Map<string, string>();
  for (const entry of vocabulary) {
    const key = matchKey(entry);
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  for (const [alias, entry] of Object.entries(options.aliases ?? {})) {
    const key = matchKey(alias);
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  const owners = options.wordMatch ? wordOwners(vocabulary) : undefined;

  if (owners && tokens.length > 1) {
    const whole = resolveWords(trimmed, owners);
    if (whole) return { value: whole, unmatched: [] };
  }

  const canonical: string[] = [];
  const unmatched: string[] = [];
  for (const token of tokens) {
    const match = byKey.get(matchKey(token)) ?? (owners && resolveWords(token, owners));
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
 * the problem. Pass the field's `options` so the message also names its abbreviations and
 * the word rule.
 */
export function unknownValueMessage(
  field: string,
  unmatched: readonly string[],
  vocabulary: readonly string[],
  options: VocabularyOptions = {},
): string {
  const quoted = unmatched.map((token) => `"${token}"`).join(', ');
  const noun = unmatched.length === 1 ? 'value' : 'values';
  const message = `Unknown ${field} ${noun} ${quoted}. Valid values: ${vocabulary.join(', ')}. Matching ignores case, spacing, and punctuation.`;
  const aliases = Object.keys(options.aliases ?? {});
  const alsoAccepted = [
    ...(aliases.length > 0 ? [`the abbreviations ${aliases.join(', ')}`] : []),
    ...(options.wordMatch ? ['any word found in only one name'] : []),
  ];
  return alsoAccepted.length > 0
    ? `${message} Also accepted: ${alsoAccepted.join(', and ')}.`
    : message;
}
