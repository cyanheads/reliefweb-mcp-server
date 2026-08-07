/**
 * @fileoverview Tests for the closed-vocabulary helpers — case- and whitespace-tolerant
 * matching, comma-separated multi-value resolution, and the rejection message.
 * @module tests/services/vocabularies.test
 */

import { describe, expect, it } from 'vitest';
import {
  DISASTER_STATUSES,
  REPORT_FORMATS,
  resolveVocabulary,
  unknownValueMessage,
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
