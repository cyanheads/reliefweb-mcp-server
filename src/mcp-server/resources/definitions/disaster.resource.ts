/**
 * @fileoverview ReliefWeb disaster resource — disaster record by numeric ID.
 * @module mcp-server/resources/definitions/disaster
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

export const disasterResource = resource('reliefweb://disasters/{id}', {
  name: 'reliefweb-disaster',
  title: 'ReliefWeb Disaster',
  description:
    'Disaster record by ReliefWeb numeric ID — type, status, affected countries, GLIDE number, description, and curated content links. ' +
    'Equivalent to calling reliefweb_get_disaster.',
  mimeType: 'application/json',
  params: z.object({
    id: z.string().describe('ReliefWeb numeric disaster ID.'),
  }),

  async handler(params, ctx) {
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id) || id <= 0) {
      throw notFound(`Invalid disaster ID "${params.id}". Must be a positive integer.`);
    }
    ctx.log.debug('reliefweb://disasters/{id}', { id });
    const disaster = await getReliefWebService().getDisaster(id, ctx);
    if (!disaster) {
      throw notFound(
        `No disaster found with ID ${id}. Verify the ID from reliefweb_search_disasters.`,
        { id },
      );
    }
    return disaster;
  },
});
