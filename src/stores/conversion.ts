/**
 * Conversion State Machine
 * Single source of truth for conversion flow state
 */
import { createSignal, createMemo } from 'solid-js';
import type { ContractInfo, Transaction, DeploymentGuide as DeploymentGuideType, PendingContract } from '../types';

// Discriminated union for conversion state
export type ConversionStatus =
  | 'idle'
  | 'phase1'
  | 'phase2'
  | 'phase3'
  | 'phase4'
  | 'complete'
  | 'error';

export interface ConversionState {
  status: ConversionStatus;
  phase: number;
  error: string | null;
  contracts: ContractInfo[];
  pendingContracts: PendingContract[];
  transactions: Transaction[];
  deploymentGuide: DeploymentGuideType | null;
  contractAttempts: Map<string, number>;
  isMultiContract: boolean;
}

const initialState: ConversionState = {
  status: 'idle',
  phase: 0,
  error: null,
  contracts: [],
  pendingContracts: [],
  transactions: [],
  deploymentGuide: null,
  contractAttempts: new Map(),
  isMultiContract: false
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
  const deploymentGuide = createMemo(() => state().deploymentGuide);
  const contractAttempts = createMemo(() => state().contractAttempts);
  const isMultiContract = createMemo(() => state().isMultiContract);

  // Actions
  function reset() {
    const controller = abortController();
    if (controller) {
      controller.abort();
      setAbortController(null);
    }
    setState({ ...initialState, contractAttempts: new Map() });
  }

  function startConversion(): AbortController {
    const controller = new AbortController();
    const existing = abortController();
    if (existing) existing.abort();
    setAbortController(controller);

    setState({
      ...initialState,
      status: 'phase1',
      phase: 1,
      contractAttempts: new Map()
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

  function addTransactions(txs: Transaction[], specs: PendingContract[]) {
    setState(s => ({
      ...s,
      transactions: txs,
      pendingContracts: specs,
      isMultiContract: specs.length > 1
    }));
  }

  function updateValidation(contractStatuses: { name: string; attempt: number }[]) {
    setState(s => {
      const newAttempts = new Map(s.contractAttempts);
      for (const c of contractStatuses) {
        if (c.attempt) newAttempts.set(c.name, c.attempt);
      }
      return { ...s, contractAttempts: newAttempts };
    });
  }

  function addValidatedContract(contract: ContractInfo, guide: DeploymentGuideType | null, totalExpected: number) {
    setState(s => {
      const newContracts = [...s.contracts, contract];
      const newPending = s.pendingContracts.filter(c => c.name !== contract.name);
      return {
        ...s,
        contracts: newContracts,
        pendingContracts: newPending,
        deploymentGuide: guide || s.deploymentGuide,
        isMultiContract: totalExpected > 1
      };
    });
  }

  function complete() {
    setState(s => ({ ...s, status: 'complete' }));
  }

  function setError(message: string) {
    setState(s => ({ ...s, status: 'error', error: message }));
  }

  return {
    // State accessors
    state,
    loading,
    currentPhase,
    error,
    contracts,
    pendingContracts,
    transactions,
    deploymentGuide,
    contractAttempts,
    isMultiContract,
    abortController,

    // Actions
    reset,
    startConversion,
    setPhase,
    addTransactions,
    updateValidation,
    addValidatedContract,
    complete,
    setError
  };
}

export type ConversionStore = ReturnType<typeof createConversionStore>;
