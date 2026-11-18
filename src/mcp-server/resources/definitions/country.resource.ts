/**
 * @fileoverview ReliefWeb country resource — country profile by ISO3 code.
 * @module mcp-server/resources/definitions/country
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound, validationError } from '@cyanheads/mcp-ts-core/errors';
import { COUNTRY_LOOKUP, ISO3_PATTERN } from '@/mcp-server/tools/country-codes.js';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

export const countryResource = resource('reliefweb://countries/{iso3}', {
  name: 'reliefweb-country',
  title: 'ReliefWeb Country Profile',
  description:
    "Country profile by ISO3 code in any case — name, uppercase ISO3 code, humanitarian situation status, overview, and the curated key content, appeals and response plans, and useful links, with the report IDs their URLs name. Each curated list carries only its active entries; reliefweb_get_country pages a list's archived entries with its archive selector. Always returns the whole profile, however large: a resource read has no way to name sections, so reliefweb_get_country is the path for an oversized profile — it answers with a section outline and takes a sections selector.",
  mimeType: 'application/json',
  params: z.object({
    iso3: z.string().describe('ISO 3166-1 alpha-3 country code (e.g., SYR, AFG, UKR).'),
  }),

  async handler(params, ctx) {
    const iso3 = params.iso3.trim().toUpperCase();
    if (!ISO3_PATTERN.test(iso3)) {
      throw validationError(
        `Invalid ISO3 code "${params.iso3}". Expected a three-letter ISO 3166-1 alpha-3 code (e.g., SYR). ${COUNTRY_LOOKUP}`,
      );
    }
    ctx.log.debug('reliefweb://countries/{iso3}', { iso3 });
    const country = await getReliefWebService().getCountry(iso3, ctx);
    if (!country) {
      throw notFound(
        `No country profile found for ISO3 code "${iso3}". Look up the code by country name with reliefweb_list_countries text, or browse the full listing there.`,
        { iso3 },
      );
    }
    return country;
  },
});
