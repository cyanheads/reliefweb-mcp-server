/**
 * @fileoverview Tests for the reliefweb_get_disaster tool.
 * @module tests/tools/get-disaster.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebGetDisaster } from '@/mcp-server/tools/definitions/get-disaster.tool.js';

const mockGetDisaster = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ getDisaster: mockGetDisaster }),
}));

describe('reliefwebGetDisaster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full disaster detail on success', async () => {
    const disaster = {
      id: 55555,
      name: 'Turkey: Earthquake 2023',
      status: 'past',
      glide: 'EQ-2023-000053-TUR',
      dateEvent: '2023-02-06T00:00:00+00:00',
      dateCreated: '2023-02-06T12:00:00+00:00',
      primaryCountry: 'Turkey',
      countries: ['Turkey', 'Syrian Arab Republic'],
      types: ['Earthquake'],
      primaryType: 'Earthquake',
      urlAlias: 'https://reliefweb.int/disaster/eq-2023-000053-tur',
      description: 'Magnitude 7.8 earthquake struck southern Turkey.',
      profileOverview: 'Overview text from OCHA editors.',
      keyContent: [{ title: 'Key Update', url: 'https://reliefweb.int/key' }],
      appealsResponsePlans: [
        {
          title: 'FLASH APPEAL Turkey 2023',
          url: 'https://reliefweb.int/appeal',
          date: '2023-02-20',
        },
      ],
      usefulLinks: [{ title: 'UNHCR Response', url: 'https://unhcr.org/turkey' }],
    };
    mockGetDisaster.mockResolvedValue(disaster);

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({ id: 55555 });
    const result = await reliefwebGetDisaster.handler(input, ctx);

    expect(result).toMatchObject({ id: 55555, name: 'Turkey: Earthquake 2023' });
    expect(result.keyContent).toHaveLength(1);
    expect(result.appealsResponsePlans).toHaveLength(1);
  });

  it('throws not_found when disaster does not exist', async () => {
    mockGetDisaster.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({ id: 9999999 });

    await expect(reliefwebGetDisaster.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('handles sparse disaster without profile data', async () => {
    const disaster = { id: 1, name: 'Minimal Disaster', status: 'past' };
    mockGetDisaster.mockResolvedValue(disaster);

    const ctx = createMockContext({ errors: reliefwebGetDisaster.errors });
    const input = reliefwebGetDisaster.input.parse({ id: 1 });
    const result = await reliefwebGetDisaster.handler(input, ctx);

    expect(result.id).toBe(1);
    expect(result.keyContent).toBeUndefined();
    expect(result.appealsResponsePlans).toBeUndefined();
    expect(result.dateCreated).toBeUndefined();
  });

  it('formats output including dateCreated, types, and profile sections', () => {
    const output = {
      id: 55555,
      name: 'Turkey Earthquake 2023',
      status: 'past',
      glide: 'EQ-2023-000053-TUR',
      primaryType: 'Earthquake',
      types: ['Earthquake', 'Cold Wave'],
      dateEvent: '2023-02-06T00:00:00+00:00',
      dateCreated: '2023-02-06T12:00:00+00:00',
      primaryCountry: 'Turkey',
      countries: ['Turkey'],
      urlAlias: 'https://reliefweb.int/disaster/test',
      description: 'Major earthquake.',
      profileOverview: 'Overview text.',
      keyContent: [{ title: 'Key Update', url: 'https://reliefweb.int/key' }],
      appealsResponsePlans: [{ title: 'Flash Appeal', url: 'https://reliefweb.int/appeal' }],
      usefulLinks: [{ title: 'OCHA', url: 'https://ocha.org' }],
    };
    const blocks = reliefwebGetDisaster.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('55555');
    expect(text).toContain('Turkey Earthquake 2023');
    expect(text).toContain('EQ-2023-000053-TUR');
    expect(text).toContain('Earthquake');
    expect(text).toContain('Cold Wave');
    expect(text).toContain('2023-02-06T12:00:00');
    expect(text).toContain('Major earthquake.');
    expect(text).toContain('Key Update');
    expect(text).toContain('Flash Appeal');
    expect(text).toContain('OCHA');
  });
});
