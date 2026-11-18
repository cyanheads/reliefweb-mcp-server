/**
 * @fileoverview Country-code inputs shared by the search tools' `country` filter and
 * `reliefweb_get_country`'s `iso3`: the advertised patterns, the rejection message that
 * points at the name lookup, and the normalization the handlers apply.
 * @module mcp-server/tools/country-codes
 */

import { z } from '@cyanheads/mcp-ts-core';

/**
 * One or more three-letter codes separated by runs of commas and whitespace, with such a run
 * also allowed before the first code and after the last; whitespace alone is a blank value,
 * but separators that include a comma need a code. Carries no flag so the advertised JSON
 * Schema `pattern` accepts exactly what the handler does. The optional group opens on a comma
 * or a letter, never whitespace, so the leading `\s*` and the group never claim the same
 * characters, and each separator run inside the group must end at a code or at the end of the
 * value: no two runs sit side by side for backtracking to split every way.
 */
export const COUNTRY_CODES_PATTERN =
  /^\s*(?:(?:,[\s,]*)?[A-Za-z]{3}(?:[\s,]+[A-Za-z]{3})*[\s,]*)?$/;

/** A single three-letter code, any case. */
export const ISO3_PATTERN = /^[A-Za-z]{3}$/;

/**
 * The recovery for a value that is not an ISO3 code. Schema-rejected input never reaches a
 * declared `errors[]` recovery, so each validation message carries this itself.
 */
export const COUNTRY_LOOKUP = `Look up a country's ISO3 code by name with reliefweb_list_countries text (e.g., text: "Syria").`;

const COUNTRY_CODES_MESSAGE = `Expected one or more three-letter ISO3 country codes separated by commas or spaces (e.g., SYR or SYR,AFG); a country name or two-letter code is not accepted. ${COUNTRY_LOOKUP}`;

const ISO3_MESSAGE = `Expected a three-letter ISO3 country code (e.g., SYR); a country name or two-letter code is not accepted. ${COUNTRY_LOOKUP}`;

/**
 * The `country` filter of a search tool. Several codes keep ReliefWeb's meaning of content
 * tagged with every listed country.
 */
export function countryCodesInput(subject: string) {
  return z
    .string()
    .regex(COUNTRY_CODES_PATTERN, COUNTRY_CODES_MESSAGE)
    .optional()
    .describe(
      `One or more ISO 3166-1 alpha-3 country codes in any case, separated by commas or spaces (e.g., SYR, or SYR,AFG). Filters to ${subject} tagged with every listed country. A country name or two-letter code is rejected; find the code with reliefweb_list_countries text. Blank is omitted.`,
    );
}

/** `reliefweb_get_country`'s required `iso3`. */
export function iso3Input(description: string) {
  return z.string().regex(ISO3_PATTERN, ISO3_MESSAGE).describe(description);
}

/**
 * Normalizes a schema-validated `country` value: trimmed, split on commas and whitespace,
 * uppercased, duplicates dropped. A blank value is `undefined` — the filter is omitted.
 */
export function parseCountryCodes(value: string | undefined): string[] | undefined {
  const codes = value?.split(/[\s,]+/).filter(Boolean);
  return codes?.length ? [...new Set(codes.map((code) => code.toUpperCase()))] : undefined;
}
