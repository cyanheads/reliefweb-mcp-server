/**
 * @fileoverview ReliefWeb disaster resource — disaster record by numeric ID.
 * @module mcp-server/resources/definitions/disaster
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { parseResourceId } from '@/mcp-server/resources/resource-ids.js';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

export const disasterResource = resource('reliefweb://disasters/{id}', {
  name: 'reliefweb-disaster',
  title: 'ReliefWeb Disaster',
  description:
    'Disaster record by ReliefWeb numeric ID — type, status, affected countries, GLIDE number, description, and curated content links. ' +
    'Always returns the whole record, however large: a resource read has no way to name sections, ' +
    'so reliefweb_get_disaster is the path for an oversized disaster — it answers with a section outline and takes a sections selector.',
  mimeType: 'application/json',
  params: z.object({
    id: z
      .string()
      .describe('ReliefWeb numeric disaster ID — digits only, exactly as search returned it.'),
  }),

  async handler(params, ctx) {
    const id = parseResourceId(params.id, 'disaster');
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
