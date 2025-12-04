import type { Transaction } from '../types';

/**
 * Checks if a name refers to a contract (ends with "Contract")
 */
function isContractName(name?: string): boolean {
  if (!name) return false;
  return name.includes('Contract');
}

/**
 * Enriches transactions with participating contracts derived from inputs/outputs
 */
export function enrichTransactions(txs: unknown[]): Transaction[] {
  return (txs as any[]).map((tx) => {
    if (tx.participatingContracts && tx.participatingContracts.length > 0) {
      return tx as Transaction;
    }

    const contracts = new Set<string>();

    for (const input of tx.inputs || []) {
      if (isContractName(input.from)) {
        contracts.add(input.from);
      }
    }

    for (const output of tx.outputs || []) {
      if (isContractName(output.to)) {
        contracts.add(output.to);
      }
    }

    return { ...tx, participatingContracts: Array.from(contracts) } as Transaction;
  });
}
