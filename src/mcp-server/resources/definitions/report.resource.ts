/**
 * @fileoverview ReliefWeb report resource — full report record by numeric ID.
 * @module mcp-server/resources/definitions/report
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

export const reportResource = resource('reliefweb://reports/{id}', {
  name: 'reliefweb-report',
  title: 'ReliefWeb Report',
  description:
    'Full report record by ReliefWeb numeric ID — metadata, body text, and file URLs. ' +
    'Equivalent to calling reliefweb_get_report.',
  mimeType: 'application/json',
  params: z.object({
    id: z.string().describe('ReliefWeb numeric report ID.'),
  }),

  async handler(params, ctx) {
    const id = parseInt(params.id, 10);
    if (isNaN(id) || id <= 0) {
      throw notFound(`Invalid report ID "${params.id}". Must be a positive integer.`);
    }
    ctx.log.debug('reliefweb://reports/{id}', { id });
    const report = await getReliefWebService().getReport(id, ctx);
    if (!report) {
      throw notFound(
        `No report found with ID ${id}. Verify the ID from reliefweb_search_reports.`,
        { id },
      );
    }
    return report;
  },
});
