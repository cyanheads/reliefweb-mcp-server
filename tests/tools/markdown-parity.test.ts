/**
 * @fileoverview CommonMark parity across the ReliefWeb formatter surface.
 * @module tests/tools/markdown-parity
 */

import { z } from '@cyanheads/mcp-ts-core';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { Parser } from 'commonmark';
import { describe, expect, it, vi } from 'vitest';
import { reliefwebGetCountry } from '@/mcp-server/tools/definitions/get-country.tool.js';
import { reliefwebGetDisaster } from '@/mcp-server/tools/definitions/get-disaster.tool.js';
import { reliefwebGetJob } from '@/mcp-server/tools/definitions/get-job.tool.js';
import { reliefwebGetReport } from '@/mcp-server/tools/definitions/get-report.tool.js';
import { reliefwebGetTraining } from '@/mcp-server/tools/definitions/get-training.tool.js';
import { reliefwebListCountries } from '@/mcp-server/tools/definitions/list-countries.tool.js';
import { reliefwebListSources } from '@/mcp-server/tools/definitions/list-sources.tool.js';
import { reliefwebSearchDisasters } from '@/mcp-server/tools/definitions/search-disasters.tool.js';
import { reliefwebSearchJobs } from '@/mcp-server/tools/definitions/search-jobs.tool.js';
import { reliefwebSearchReports } from '@/mcp-server/tools/definitions/search-reports.tool.js';
import { reliefwebSearchTraining } from '@/mcp-server/tools/definitions/search-training.tool.js';
import { renderOutline } from '@/mcp-server/tools/document-sections.js';
import { curatedLinkLines, renderArchive } from '@/mcp-server/tools/profile-archive.js';

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({
    searchReports: async () => ({ items: [], totalCount: 0 }),
    searchJobs: async () => ({ items: [], totalCount: 0 }),
    searchTraining: async () => ({ items: [], totalCount: 0 }),
    searchDisasters: async () => ({ items: [], totalCount: 0 }),
    listSources: async () => ({ items: [], totalCount: 0 }),
  }),
}));

function parsed(markdown: string) {
  const walker = new Parser().parse(markdown).walker();
  let text = '';
  const links: string[] = [];
  const types: string[] = [];
  let event = walker.next();
  while (event) {
    if (event.entering) {
      types.push(event.node.type);
      if (event.node.type === 'text' || event.node.type === 'code') text += event.node.literal;
      if (event.node.type === 'softbreak' || event.node.type === 'linebreak') text += '\n';
      // Commonmark.js URI-normalizes destinations; these fixtures contain no percent escapes.
      if (event.node.type === 'link') links.push(decodeURI(event.node.destination ?? ''));
    }
    event = walker.next();
  }
  return { text, links, types };
}

const narrative = '**Situation**\n\n- [Read the report](https://example.org/report)\n- Second item';
function fixture<T>(definition: {
  name: string;
  output: { parse: (value: unknown) => T };
  format?: ((result: T) => Array<{ type: string; text?: string }>) | undefined;
}) {
  return {
    name: definition.name,
    render(value: unknown) {
      const result = definition.output.parse(value);
      return {
        result,
        text: definition.format!(result)
          .map((block) => block.text ?? '')
          .join('\n'),
      };
    },
  };
}
const details = [
  fixture(reliefwebGetCountry),
  fixture(reliefwebGetDisaster),
  fixture(reliefwebGetJob),
  fixture(reliefwebGetReport),
  fixture(reliefwebGetTraining),
];

describe('narrative Markdown characterization', () => {
  it.each(details)('$name preserves upstream narrative Markdown verbatim', (definition) => {
    const { result, text } = definition.render({
      kind: 'full',
      id: 1,
      name: 'Name',
      title: 'Title',
      body: narrative,
      description: narrative,
      profileOverview: narrative,
      howToApply: narrative,
      howToRegister: narrative,
      feeInformation: narrative,
    });
    expect(text).toContain(narrative);
    expect(text.split(narrative).length - 1).toBe(literalOccurrences(result, narrative));
    expect(parsed(text).links).toContain('https://example.org/report');
  });
});

const definitions = [
  ...details,
  fixture(reliefwebListCountries),
  fixture(reliefwebListSources),
  fixture(reliefwebSearchDisasters),
  fixture(reliefwebSearchJobs),
  fixture(reliefwebSearchReports),
  fixture(reliefwebSearchTraining),
];
const value = 'A *literal* [label] <b> &copy;\n- next';
const url = 'https://example.org/a(b)?q=<x>&v=2';
const record = {
  id: 1,
  title: value,
  name: value,
  shortname: value,
  iso3: value,
  status: value,
  primaryCountry: value,
  primaryType: value,
  glide: value,
  headlineSummary: value,
  countries: [value],
  sources: [value],
  types: [value],
  themes: [value],
  formats: [value],
  languages: [value],
  cities: [value],
  careerCategories: [value],
  experienceLevels: [value],
  trainingLanguages: [value],
  cost: value,
  dateCreated: value,
  dateOriginal: value,
  dateClosing: value,
  dateChanged: value,
  dateStart: value,
  dateEnd: value,
  dateRegistration: value,
  dateEvent: value,
  urlAlias: url,
  url,
  homepage: url,
  eventUrl: url,
  fileUrls: [url],
};
const appliedFilters = {
  text: value,
  country: value,
  source: value,
  theme: value,
  language: value,
  careerCategory: value,
  experience: value,
  glide: value,
  disasterType: value,
  format: 'online',
  trainingLanguage: value,
  sort: value,
  preset: 'latest',
  limit: 10,
  offset: 0,
};

function literalOccurrences(input: unknown, target = value): number {
  if (input === target) return 1;
  if (Array.isArray(input))
    return input.reduce((count, item) => count + literalOccurrences(item, target), 0);
  if (input !== null && typeof input === 'object')
    return Object.values(input).reduce<number>(
      (count, item) => count + literalOccurrences(item, target),
      0,
    );
  return 0;
}

describe('plain text and URL CommonMark parity', () => {
  it.each(definitions)(
    '$name renders upstream text literally and URL destinations exactly',
    (definition) => {
      const { result, text: markdown } = definition.render({
        ...record,
        kind: 'full',
        items: [record],
        appliedFilters,
      });
      const rendered = parsed(markdown);
      expect(rendered.text).toContain(value);
      expect(rendered.text.split(value).length - 1).toBe(literalOccurrences(result));
      expect(rendered.text).not.toContain('A literal label');
      expect(rendered.types).not.toContain('html_inline');
      expect(rendered.links).toContain(url);
    },
  );

  it.each(definitions)('$name renders unsafe URL values as visible literal text', (definition) => {
    const unsafeUrl = 'javascript:alert(1)';
    const unsafe = {
      ...record,
      urlAlias: unsafeUrl,
      url: unsafeUrl,
      homepage: unsafeUrl,
      eventUrl: unsafeUrl,
      fileUrls: [unsafeUrl],
    };
    const { text } = definition.render({
      ...unsafe,
      kind: 'full',
      items: [unsafe],
      appliedFilters,
    });
    expect(parsed(text).links).toEqual([]);
    expect(parsed(text).text).toContain(unsafeUrl);
  });

  it('delegates fixed section keys and authored recall Markdown without double escaping', () => {
    const text = renderOutline({
      kind: 'outline',
      sections: [{ name: 'headlineSummary', bytes: 42 }],
      outlineNotice: 'Re-call with `sections`.',
    })
      .map((block) => ('text' in block ? block.text : ''))
      .join('\n');
    expect(parsed(text).text).toContain('headlineSummary');
    expect(parsed(text).text).toContain('Re-call with sections.');
    expect(parsed(text).text).toContain('42');
    expect(parsed(text).types).not.toContain('html_inline');
  });

  it.each([
    reliefwebSearchReports,
    reliefwebSearchJobs,
    reliefwebSearchTraining,
    reliefwebSearchDisasters,
    reliefwebListSources,
  ])(
    '$name preserves raw empty-result notice and renders its filter literally',
    async (definition) => {
      const result = await runToolContract(definition, { text: value, limit: 1001 });
      expect(result.isError).not.toBe(true);
      const { notice } = z.object({ notice: z.string() }).parse(result.structuredContent);
      expect(notice).toEqual(expect.stringContaining(value));
      expect(notice).toEqual(expect.stringContaining('Requested limit 1001; applied limit 1000.'));
      const trailer = result.content.at(-1);
      expect(trailer?.type).toBe('text');
      if (trailer?.type !== 'text') throw new Error('Expected notice text');
      expect(parsed(trailer.text).text).toContain(notice);
      expect(parsed(trailer.text).types).not.toContain('html_inline');
    },
  );

  it('preserves curated and archive titles, dates, and URL targets', () => {
    const entry = { title: value, date: value, url };
    const active = curatedLinkLines({
      keyContent: [entry],
      appealsResponsePlans: [entry],
      usefulLinks: [entry],
    }).join('\n');
    const archived = renderArchive({
      archive: { list: 'appealsResponsePlans', total: 1, shown: 1, offset: 0, entries: [entry] },
    })[0]!.text;
    for (const text of [active, archived]) {
      expect(parsed(text).text).toContain(value);
      expect(parsed(text).links).toContain(url);
      expect(parsed(text).types).not.toContain('html_inline');
    }
  });
});
