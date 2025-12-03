import { describe, it, expect } from 'vitest';
import { isMultiContractResponse } from '../src/phases/code-generation.js';

describe('isMultiContractResponse', () => {
  it('returns true for valid multi-contract response', () => {
    const response = {
      contracts: [
        { id: '1', name: 'Test', purpose: 'test', code: '', role: 'primary', deploymentOrder: 1, dependencies: [], constructorParams: [] }
      ],
      deploymentGuide: { steps: [], warnings: [], testingNotes: [] }
    };
    expect(isMultiContractResponse(response)).toBe(true);
  });

  it('returns true for response with empty contracts array', () => {
    const response = {
      contracts: [],
      deploymentGuide: { steps: [], warnings: [], testingNotes: [] }
    };
    expect(isMultiContractResponse(response)).toBe(true);
  });

  it('returns false for single contract response', () => {
    const response = {
      primaryContract: 'contract Test {}'
    };
    expect(isMultiContractResponse(response)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isMultiContractResponse(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isMultiContractResponse(undefined)).toBe(false);
  });

  it('returns false when contracts is not an array', () => {
    const response = {
      contracts: 'not an array'
    };
    expect(isMultiContractResponse(response)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isMultiContractResponse({})).toBe(false);
  });
});
