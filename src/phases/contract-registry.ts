/**
 * Contract Registry
 * Manages contract state during validation retry loop
 * Handles merging validated and fixed contracts
 */
import type { ContractInfo, DeploymentGuide } from './code-generation.js';

export class ContractRegistry {
  private validatedContracts: Map<string, ContractInfo> = new Map();
  private originalOrder: string[] = [];
  private attempts: Map<string, number> = new Map();
  private deploymentGuide: DeploymentGuide | null = null;
  private totalExpected = 0;

  /**
   * Initialize registry with contracts from first generation
   */
  initialize(contracts: ContractInfo[], guide: DeploymentGuide | null): void {
    this.originalOrder = contracts.map(c => c.name);
    this.totalExpected = contracts.length;
    this.deploymentGuide = guide;
    contracts.forEach(c => this.attempts.set(c.name, 1));
  }

  /**
   * Mark contracts as validated
   */
  markValidated(contracts: ContractInfo[]): void {
    for (const contract of contracts) {
      if (contract.validated) {
        this.validatedContracts.set(contract.name, this.deepCopy(contract));
      }
    }
  }

  /**
   * Merge fixed contracts with validated ones
   * Handles name drift during AI retries
   */
  mergeFixed(fixedContracts: ContractInfo[], attemptNumber: number): ContractInfo[] {
    const expectedFailed = this.getFailedNames();

    // Handle name drift
    for (const fixed of fixedContracts) {
      if (!this.validatedContracts.has(fixed.name) && !expectedFailed.includes(fixed.name)) {
        const unmatchedExpected = expectedFailed.find(name =>
          !fixedContracts.some(c => c.name === name)
        );
        if (unmatchedExpected) {
          console.warn(`[Registry] Name drift: "${fixed.name}" -> "${unmatchedExpected}"`);
          fixed.name = unmatchedExpected;
        } else {
          console.error(`[Registry] Unknown contract: "${fixed.name}"`);
        }
      }
      this.attempts.set(fixed.name, attemptNumber);
    }

    // Build merged result preserving original order
    const contractMap = new Map(this.validatedContracts);
    for (const fixed of fixedContracts) {
      if (this.validatedContracts.has(fixed.name)) {
        console.warn(`[Registry] Ignoring AI re-submission of validated: "${fixed.name}"`);
      } else {
        contractMap.set(fixed.name, fixed);
      }
    }

    const merged: ContractInfo[] = [];
    for (const name of this.originalOrder) {
      const contract = contractMap.get(name);
      if (contract) {
        merged.push(contract);
      } else {
        console.error(`[Registry] Missing contract: "${name}"`);
      }
    }

    return merged;
  }

  /**
   * Get names of contracts that haven't validated yet
   */
  getFailedNames(): string[] {
    return this.originalOrder.filter(name => !this.validatedContracts.has(name));
  }

  /**
   * Get all validated contracts
   */
  getValidated(): ContractInfo[] {
    return Array.from(this.validatedContracts.values());
  }

  /**
   * Get attempt count for a contract
   */
  getAttempt(name: string): number {
    return this.attempts.get(name) || 1;
  }

  /**
   * Get deployment guide
   */
  getDeploymentGuide(): DeploymentGuide | null {
    return this.deploymentGuide;
  }

  /**
   * Get total expected contract count
   */
  getTotalExpected(): number {
    return this.totalExpected;
  }

  /**
   * Check if all contracts are validated
   */
  isComplete(): boolean {
    return this.validatedContracts.size === this.totalExpected;
  }

  /**
   * Deep copy contract to prevent mutation
   */
  private deepCopy(contract: ContractInfo): ContractInfo {
    return {
      ...contract,
      dependencies: contract.dependencies ? [...contract.dependencies] : [],
      constructorParams: contract.constructorParams ? [...contract.constructorParams] : []
    };
  }
}
