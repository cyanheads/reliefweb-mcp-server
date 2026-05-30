/**
 * @fileoverview Tests for the reliefweb_crisis_briefing prompt.
 * @module tests/prompts/crisis-briefing.prompt.test
 */

import { describe, expect, it } from 'vitest';
import { reliefwebCrisisBriefing } from '@/mcp-server/prompts/definitions/crisis-briefing.prompt.js';

describe('reliefwebCrisisBriefing', () => {
  it('generates a full briefing when focus is omitted', () => {
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: 'Afghanistan',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    const text = (messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('Afghanistan');
    // full brief includes all three sections
    expect(text).toContain('Situation Overview');
    expect(text).toContain('Open Positions');
    expect(text).toContain('Training Opportunities');
  });

  it('generates a full briefing when focus=full', () => {
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: 'AFG',
      focus: 'full',
    });

    const text = (messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('Situation Overview');
    expect(text).toContain('Open Positions');
    expect(text).toContain('Training Opportunities');
    expect(text).toContain('AFG');
  });

  it('generates only situation overview when focus=situation', () => {
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: 'Syria earthquake',
      focus: 'situation',
    });

    const text = (messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('Situation Overview');
    expect(text).not.toContain('Open Positions');
    expect(text).not.toContain('Training Opportunities');
    expect(text).toContain('Syria earthquake');
  });

  it('generates only jobs and training when focus=jobs', () => {
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: 'UKR',
      focus: 'jobs',
    });

    const text = (messages[0].content as { type: string; text: string }).text;
    expect(text).not.toContain('Situation Overview');
    expect(text).toContain('Open Positions');
    expect(text).toContain('Training Opportunities');
    expect(text).toContain('UKR');
  });

  it('injects the target into section instructions', () => {
    const target = 'EQ-2023-000053-TUR';
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: target,
      focus: 'full',
    });

    const text = (messages[0].content as { type: string; text: string }).text;
    // The target appears in the briefing header and section instructions
    expect(text).toContain(target);
    // Jobs section should reference the target for text= filter guidance
    expect(text).toContain(`"${target}"`);
  });

  it('includes ISO3 usage instructions in the full brief', () => {
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: 'Yemen',
      focus: 'full',
    });

    const text = (messages[0].content as { type: string; text: string }).text;
    // Should instruct the agent to use ISO3 codes
    expect(text).toMatch(/ISO3/i);
  });

  it('includes date format instructions', () => {
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: 'Haiti',
    });

    const text = (messages[0].content as { type: string; text: string }).text;
    expect(text).toMatch(/ISO 8601/i);
  });

  it('does not fabricate data — instructs agent not to invent data', () => {
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: 'Somalia',
      focus: 'full',
    });

    const text = (messages[0].content as { type: string; text: string }).text;
    // Must contain an explicit instruction against inventing data
    expect(text).toMatch(/do not invent/i);
  });

  it('handles unicode characters in the target without crashing', () => {
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: "Côte d'Ivoire",
    });

    expect(messages).toHaveLength(1);
    const text = (messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('Côte');
  });

  it('output is a single user-role message', () => {
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: 'Sudan',
      focus: 'situation',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect((messages[0].content as { type: string }).type).toBe('text');
  });

  it('references key ReliefWeb tools in the situation section', () => {
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: 'Myanmar',
      focus: 'situation',
    });

    const text = (messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('reliefweb_get_country');
    expect(text).toContain('reliefweb_get_disaster');
    expect(text).toContain('reliefweb_search_reports');
  });

  it('references job search tool in the jobs section', () => {
    const messages = reliefwebCrisisBriefing.generate({
      country_or_disaster: 'Niger',
      focus: 'jobs',
    });

    const text = (messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('reliefweb_search_jobs');
    expect(text).toContain('reliefweb_search_training');
  });
});
