import { describe, it, expect } from 'vitest';
import { isMultiContractResponse } from '../src/server/phases/code-generation.js';

describe('isMultiContractResponse', () => {
  it('returns true for valid multi-contract response', () => {
    const response = {
      contracts: [
        { id: 'vault', name: 'TokenVault', purpose: 'Validates token custody transfers', code: 'pragma cashscript ^0.13.0; contract TokenVault() {}', role: 'primary' }
      ]
    };
    expect(isMultiContractResponse(response)).toBe(true);
  });

  it('returns true for response with empty contracts array', () => {
    const response = {
      contracts: []
    };
    expect(isMultiContractResponse(response)).toBe(true);
  });

  it('returns false for single contract response', () => {
    const response = {
      primaryContract: 'pragma cashscript ^0.13.0; contract TokenVault() {}'
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
