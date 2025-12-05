import { describe, it, expect, beforeEach } from 'vitest';
import { ContractRegistry } from '../src/phases/contract-registry.js';
import type { ContractInfo } from '../src/phases/code-generation.js';

function makeContract(name: string, validated = false): ContractInfo {
  return {
    id: name.toLowerCase(),
    name,
    purpose: `Validates ${name.replace(/([A-Z])/g, ' $1').trim().toLowerCase()} operations`,
    code: `pragma cashscript ^0.13.0; contract ${name}() {}`,
    role: 'primary',
    validated
  };
}

describe('ContractRegistry', () => {
  let registry: ContractRegistry;

  beforeEach(() => {
    registry = new ContractRegistry();
  });

  describe('initialize', () => {
    it('tracks original order', () => {
      const contracts = [makeContract('A'), makeContract('B'), makeContract('C')];
      registry.initialize(contracts);

      expect(registry.getFailedNames()).toEqual(['A', 'B', 'C']);
      expect(registry.getTotalExpected()).toBe(3);
    });

    it('sets initial attempts to 1', () => {
      const contracts = [makeContract('A')];
      registry.initialize(contracts);

      expect(registry.getAttempt('A')).toBe(1);
    });
  });

  describe('markValidated', () => {
    it('tracks validated contracts', () => {
      const contracts = [makeContract('A'), makeContract('B')];
      registry.initialize(contracts);

      registry.markValidated([{ ...contracts[0], validated: true }]);

      expect(registry.getFailedNames()).toEqual(['B']);
      expect(registry.getValidated()).toHaveLength(1);
    });

    it('ignores non-validated contracts', () => {
      const contracts = [makeContract('A')];
      registry.initialize(contracts);

      registry.markValidated([contracts[0]]); // validated = false

      expect(registry.getFailedNames()).toEqual(['A']);
      expect(registry.getValidated()).toHaveLength(0);
    });
  });

  describe('mergeFixed', () => {
    it('preserves original order', () => {
      const contracts = [makeContract('A'), makeContract('B'), makeContract('C')];
      registry.initialize(contracts);

      registry.markValidated([{ ...contracts[1], validated: true }]); // B validated

      const fixed = [makeContract('A', true), makeContract('C', true)];
      const merged = registry.mergeFixed(fixed, 2);

      expect(merged.map(c => c.name)).toEqual(['A', 'B', 'C']);
    });

    it('does not overwrite validated contracts', () => {
      const contracts = [makeContract('A'), makeContract('B')];
      registry.initialize(contracts);

      const validatedA = { ...contracts[0], validated: true, code: 'original' };
      registry.markValidated([validatedA]);

      const fixedA = { ...makeContract('A'), code: 'modified' };
      const fixedB = { ...makeContract('B'), code: 'fixed' };
      const merged = registry.mergeFixed([fixedA, fixedB], 2);

      expect(merged.find(c => c.name === 'A')?.code).toBe('original');
      expect(merged.find(c => c.name === 'B')?.code).toBe('fixed');
    });

    it('handles name drift', () => {
      const contracts = [makeContract('TokenVault'), makeContract('TokenHelper')];
      registry.initialize(contracts);

      registry.markValidated([{ ...contracts[0], validated: true }]);

      // AI returns "Helper" instead of "TokenHelper"
      const fixed = [makeContract('Helper')];
      const merged = registry.mergeFixed(fixed, 2);

      expect(merged.map(c => c.name)).toEqual(['TokenVault', 'TokenHelper']);
      expect(merged.find(c => c.name === 'TokenHelper')).toBeDefined();
    });

    it('updates attempt count', () => {
      const contracts = [makeContract('A')];
      registry.initialize(contracts);

      registry.mergeFixed([makeContract('A')], 3);

      expect(registry.getAttempt('A')).toBe(3);
    });
  });

  describe('isComplete', () => {
    it('returns false when contracts pending', () => {
      const contracts = [makeContract('A'), makeContract('B')];
      registry.initialize(contracts);

      registry.markValidated([{ ...contracts[0], validated: true }]);

      expect(registry.isComplete()).toBe(false);
    });

    it('returns true when all validated', () => {
      const contracts = [makeContract('A'), makeContract('B')];
      registry.initialize(contracts);

      registry.markValidated([
        { ...contracts[0], validated: true },
        { ...contracts[1], validated: true }
      ]);

      expect(registry.isComplete()).toBe(true);
    });
  });

  describe('deep copy', () => {
    it('does not mutate original contracts', () => {
      const contract = makeContract('VaultManager');
      contract.validated = true;

      registry.initialize([contract]);
      registry.markValidated([contract]);

      const validated = registry.getValidated()[0];
      validated.code = 'modified';

      expect(contract.code).toBe('pragma cashscript ^0.13.0; contract VaultManager() {}');
    });
  });
});
