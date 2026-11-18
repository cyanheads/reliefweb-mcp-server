/**
 * @fileoverview Tests for the closed-vocabulary helpers — case- and whitespace-tolerant
 * matching, comma-separated multi-value resolution, abbreviations, the word rule checked
 * against a model of ReliefWeb's analyzed-field matching, the rejection message, and linear
 * time over caller-sized input.
 * @module tests/services/vocabularies.test
 */

import { describe, expect, it } from 'vitest';
import {
  CAREER_CATEGORIES,
  CAREER_CATEGORY_MATCHING,
  DISASTER_STATUSES,
  JOB_TYPE_MATCHING,
  JOB_TYPES,
  REPORT_FORMATS,
  resolveVocabulary,
  THEME_MATCHING,
  THEMES,
  TRAINING_COSTS,
  unknownValueMessage,
  type VocabularyOptions,
} from '@/services/reliefweb/vocabularies.js';

describe('resolveVocabulary', () => {
  it('returns the canonical spelling for an exact match', () => {
    expect(resolveVocabulary('Situation Report', REPORT_FORMATS)).toEqual({
      value: 'Situation Report',
      unmatched: [],
    });
  });

  it('matches case-insensitively, as ReliefWeb does', () => {
    expect(resolveVocabulary('news and press release', REPORT_FORMATS).value).toBe(
      'News and Press Release',
    );
    expect(resolveVocabulary('NEWS AND PRESS RELEASE', REPORT_FORMATS).value).toBe(
      'News and Press Release',
    );
  });

  it('strips surrounding whitespace before matching', () => {
    expect(resolveVocabulary('  Situation Report  ', REPORT_FORMATS).value).toBe(
      'Situation Report',
    );
  });

  it('reads an ampersand as the word ReliefWeb spells out', () => {
    expect(resolveVocabulary('News & Press Release', REPORT_FORMATS).value).toBe(
      'News and Press Release',
    );
  });

  it('collapses doubled internal spaces, which ReliefWeb matches through', () => {
    expect(resolveVocabulary('News  and  Press  Release', REPORT_FORMATS).value).toBe(
      'News and Press Release',
    );
  });

  it('resolves the hyphenated slug spelling of a value', () => {
    expect(resolveVocabulary('news-and-press-release', REPORT_FORMATS).value).toBe(
      'News and Press Release',
    );
  });

  it('makes the hyphen optional on a hyphenated status, which upstream requires', () => {
    for (const spelling of ['alert archive', 'alert_archive', 'ALERT-ARCHIVE']) {
      expect(resolveVocabulary(spelling, DISASTER_STATUSES, { multiValue: true }).value).toBe(
        'alert-archive',
      );
    }
  });

  it('rejects a token that is only punctuation rather than matching everything', () => {
    expect(resolveVocabulary('---', REPORT_FORMATS)).toEqual({ unmatched: ['---'] });
  });

  it('still rejects a partial name, which names no single value', () => {
    expect(resolveVocabulary('Report', REPORT_FORMATS).unmatched).toEqual(['Report']);
    expect(resolveVocabulary('News', REPORT_FORMATS).unmatched).toEqual(['News']);
  });

  it('treats a blank or omitted value as no filter at all', () => {
    expect(resolveVocabulary(undefined, REPORT_FORMATS)).toEqual({ unmatched: [] });
    expect(resolveVocabulary('   ', REPORT_FORMATS)).toEqual({ unmatched: [] });
  });

  it('reports an unmatched token in the caller spelling and yields no value', () => {
    expect(resolveVocabulary('Policy Document', REPORT_FORMATS)).toEqual({
      unmatched: ['Policy Document'],
    });
  });

  it('does not split on commas unless asked — a comma is part of the single token', () => {
    expect(resolveVocabulary('Map,Analysis', REPORT_FORMATS)).toEqual({
      unmatched: ['Map,Analysis'],
    });
  });

  it('resolves each comma-separated token independently in multi-value mode', () => {
    expect(resolveVocabulary('ongoing,alert', DISASTER_STATUSES, { multiValue: true }).value).toBe(
      'ongoing,alert',
    );
  });

  it('canonicalizes and trims every token of a multi-value input', () => {
    expect(
      resolveVocabulary(' PAST , Alert-Archive ', DISASTER_STATUSES, { multiValue: true }).value,
    ).toBe('past,alert-archive');
  });

  it('withholds the whole value when any token of a multi-value input is unknown', () => {
    const resolution = resolveVocabulary('ongoing,current', DISASTER_STATUSES, {
      multiValue: true,
    });

    expect(resolution.value).toBeUndefined();
    expect(resolution.unmatched).toEqual(['current']);
  });

  it('drops empty tokens left by stray commas', () => {
    expect(resolveVocabulary('past,,', DISASTER_STATUSES, { multiValue: true })).toEqual({
      value: 'past',
      unmatched: [],
    });
  });
});

describe('unknownValueMessage', () => {
  it('quotes the rejected token and lists every valid value', () => {
    const message = unknownValueMessage('status', ['archive'], DISASTER_STATUSES);

    expect(message).toContain('"archive"');
    expect(message).toContain('alert, ongoing, past, alert-archive');
    expect(message).toContain('ignores case');
  });

  it('pluralizes when more than one token was rejected', () => {
    expect(unknownValueMessage('status', ['archive', 'current'], DISASTER_STATUSES)).toContain(
      'Unknown status values "archive", "current"',
    );
  });
});

describe('vocabularies', () => {
  it('resolves training costs without changing listing-language semantics', () => {
    expect(TRAINING_COSTS).toEqual(['free', 'fee-based']);
    expect(resolveVocabulary(' Fee Based ', TRAINING_COSTS)).toEqual({
      value: 'fee-based',
      unmatched: [],
    });
    expect(resolveVocabulary('FREE', TRAINING_COSTS)).toEqual({ value: 'free', unmatched: [] });
    expect(resolveVocabulary(' ', TRAINING_COSTS)).toEqual({ unmatched: [] });
    expect(resolveVocabulary('paid', TRAINING_COSTS)).toEqual({ unmatched: ['paid'] });
  });
  it('drops the format values ReliefWeb never returns and carries UN Document', () => {
    expect(REPORT_FORMATS).toContain('UN Document');
    expect(REPORT_FORMATS).not.toContain('Policy Document');
    expect(REPORT_FORMATS).not.toContain('Financial Report');
    expect(REPORT_FORMATS).toHaveLength(11);
  });

  it('names ongoing rather than current, and drops the archive status', () => {
    expect(DISASTER_STATUSES).toEqual(['alert', 'ongoing', 'past', 'alert-archive']);
  });
});

describe('format, disaster status, and cost keep whole-name matching', () => {
  it('rejects a word that appears in only one name — no word rule on these fields', () => {
    expect(resolveVocabulary('Press', REPORT_FORMATS)).toEqual({ unmatched: ['Press'] });
    expect(resolveVocabulary('Lessons', REPORT_FORMATS)).toEqual({ unmatched: ['Lessons'] });
    expect(resolveVocabulary('archive', DISASTER_STATUSES, { multiValue: true })).toEqual({
      unmatched: ['archive'],
    });
    expect(resolveVocabulary('fee', TRAINING_COSTS)).toEqual({ unmatched: ['fee'] });
  });

  it('keeps the rejection message text unchanged', () => {
    expect(unknownValueMessage('cost', ['paid'], TRAINING_COSTS)).toBe(
      'Unknown cost value "paid". Valid values: free, fee-based. Matching ignores case, spacing, and punctuation.',
    );
  });
});

// ─── Themes, career categories, and job types ────────────────────────────────

describe('theme, career-category, and job-type vocabularies', () => {
  it('carries the verified sets in their exact upstream spelling', () => {
    expect(THEMES).toHaveLength(20);
    expect(THEMES).toContain('HIV/Aids');
    expect(THEMES).toContain('Shelter and Non-Food Items');
    expect(CAREER_CATEGORIES).toHaveLength(12);
    expect(CAREER_CATEGORIES).toContain('Program/Project Management');
    expect(JOB_TYPES).toEqual([
      'Job',
      'Consultancy',
      'Internship',
      'Tender/RFPs/EOIs',
      'Volunteer Opportunity',
    ]);
  });

  it('holds no comma inside a name, since the service splits the joined value on commas', () => {
    for (const entry of [...THEMES, ...CAREER_CATEGORIES, ...JOB_TYPES]) {
      expect(entry).not.toContain(',');
    }
  });

  it.each([
    ['WASH', THEMES, THEME_MATCHING, 'Water Sanitation Hygiene'],
    ['wash', THEMES, THEME_MATCHING, 'Water Sanitation Hygiene'],
    ['CCCM', THEMES, THEME_MATCHING, 'Camp Coordination and Camp Management'],
    ['nfi', THEMES, THEME_MATCHING, 'Shelter and Non-Food Items'],
    [
      'ICT',
      CAREER_CATEGORIES,
      CAREER_CATEGORY_MATCHING,
      'Information and Communications Technology',
    ],
    ['M&E', CAREER_CATEGORIES, CAREER_CATEGORY_MATCHING, 'Monitoring and Evaluation'],
    ['m and e', CAREER_CATEGORIES, CAREER_CATEGORY_MATCHING, 'Monitoring and Evaluation'],
    ['hr', CAREER_CATEGORIES, CAREER_CATEGORY_MATCHING, 'Human Resources'],
  ] as const)('resolves the abbreviation %s', (abbreviation, vocabulary, options, canonical) => {
    expect(resolveVocabulary(abbreviation, vocabulary, options)).toEqual({
      value: canonical,
      unmatched: [],
    });
  });

  it('applies abbreviations only to their own field', () => {
    expect(resolveVocabulary('WASH', CAREER_CATEGORIES, CAREER_CATEGORY_MATCHING)).toEqual({
      unmatched: ['WASH'],
    });
    expect(resolveVocabulary('ICT', THEMES, THEME_MATCHING)).toEqual({ unmatched: ['ICT'] });
    expect(resolveVocabulary('HR', JOB_TYPES, JOB_TYPE_MATCHING)).toEqual({ unmatched: ['HR'] });
  });

  it('points every abbreviation at an entry of its own vocabulary', () => {
    for (const target of Object.values(THEME_MATCHING.aliases)) expect(THEMES).toContain(target);
    for (const target of Object.values(CAREER_CATEGORY_MATCHING.aliases)) {
      expect(CAREER_CATEGORIES).toContain(target);
    }
  });

  it.each([
    ['Gender,Mine Action', 'Gender,Mine Action'],
    ['health, wash', 'Health,Water Sanitation Hygiene'],
    ['Health, Nutrition', 'Health,Food and Nutrition'],
    // Upstream reads commas as word breaks: these have always returned one tag's records.
    ['Food, Nutrition', 'Food and Nutrition'],
    ['Protection, Human Rights', 'Protection and Human Rights'],
    ['Coordination, Camp', 'Camp Coordination and Camp Management'],
  ])('resolves the theme list %s to %s', (input, canonical) => {
    expect(resolveVocabulary(input, THEMES, THEME_MATCHING)).toEqual({
      value: canonical,
      unmatched: [],
    });
  });

  it.each([
    ['Food, Gender', ['Food']],
    ['Health and Nutrition', ['Health and Nutrition']],
    ['Food Security, WASH', ['Food Security']],
  ])('rejects the theme list %s, naming %j', (input, unmatched) => {
    expect(resolveVocabulary(input, THEMES, THEME_MATCHING)).toEqual({ unmatched });
  });

  it('resolves a job-type list value by value', () => {
    expect(resolveVocabulary('Consultancy, intern', JOB_TYPES, JOB_TYPE_MATCHING)).toEqual({
      unmatched: ['intern'],
    });
    expect(resolveVocabulary('consultancy, tender', JOB_TYPES, JOB_TYPE_MATCHING)).toEqual({
      value: 'Consultancy,Tender/RFPs/EOIs',
      unmatched: [],
    });
  });

  it('names the abbreviations and the word rule in the rejection message', () => {
    expect(unknownValueMessage('theme', ['Food'], THEMES, THEME_MATCHING)).toMatch(
      /^Unknown theme value "Food"\. Valid values: Protection and Human Rights, Health, .*, Humanitarian Financing\. Matching ignores case, spacing, and punctuation\. Also accepted: the abbreviations WASH, CCCM, NFI, and any word found in only one name\.$/,
    );
    expect(unknownValueMessage('job_type', ['RFP'], JOB_TYPES, JOB_TYPE_MATCHING)).toBe(
      'Unknown job_type value "RFP". Valid values: Job, Consultancy, Internship, Tender/RFPs/EOIs, Volunteer Opportunity. Matching ignores case, spacing, and punctuation. Also accepted: any word found in only one name.',
    );
  });
});

// ─── The word rule against ReliefWeb's analyzed matching ─────────────────────

/** A value's words as ReliefWeb's analyzer reads them: lower-cased alphanumeric runs, `and` ignored. */
function analyzedWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && word !== 'and');
}

/**
 * The tag whose records — and only those — a value returns from ReliefWeb's analyzed name
 * field, or `undefined`. A record matches when every word of the value appears in one of its
 * tags, any tag. So the value returns exactly tag E's records when a record tagged E alone
 * matches and a record carrying every tag except E — the largest record that lacks E — does
 * not.
 */
function oneTagToday(value: string, vocabulary: readonly string[]): string | undefined {
  const words = analyzedWords(value);
  if (words.length === 0) return;
  const tagWords = new Map(vocabulary.map((entry) => [entry, new Set(analyzedWords(entry))]));
  const matches = (tags: readonly string[]) =>
    words.every((word) => tags.some((tag) => tagWords.get(tag)?.has(word)));
  return vocabulary.find(
    (entry) => matches([entry]) && !matches(vocabulary.filter((other) => other !== entry)),
  );
}

/** The validation pass's token map: each single word that today returns one tag's records. */
const VALIDATED_THEME_WORDS: Record<string, string> = {
  action: 'Mine Action',
  agriculture: 'Agriculture',
  aids: 'HIV/Aids',
  camp: 'Camp Coordination and Camp Management',
  change: 'Climate Change and Environment',
  climate: 'Climate Change and Environment',
  contributions: 'Contributions',
  disaster: 'Disaster Management',
  education: 'Education',
  environment: 'Climate Change and Environment',
  financing: 'Humanitarian Financing',
  gender: 'Gender',
  health: 'Health',
  hiv: 'HIV/Aids',
  human: 'Protection and Human Rights',
  humanitarian: 'Humanitarian Financing',
  hygiene: 'Water Sanitation Hygiene',
  items: 'Shelter and Non-Food Items',
  logistics: 'Logistics and Telecommunications',
  mine: 'Mine Action',
  non: 'Shelter and Non-Food Items',
  nutrition: 'Food and Nutrition',
  peacebuilding: 'Peacekeeping and Peacebuilding',
  peacekeeping: 'Peacekeeping and Peacebuilding',
  protection: 'Protection and Human Rights',
  reconstruction: 'Recovery and Reconstruction',
  recovery: 'Recovery and Reconstruction',
  rights: 'Protection and Human Rights',
  safety: 'Safety and Security',
  sanitation: 'Water Sanitation Hygiene',
  security: 'Safety and Security',
  shelter: 'Shelter and Non-Food Items',
  telecommunications: 'Logistics and Telecommunications',
  water: 'Water Sanitation Hygiene',
};

const VALIDATED_CAREER_WORDS: Record<string, string> = {
  administration: 'Administration/Finance',
  advocacy: 'Advocacy/Communications',
  clinical: 'Medical/Clinical',
  compliance: 'Legal/Compliance',
  donor: 'Donor Relations/Grants Management',
  evaluation: 'Monitoring and Evaluation',
  finance: 'Administration/Finance',
  grants: 'Donor Relations/Grants Management',
  human: 'Human Resources',
  legal: 'Legal/Compliance',
  logistics: 'Logistics/Procurement',
  medical: 'Medical/Clinical',
  monitoring: 'Monitoring and Evaluation',
  other: 'Other',
  procurement: 'Logistics/Procurement',
  program: 'Program/Project Management',
  project: 'Program/Project Management',
  relations: 'Donor Relations/Grants Management',
  resources: 'Human Resources',
  technology: 'Information and Communications Technology',
};

describe.each([
  {
    field: 'theme',
    vocabulary: THEMES,
    options: THEME_MATCHING,
    // Canonical names resolve to their own tag even where the analyzed field also returns another's.
    validated: { ...VALIDATED_THEME_WORDS, coordination: 'Coordination' },
    canonicalOnly: { coordination: 'Coordination' },
  },
  {
    field: 'career category',
    vocabulary: CAREER_CATEGORIES,
    options: CAREER_CATEGORY_MATCHING,
    validated: VALIDATED_CAREER_WORDS,
    canonicalOnly: { 'information management': 'Information Management' },
  },
  {
    field: 'job type',
    vocabulary: JOB_TYPES,
    options: JOB_TYPE_MATCHING,
    validated: {
      job: 'Job',
      consultancy: 'Consultancy',
      internship: 'Internship',
      tender: 'Tender/RFPs/EOIs',
      rfps: 'Tender/RFPs/EOIs',
      eois: 'Tender/RFPs/EOIs',
      volunteer: 'Volunteer Opportunity',
      opportunity: 'Volunteer Opportunity',
    },
    canonicalOnly: {},
  },
] satisfies {
  field: string;
  vocabulary: readonly string[];
  options: VocabularyOptions;
  validated: Record<string, string>;
  canonicalOnly: Record<string, string>;
}[])('$field word rule', ({ vocabulary, options, validated, canonicalOnly }) => {
  const words = [...new Set(vocabulary.flatMap(analyzedWords)), 'and'];
  const resolved = (value: string) => resolveVocabulary(value, vocabulary, options).value;

  it('accepts exactly the single words of the validation token map', () => {
    const accepted = Object.fromEntries(
      [...words, 'agricultural', 'programme', 'rfp'].flatMap((word) => {
        const value = resolved(word);
        return value ? [[word, value]] : [];
      }),
    );
    expect(accepted).toEqual(validated);
  });

  it('resolves every one- and two-word value to the tag it returns alone today, and rejects the rest', () => {
    const values = [...words, ...words.flatMap((first) => words.map((s) => `${first} ${s}`))];
    const mismatches = values.flatMap((value) => {
      const expected =
        canonicalOnly[value as keyof typeof canonicalOnly] ?? oneTagToday(value, vocabulary);
      const actual = resolved(value);
      return actual === expected ? [] : [{ value, expected, actual }];
    });
    expect(mismatches).toEqual([]);
  });

  it('keeps every two-value comma list that returns one tag today on that tag', () => {
    const mismatches = words.flatMap((first) =>
      words.flatMap((second) => {
        const value = `${first}, ${second}`;
        const expected = oneTagToday(value, vocabulary);
        const actual = resolved(value);
        return expected === undefined || actual === expected ? [] : [{ value, expected, actual }];
      }),
    );
    expect(mismatches).toEqual([]);
  });
});

// ─── Linear time over caller-sized input ─────────────────────────────────────

/** 5k to 320k characters, doubling: a 64× span, over which linear predicts 64× and quadratic 4,096×. */
const SIZES = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 320_000] as const;
const BASE_SIZE = SIZES[0];
const MAX_GROWTH = 256;
/** Thread CPU milliseconds per call allowed at any size. */
const MAX_CALL_MS = 250;

/** `unit` repeated to exactly `n` characters. */
function repeatTo(unit: string, n: number): string {
  return unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
}

/** Thread CPU milliseconds per call over `calls` calls — a busy machine cannot inflate it. */
function cpuMsPerCall(work: () => void, calls: number): number {
  const start = process.threadCpuUsage();
  for (let call = 0; call < calls; call++) work();
  const { user, system } = process.threadCpuUsage(start);
  return (user + system) / 1_000 / calls;
}

/**
 * Asserts `work` runs in linear time in its input's length. The 5k baseline is timed over a
 * batch filling half a millisecond, since one call sits below the clock's resolution, and
 * re-timed beside every larger size so a pair shares one core's speed; each size keeps the
 * least of three pairs, since a pause only ever adds time. Each size is checked before the
 * next runs, so a super-linear path fails at a small size instead of hanging the suite.
 */
function expectLinearTime(work: (text: string) => void, text: (n: number) => string): void {
  const base = text(BASE_SIZE);
  let baseCalls = 1;
  while (cpuMsPerCall(() => work(base), baseCalls) * baseCalls < 0.5) baseCalls *= 2;
  for (const size of SIZES) {
    const input = text(size);
    const calls = Math.max(1, Math.round((baseCalls * BASE_SIZE) / size));
    work(input);
    let ms = Number.POSITIVE_INFINITY;
    let growth = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 3; round++) {
      const baseMs = cpuMsPerCall(() => work(base), baseCalls);
      const sizeMs = cpuMsPerCall(() => work(input), calls);
      ms = Math.min(ms, sizeMs);
      growth = Math.min(growth, sizeMs / baseMs);
    }
    expect(ms, `CPU ms per call at ${size} characters`).toBeLessThan(MAX_CALL_MS);
    expect(growth, `growth from ${BASE_SIZE} to ${size} characters`).toBeLessThan(MAX_GROWTH);
  }
}

describe('resolution time over caller-sized values', () => {
  const resolveOrReject = (text: string) => {
    const resolution = resolveVocabulary(text, THEMES, THEME_MATCHING);
    if (resolution.unmatched.length > 0) {
      unknownValueMessage('theme', resolution.unmatched, THEMES, THEME_MATCHING);
    }
  };

  it.each([
    ['a digit run', (n: number) => '1'.repeat(n)],
    ['one long line ending in a break', (n: number) => `${repeatTo('§1 x', n - 2)}\ny`],
    ['line breaks throughout', (n: number) => `x${repeatTo('  \r\n', n - 2)}y`],
    ['ampersands', (n: number) => '&'.repeat(n)],
    ['one name repeated as words', (n: number) => repeatTo('human rights ', n)],
    ['one name repeated as a comma list', (n: number) => repeatTo('Health,', n)],
    ['two names repeated as a comma list', (n: number) => repeatTo('Health,Gender,', n)],
    ['unknown values in a comma list', (n: number) => repeatTo('x,', n)],
  ])('stays linear on %s', (_shape, text) => expectLinearTime(resolveOrReject, text), 0);
});
