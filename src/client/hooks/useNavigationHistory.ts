/**
 * Virtual History Navigation Hook
 * Enables browser back/forward without URL changes
 */
import { onMount, onCleanup } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';

interface NavigationState {
  mainTab: 'transactions' | 'contracts';
  contractTab: number;
}

interface Options {
  activeMainTab: Accessor<'transactions' | 'contracts'>;
  setActiveMainTab: Setter<'transactions' | 'contracts'>;
  activeContractTab: Accessor<number>;
  setActiveContractTab: Setter<number>;
}

export function useNavigationHistory(options: Options) {
  let isRestoring = false;

  const getCurrentState = (): NavigationState => ({
    mainTab: options.activeMainTab(),
    contractTab: options.activeContractTab()
  });

  // Push a single history entry for the current state
  const pushState = () => {
    if (isRestoring) return;
    history.pushState(getCurrentState(), '', location.href);
  };

  const handlePopState = (event: PopStateEvent) => {
    const state = event.state as NavigationState | null;

    // If no state, user is trying to leave - push current state to prevent exit
    if (!state) {
      history.pushState(getCurrentState(), '', location.href);
      return;
    }

    isRestoring = true;
    options.setActiveMainTab(state.mainTab);
    options.setActiveContractTab(state.contractTab);
    isRestoring = false;
  };

  onMount(() => {
    // Set base state
    history.replaceState(getCurrentState(), '', location.href);
    window.addEventListener('popstate', handlePopState);
  });

  onCleanup(() => {
    window.removeEventListener('popstate', handlePopState);
  });

  return {
    // Call this when navigating (single entry for multi-signal changes)
    pushNavigation: pushState,

    // Call this on reset to clear history
    resetHistory: () => {
      history.replaceState({ mainTab: 'transactions', contractTab: 0 }, '', location.href);
    }
  };
}
