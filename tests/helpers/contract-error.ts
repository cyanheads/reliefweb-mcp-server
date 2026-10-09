/**
 * @fileoverview Runs a tool through `runToolContract` and returns the error envelope a
 * client receives. A declared reason thrown without a hint is filled with its `errors[]`
 * recovery there, as in production — a direct `definition.handler(...)` throw is not.
 * @module tests/helpers/contract-error
 */

import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { expect } from 'vitest';

/** The `structuredContent.error` of a failed tool call. */
export interface ContractError {
  code: number;
  data?: { reason?: string; recovery?: { hint: string } } & Record<string, unknown>;
  message: string;
}

/** Calls the tool with raw arguments, asserts it failed, and returns its error envelope. */
export async function contractError(
  ...args: Parameters<typeof runToolContract>
): Promise<ContractError> {
  const result = await runToolContract(...args);
  expect(result.isError).toBe(true);
  return (result.structuredContent as { error: ContractError }).error;
}
