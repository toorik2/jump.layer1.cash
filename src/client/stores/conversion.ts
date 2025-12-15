/**
 * Conversion State Machine
 * Single source of truth for conversion flow state
 */
import { createSignal, createMemo } from 'solid-js';
import type { ContractInfo, Transaction, PendingContract } from '../types';

// Discriminated union for conversion state
export type ConversionStatus =
  | 'idle'
  | 'phase1'
  | 'phase2'
  | 'phase3'
  | 'phase4'
  | 'complete'
  | 'error';

export interface NativeSolution {
  message: string;
  guidance: string[];
  custodyDecisions: Array<{ entity: string; custody: string; rationale: string }>;
  rationale: { total: number; breakdown: string; decisions: string[] };
}

export interface ConversionState {
  status: ConversionStatus;
  phase: number;
  error: string | null;
  contracts: ContractInfo[];
  pendingContracts: PendingContract[];
  transactions: Transaction[];
  capabilities: string[];
  retryAttempt: number;
  nativeSolution: NativeSolution | null;
}

const initialState: ConversionState = {
  status: 'idle',
  phase: 0,
  error: null,
  contracts: [],
  pendingContracts: [],
  transactions: [],
  capabilities: [],
  retryAttempt: 1,
  nativeSolution: null
};

export function createConversionStore() {
  const [state, setState] = createSignal<ConversionState>({ ...initialState });
  const [abortController, setAbortController] = createSignal<AbortController | null>(null);

  // Derived state
  const loading = createMemo(() => {
    const s = state().status;
    return s !== 'idle' && s !== 'complete' && s !== 'error';
  });

  const currentPhase = createMemo(() => state().phase);
  const error = createMemo(() => state().error);
  const contracts = createMemo(() => state().contracts);
  const pendingContracts = createMemo(() => state().pendingContracts);
  const transactions = createMemo(() => state().transactions);
  const capabilities = createMemo(() => state().capabilities);
  const retryAttempt = createMemo(() => state().retryAttempt);
  const nativeSolution = createMemo(() => state().nativeSolution);

  // Actions
  function reset() {
    const controller = abortController();
    if (controller) {
      controller.abort();
      setAbortController(null);
    }
    setState({ ...initialState });
  }

  function startConversion(): AbortController {
    const controller = new AbortController();
    const existing = abortController();
    if (existing) existing.abort();
    setAbortController(controller);

    setState({
      ...initialState,
      status: 'phase1',
      phase: 1
    });

    return controller;
  }

  function setPhase(phase: 1 | 2 | 3 | 4) {
    const statusMap: Record<number, ConversionStatus> = {
      1: 'phase1',
      2: 'phase2',
      3: 'phase3',
      4: 'phase4'
    };
    setState(s => ({ ...s, status: statusMap[phase], phase }));
  }

  function addTransactions(txs: Transaction[], specs: PendingContract[], caps: string[] = []) {
    setState(s => ({
      ...s,
      transactions: txs,
      pendingContracts: specs,
      capabilities: caps
    }));
  }

  function setRetryAttempt(attempt: number) {
    setState(s => ({ ...s, retryAttempt: attempt }));
  }

  function addValidatedContract(contract: ContractInfo) {
    setState(s => {
      const existingIndex = s.contracts.findIndex(c => c.name === contract.name);
      let newContracts: ContractInfo[];
      if (existingIndex >= 0) {
        // Replace in place to preserve order
        newContracts = [...s.contracts];
        newContracts[existingIndex] = contract;
      } else {
        // New contract - append
        newContracts = [...s.contracts, contract];
      }
      const newPending = s.pendingContracts.filter(c => c.name !== contract.name);
      return {
        ...s,
        contracts: newContracts,
        pendingContracts: newPending
      };
    });
  }

  function complete() {
    setState(s => ({ ...s, status: 'complete', phase: 5 }));
  }

  function setNativeSolution(solution: NativeSolution) {
    setState(s => ({ ...s, nativeSolution: solution, status: 'complete', phase: 5 }));
  }

  function setError(message: string) {
    setState(s => ({ ...s, status: 'error', error: message }));
  }

  return {
    // State accessors
    loading,
    currentPhase,
    error,
    contracts,
    pendingContracts,
    transactions,
    capabilities,
    retryAttempt,
    nativeSolution,

    // Actions
    reset,
    startConversion,
    setPhase,
    addTransactions,
    setRetryAttempt,
    addValidatedContract,
    complete,
    setNativeSolution,
    setError
  };
}

export type ConversionStore = ReturnType<typeof createConversionStore>;
