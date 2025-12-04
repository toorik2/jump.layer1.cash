import type { Transaction } from '../types';

/**
 * Extracts contract names from type strings like "NFT at MyContract" or "MyContract()"
 */
function extractContract(typeStr: string): string | null {
  if (!typeStr) return null;

  // Skip user-related types
  if (
    typeStr.includes('P2PKH') ||
    typeStr.startsWith('BCH') ||
    typeStr.includes('OP_RETURN') ||
    typeStr.includes('User') ||
    typeStr.includes('change')
  ) {
    return null;
  }

  const genericWords = ['contract', 'address', 'minter', 'user', 'owner', 'sender', 'recipient'];

  // Match "at ContractName"
  const atMatch = typeStr.match(/at\s+(\w+)/);
  if (atMatch && !genericWords.includes(atMatch[1].toLowerCase())) {
    return atMatch[1];
  }

  // Match "ContractName()"
  const parenMatch = typeStr.match(/^(\w+)\s*\(/);
  if (parenMatch && !genericWords.includes(parenMatch[1].toLowerCase())) {
    return parenMatch[1];
  }

  // Match "SomethingContract"
  const startMatch = typeStr.match(/^(\w+Contract)/);
  if (startMatch) {
    return startMatch[1];
  }

  return null;
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
        if (input.contract) contracts.add(input.contract);
        if (input.from && !input.from.includes('P2PKH') && !input.from.includes('User')) {
          contracts.add(input.from);
        }
        const fromType = extractContract(input.type);
        if (fromType) contracts.add(fromType);
      }

      for (const output of tx.outputs || []) {
        if (output.contract) contracts.add(output.contract);
        if (output.to && !output.to.includes('P2PKH') && !output.to.includes('User')) {
          contracts.add(output.to);
        }
        const toType = extractContract(output.type);
        if (toType) contracts.add(toType);
      }

      return { ...tx, participatingContracts: Array.from(contracts) } as Transaction;
    });
}
