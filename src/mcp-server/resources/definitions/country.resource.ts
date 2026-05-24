/**
 * @fileoverview ReliefWeb country resource — country profile by ISO3 code.
 * @module mcp-server/resources/definitions/country
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound, validationError } from '@cyanheads/mcp-ts-core/errors';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

export const countryResource = resource('reliefweb://countries/{iso3}', {
  name: 'reliefweb-country',
  title: 'ReliefWeb Country Profile',
  description:
    'Country profile by ISO3 code — overview, humanitarian situation summary, key content links, and active response plans. ' +
    'Equivalent to calling reliefweb_get_country.',
  mimeType: 'application/json',
  params: z.object({
    iso3: z.string().describe('ISO 3166-1 alpha-3 country code (e.g., SYR, AFG, UKR).'),
  }),

  async handler(params, ctx) {
    const iso3 = params.iso3.trim().toUpperCase();
    if (iso3.length !== 3 || !/^[A-Z]{3}$/.test(iso3)) {
      throw validationError(
        `Invalid ISO3 code "${params.iso3}". Must be a 3-letter ISO 3166-1 alpha-3 code.`,
      );
    }
    ctx.log.debug('reliefweb://countries/{iso3}', { iso3 });
    const country = await getReliefWebService().getCountry(iso3, ctx);
    if (!country) {
      throw notFound(
        `No country profile found for ISO3 code "${iso3}". Use reliefweb_list_countries to browse valid codes.`,
        { iso3 },
      );
    }
    return country;
  },
});
