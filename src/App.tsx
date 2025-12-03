import { createSignal, createEffect, createMemo, For, Show, onCleanup } from 'solid-js';
import { codeToHtml } from 'shiki';
import { Copy, Check, X } from 'lucide-solid';
import { API_STREAM_URL } from './config.frontend';
import './styles.css';

// Example contracts for quick testing
const SIMPLE_EXAMPLE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleNFT {
    mapping(uint256 => address) public owners;
    uint256 public nextTokenId;

    function mint() external {
        owners[nextTokenId] = msg.sender;
        nextTokenId++;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return owners[tokenId];
    }
}`;

const COMPLEX_EXAMPLE = `// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.0 <0.9.0;
/// @title Voting with delegation.
contract Ballot {
    // This declares a new complex type which will
    // be used for variables later.
    // It will represent a single voter.
    struct Voter {
        uint weight; // weight is accumulated by delegation
        bool voted;  // if true, that person already voted
        address delegate; // person delegated to
        uint vote;   // index of the voted proposal
    }

    // This is a type for a single proposal.
    struct Proposal {
        bytes32 name;   // short name (up to 32 bytes)
        uint voteCount; // number of accumulated votes
    }

    address public chairperson;

    // This declares a state variable that
    // stores a \`Voter\` struct for each possible address.
    mapping(address => Voter) public voters;

    // A dynamically-sized array of \`Proposal\` structs.
    Proposal[] public proposals;

    /// Create a new ballot to choose one of \`proposalNames\`.
    constructor(bytes32[] memory proposalNames) {
        chairperson = msg.sender;
        voters[chairperson].weight = 1;

        // For each of the provided proposal names,
        // create a new proposal object and add it
        // to the end of the array.
        for (uint i = 0; i < proposalNames.length; i++) {
            // \`Proposal({...})\` creates a temporary
            // Proposal object and \`proposals.push(...)\`
            // appends it to the end of \`proposals\`.
            proposals.push(Proposal({
                name: proposalNames[i],
                voteCount: 0
            }));
        }
    }

    // Give \`voter\` the right to vote on this ballot.
    // May only be called by \`chairperson\`.
    function giveRightToVote(address voter) external {
        // If the first argument of \`require\` evaluates
        // to \`false\`, execution terminates and all
        // changes to the state and to Ether balances
        // are reverted.
        // This used to consume all gas in old EVM versions, but
        // not anymore.
        // It is often a good idea to use \`require\` to check if
        // functions are called correctly.
        // As a second argument, you can also provide an
        // explanation about what went wrong.
        require(
            msg.sender == chairperson,
            "Only chairperson can give right to vote."
        );
        require(
            !voters[voter].voted,
            "The voter already voted."
        );
        require(voters[voter].weight == 0);
        voters[voter].weight = 1;
    }

    /// Delegate your vote to the voter \`to\`.
    function delegate(address to) external {
        // assigns reference
        Voter storage sender = voters[msg.sender];
        require(sender.weight != 0, "You have no right to vote");
        require(!sender.voted, "You already voted.");

        require(to != msg.sender, "Self-delegation is disallowed.");

        // Forward the delegation as long as
        // \`to\` also delegated.
        // In general, such loops are very dangerous,
        // because if they run too long, they might
        // need more gas than is available in a block.
        // In this case, the delegation will not be executed,
        // but in other situations, such loops might
        // cause a contract to get "stuck" completely.
        while (voters[to].delegate != address(0)) {
            to = voters[to].delegate;

            // We found a loop in the delegation, not allowed.
            require(to != msg.sender, "Found loop in delegation.");
        }

        Voter storage delegate_ = voters[to];

        // Voters cannot delegate to accounts that cannot vote.
        require(delegate_.weight >= 1);

        // Since \`sender\` is a reference, this
        // modifies \`voters[msg.sender]\`.
        sender.voted = true;
        sender.delegate = to;

        if (delegate_.voted) {
            // If the delegate already voted,
            // directly add to the number of votes
            proposals[delegate_.vote].voteCount += sender.weight;
        } else {
            // If the delegate did not vote yet,
            // add to her weight.
            delegate_.weight += sender.weight;
        }
    }

    /// Give your vote (including votes delegated to you)
    /// to proposal \`proposals[proposal].name\`.
    function vote(uint proposal) external {
        Voter storage sender = voters[msg.sender];
        require(sender.weight != 0, "Has no right to vote");
        require(!sender.voted, "Already voted.");
        sender.voted = true;
        sender.vote = proposal;

        // If \`proposal\` is out of the range of the array,
        // this will throw automatically and revert all
        // changes.
        proposals[proposal].voteCount += sender.weight;
    }

    /// @dev Computes the winning proposal taking all
    /// previous votes into account.
    function winningProposal() public view
            returns (uint winningProposal_)
    {
        uint winningVoteCount = 0;
        for (uint p = 0; p < proposals.length; p++) {
            if (proposals[p].voteCount > winningVoteCount) {
                winningVoteCount = proposals[p].voteCount;
                winningProposal_ = p;
            }
        }
    }

    // Calls winningProposal() function to get the index
    // of the winner contained in the proposals array and then
    // returns the name of the winner
    function winnerName() external view
            returns (bytes32 winnerName_)
    {
        winnerName_ = proposals[winningProposal()].name;
    }
}`;

const NATURAL_LANGUAGE_EXAMPLE = `Create a Bitcoin Cash covenant smart contract for a crowdfunding campaign with the following requirements:

1. Campaign Setup:
   - The contract should be initialized with a funding goal amount (in satoshis)
   - Set a campaign deadline (block height or timestamp)
   - Store the recipient's public key hash who will receive the funds if goal is met
   - Include a minimum pledge amount to prevent dust

2. Pledge Functionality:
   - Anyone can pledge BCH to the campaign
   - Each pledge should be tracked separately
   - Pledgers should be able to add to their existing pledge
   - Store each pledger's public key hash for refund purposes

3. Success Conditions:
   - If the funding goal is reached before the deadline:
     * All pledged funds can be claimed by the campaign recipient
     * The recipient must provide a valid signature
     * The contract should verify the total amount meets or exceeds the goal

4. Refund Mechanism:
   - If the deadline passes and the goal is NOT met:
     * Each pledger can claim their pledge back
     * Pledgers must provide a signature to prove ownership
     * Refunds should include the exact amount they pledged
     * Must verify the deadline has actually passed

5. Security Requirements:
   - Prevent double-spending of pledges
   - Ensure only legitimate pledgers can claim refunds
   - Verify the campaign recipient's identity
   - Check all time locks and amount conditions are properly enforced

Please generate a complete CashScript covenant that implements all these features with proper error handling and validation.`;

// Single contract response type
type SingleContractResult = {
  primaryContract: string;
  validated?: boolean;
  bytecodeSize?: number;
  artifact?: any;
};

// Multi-contract response types
type ContractParam = {
  name: string;
  type: string;
  description: string;
  source: string;
  sourceContractId: string | null;
};

type ContractInfo = {
  id: string;
  name: string;
  purpose: string;
  code: string;
  role: string;
  deploymentOrder: number;
  dependencies: string[];
  constructorParams: ContractParam[];
  validated?: boolean;
  bytecodeSize?: number;
  artifact?: any;
  validationError?: string;
};

type DeploymentStep = {
  order: number;
  contractId: string;
  description: string;
  prerequisites: string[];
  outputs: string[];
};

type DeploymentGuide = {
  steps: DeploymentStep[];
  warnings: string[];
  testingNotes: string[];
};

type MultiContractResult = {
  contracts: ContractInfo[];
  deploymentGuide: DeploymentGuide;
};

type ConversionResult = SingleContractResult | MultiContractResult;

function isMultiContractResult(result: ConversionResult): result is MultiContractResult {
  return 'contracts' in result && Array.isArray(result.contracts);
}

export default function App() {
  const [evmContract, setEvmContract] = createSignal('');
  const [result, setResult] = createSignal<ConversionResult | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [copyStatus, setCopyStatus] = createSignal<'idle' | 'copied' | 'error'>('idle');
  const [contractCopyStatus, setContractCopyStatus] = createSignal<{[key: string]: 'idle' | 'copied' | 'error'}>({});
  const [highlightedHTML, setHighlightedHTML] = createSignal('');
  const [contractHighlightedHTML, setContractHighlightedHTML] = createSignal<{[key: string]: string}>({});
  const [artifactHTML, setArtifactHTML] = createSignal('');
  const [originalContractHTML, setOriginalContractHTML] = createSignal('');
  const [activeContractTab, setActiveContractTab] = createSignal(0);
  const [currentPhase, setCurrentPhase] = createSignal(1);
  const [phaseStartTimes, setPhaseStartTimes] = createSignal<{[key: number]: number}>({});
  const [connectorProgress, setConnectorProgress] = createSignal<{[key: number]: number}>({});
  const [retryCount, setRetryCount] = createSignal(0);
  const [validationDetails, setValidationDetails] = createSignal<{
    isMultiContract: boolean;
    validCount?: number;
    failedCount?: number;
    contracts?: Array<{ name: string; validated: boolean; attempt?: number }>;
  } | null>(null);

  // Incremental display state
  const [validatedContracts, setValidatedContracts] = createSignal<any[]>([]);
  const [pendingContracts, setPendingContracts] = createSignal<{ name: string; custodies?: string; validates?: string }[]>([]);
  const [deploymentGuide, setDeploymentGuide] = createSignal<any>(null);
  const [totalExpected, setTotalExpected] = createSignal(0);
  const [contractAttempts, setContractAttempts] = createSignal<Map<string, number>>(new Map());
  const [isMultiContract, setIsMultiContract] = createSignal(false);
  const [currentAbortController, setCurrentAbortController] = createSignal<AbortController | null>(null);

  // Transactions tab state
  const [transactions, setTransactions] = createSignal<any[]>([]);
  const [activeMainTab, setActiveMainTab] = createSignal<'transactions' | 'contracts'>('transactions');

  // Sorted contracts: primary first, then helper, then state
  const sortedContracts = createMemo(() => {
    // For incremental display, use validatedContracts
    const validated = validatedContracts();
    if (validated.length === 0) {
      // Fallback to old result() for compatibility
      const r = result();
      if (!r || !isMultiContractResult(r)) return [];
      const rolePriority = { primary: 0, helper: 1, state: 2 };
      return [...r.contracts].sort((a, b) => {
        const priorityDiff = (rolePriority[a.role as keyof typeof rolePriority] || 999) -
                            (rolePriority[b.role as keyof typeof rolePriority] || 999);
        if (priorityDiff !== 0) return priorityDiff;
        return a.deploymentOrder - b.deploymentOrder;
      });
    }

    // Use validated contracts for incremental display
    const rolePriority = { primary: 0, helper: 1, state: 2 };
    return [...validated].sort((a, b) => {
      const priorityDiff = (rolePriority[a.role as keyof typeof rolePriority] || 999) -
                          (rolePriority[b.role as keyof typeof rolePriority] || 999);
      if (priorityDiff !== 0) return priorityDiff;
      return a.deploymentOrder - b.deploymentOrder;
    });
  });

  // All contracts (validated + pending) for tab display
  const allContracts = createMemo(() => {
    const validated = validatedContracts();
    const pending = pendingContracts();

    if (validated.length === 0 && pending.length === 0) return [];

    // Get names of already validated contracts
    const validatedNames = new Set(validated.map(c => c.name));

    // Create pending contract stubs ONLY for contracts not yet validated
    const pendingStubs = pending
      .filter(spec => !validatedNames.has(spec.name))
      .map(spec => ({
        name: spec.name,
        custodies: spec.custodies,
        validates: spec.validates,
        validated: false,
        code: '',
        role: 'unknown',
        deploymentOrder: 999, // Will be updated when contract arrives
        isSkeleton: true
      }));

    // Combine and sort
    const combined = [...validated, ...pendingStubs];
    const rolePriority = { primary: 0, helper: 1, state: 2, unknown: 3 };
    return combined.sort((a, b) => {
      const priorityDiff = (rolePriority[a.role as keyof typeof rolePriority] || 999) -
                          (rolePriority[b.role as keyof typeof rolePriority] || 999);
      if (priorityDiff !== 0) return priorityDiff;
      return (a.deploymentOrder || 999) - (b.deploymentOrder || 999);
    });
  });

  // Helper to escape HTML entities for plain text fallback
  const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopyStatus('copied');
    setTimeout(() => setCopyStatus('idle'), 2000);
  };

  const copyContractToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setContractCopyStatus(prev => ({ ...prev, [id]: 'copied' }));
    setTimeout(() => setContractCopyStatus(prev => ({ ...prev, [id]: 'idle' })), 2000);
  };

  const handleReset = () => {
    setEvmContract('');
    setResult(null);
    setError('');
    setLoading(false);
    setHighlightedHTML('');
    setContractHighlightedHTML({});
    setArtifactHTML('');
    setOriginalContractHTML('');
    setActiveContractTab(0);
    setCopyStatus('idle');
    setContractCopyStatus({});
    setCurrentPhase(1);
    setRetryCount(0);
    setValidationDetails(null);
    // Clear incremental state
    setValidatedContracts([]);
    setPendingContracts([]);
    setDeploymentGuide(null);
    setTotalExpected(0);
    setContractAttempts(new Map());
    setIsMultiContract(false);
    // Reset transactions tab state
    setTransactions([]);
    setPendingContracts([]);
    setActiveMainTab('transactions');
    // Abort any ongoing SSE connection
    const controller = currentAbortController();
    if (controller) {
      controller.abort();
      setCurrentAbortController(null);
    }
  };

  // Track connector progress based on elapsed time (60s per phase)
  const PHASE_DURATION_MS = 60000;

  // Record phase start times when phase changes
  createEffect(() => {
    const phase = currentPhase();
    if (phase >= 1 && phase <= 4) {
      setPhaseStartTimes(prev => {
        if (!prev[phase]) {
          return { ...prev, [phase]: Date.now() };
        }
        return prev;
      });
    }
  });

  // Separate interval for progress updates (not tied to reactive tracking)
  let progressInterval: ReturnType<typeof setInterval> | null = null;

  createEffect(() => {
    const isLoading = loading();

    if (isLoading && !progressInterval) {
      progressInterval = setInterval(() => {
        const now = Date.now();
        const times = phaseStartTimes();
        const phase = currentPhase();
        const progress: {[key: number]: number} = {};

        for (let p = 1; p <= 3; p++) {
          const startTime = times[p];
          if (startTime && phase === p) {
            const elapsed = now - startTime;
            progress[p] = Math.min(100, (elapsed / PHASE_DURATION_MS) * 100);
          } else if (phase > p) {
            progress[p] = 100;
          } else {
            progress[p] = 0;
          }
        }

        setConnectorProgress(progress);
      }, 500);
    } else if (!isLoading && progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
      // Set all completed
      setConnectorProgress({ 1: 100, 2: 100, 3: 100 });
    }

    onCleanup(() => {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    });
  });

  // Track which contracts are currently being highlighted to prevent duplicates
  const highlightingInProgress = new Set<string>();

  // Syntax highlighting for incremental contracts
  createEffect(async () => {
    const validated = validatedContracts();
    if (validated.length > 0) {
      // Get current highlighted contracts to preserve existing ones
      const currentHighlighted = contractHighlightedHTML();

      // Only highlight contracts that don't already have HTML AND aren't being highlighted
      const contractsToHighlight = validated.filter(c =>
        !currentHighlighted[c.id] && !highlightingInProgress.has(c.id)
      );

      if (contractsToHighlight.length > 0) {
        // Mark all as in-progress before starting async work
        contractsToHighlight.forEach(c => highlightingInProgress.add(c.id));

        for (const contract of contractsToHighlight) {
          if (!contract.id) {
            console.error('[Jump] Contract missing id field:', contract);
            throw new Error(`Contract missing id field: ${contract.name}`);
          }
          if (!contract.code) {
            console.error('[Jump] Contract missing code field:', contract);
            throw new Error(`Contract missing code field: ${contract.name}`);
          }

          let html: string;
          try {
            html = await codeToHtml(contract.code, {
              lang: 'javascript',
              theme: 'dark-plus'
            });
          } catch (error) {
            // Fallback: If Shiki fails (large contract, memory limit, etc.), use plain text
            console.error('[Jump] ✗ Shiki highlighting failed for contract:', contract.id, error);
            html = `<pre class="shiki" style="background-color:#1e1e1e;color:#d4d4d4"><code>${escapeHtml(contract.code)}</code></pre>`;
          }

          // Update incrementally - add this contract without losing others
          setContractHighlightedHTML(prev => ({
            ...prev,
            [contract.id]: html
          }));

          // Remove from in-progress tracking
          highlightingInProgress.delete(contract.id);
        }
      }
    }
  });

  // Track if we've done the initial auto-switch to first validated contract
  let hasAutoSwitched = false;

  // Auto-switch to first validated contract ONCE when results first appear
  createEffect(() => {
    const validated = validatedContracts();
    const all = allContracts();

    // Only auto-switch once, when we first get validated contracts
    if (!hasAutoSwitched && validated.length > 0 && all.length > 0) {
      const currentTab = activeContractTab();

      // Don't interfere if user intentionally set tab to Original (tab >= all.length)
      if (currentTab >= all.length) {
        return;
      }

      const currentContract = all[currentTab];

      // If current tab is pending, switch to first validated contract
      if (!currentContract || !currentContract.validated) {
        const firstValidatedIndex = all.findIndex(c => c.validated);
        if (firstValidatedIndex !== -1) {
          setActiveContractTab(firstValidatedIndex);
          hasAutoSwitched = true; // Don't interfere with user clicks after this
        }
      }
    }
  });

  // Syntax highlighting for legacy result() flow (backward compatibility)
  createEffect(async () => {
    const r = result();
    if (r) {
      if (isMultiContractResult(r)) {
        // Multi-contract response
        const contractHtmls: {[key: string]: string} = {};
        for (const contract of r.contracts) {
          let html: string;
          try {
            html = await codeToHtml(contract.code, {
              lang: 'javascript',
              theme: 'dark-plus'
            });
          } catch (error) {
            console.error('[Jump] ✗ Shiki highlighting failed for legacy multi-contract:', contract.id, error);
            html = `<pre class="shiki" style="background-color:#1e1e1e;color:#d4d4d4"><code>${escapeHtml(contract.code)}</code></pre>`;
          }
          contractHtmls[contract.id] = html;
        }
        setContractHighlightedHTML(contractHtmls);
      } else {
        // Single contract response
        let html: string;
        try {
          html = await codeToHtml(r.primaryContract, {
            lang: 'javascript',
            theme: 'dark-plus'
          });
        } catch (error) {
          console.error('[Jump] ✗ Shiki highlighting failed for single contract:', error);
          html = `<pre class="shiki" style="background-color:#1e1e1e;color:#d4d4d4"><code>${escapeHtml(r.primaryContract)}</code></pre>`;
        }
        setHighlightedHTML(html);

        if (r.artifact) {
          const artifactJson = JSON.stringify(r.artifact, null, 2);
          try {
            const artifactHtml = await codeToHtml(artifactJson, {
              lang: 'json',
              theme: 'dark-plus'
            });
            setArtifactHTML(artifactHtml);
          } catch (error) {
            console.error('[Jump] ✗ Shiki highlighting failed for artifact:', error);
            setArtifactHTML(`<pre class="shiki" style="background-color:#1e1e1e;color:#d4d4d4"><code>${escapeHtml(artifactJson)}</code></pre>`);
          }
        }
      }
    }
  });

  // Highlight original Solidity contract when loading or results are shown
  createEffect(async () => {
    const contract = evmContract();
    const shouldHighlight = loading() || result() || validatedContracts().length > 0 || transactions().length > 0;
    if (shouldHighlight && contract) {
      try {
        const html = await codeToHtml(contract, {
          lang: 'solidity',
          theme: 'dark-plus'
        });
        setOriginalContractHTML(html);
      } catch (error) {
        console.error('[Jump] ✗ Shiki highlighting failed for original Solidity contract:', error);
        const html = `<pre class="shiki" style="background-color:#1e1e1e;color:#d4d4d4"><code>${escapeHtml(contract)}</code></pre>`;
        setOriginalContractHTML(html);
      }
    }
  });

  const handleConvert = async () => {
    const contract = evmContract().trim();
    if (!contract) {
      return;
    }

    // Abort any existing controller before creating a new one
    const existingController = currentAbortController();
    if (existingController) {
      existingController.abort();
    }

    // Create AbortController to allow cancellation
    const abortController = new AbortController();
    setCurrentAbortController(abortController);

    setLoading(true);
    setError('');
    setResult(null);
    setHighlightedHTML('');
    setContractHighlightedHTML({});
    setArtifactHTML('');
    setActiveContractTab(0);
    setCurrentPhase(1);
    setRetryCount(0);
    setValidationDetails(null);

    try {
      const response = await fetch(API_STREAM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contract }),
        signal: abortController.signal
      });

      if (!response.ok || !response.body) {
        // Try to get detailed error info from server
        let errorMessage = `Failed to start conversion stream (HTTP ${response.status})`;

        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
            if (errorData.message) {
              errorMessage += `: ${errorData.message}`;
            }
            if (errorData.retryAfter) {
              errorMessage += ` (retry after ${errorData.retryAfter}s)`;
            }
          }
        } catch (e) {
          // If we can't parse JSON, use status text
          if (response.statusText) {
            errorMessage += `: ${response.statusText}`;
          }
        }

        setError(errorMessage);
        setLoading(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';  // Save event type across chunks

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) continue;

          if (line.startsWith('event:')) {
            currentEventType = line.substring(6).trim();  // Save for next data line
            continue;
          }

          if (line.startsWith('data:')) {
            const data = JSON.parse(line.substring(5).trim());
            const eventType = currentEventType || 'unknown';  // Use saved event type

            // Ignore stale events if user clicked "Start Over"
            if (!loading()) {
              continue;
            }

            switch (eventType) {
              case 'phase1_start':
                setCurrentPhase(1);
                break;

              case 'phase1_complete':
                // Stay at phase 1 until phase 2 starts
                break;

              case 'phase2_start':
                setCurrentPhase(2);
                break;

              case 'phase2_complete':
                // Stay at phase 2 until phase 3 starts
                break;

              case 'transactions_ready':
                // Receive transaction templates and contract specs from Phase 2
                if (data.transactions && Array.isArray(data.transactions)) {
                  // Derive participatingContracts from inputs/outputs if not provided
                  // Filter out empty transactions (off-chain queries with no inputs/outputs)
                  const enrichedTransactions = data.transactions
                    .filter((tx: any) => {
                      const hasInputs = (tx.inputs || []).length > 0;
                      const hasOutputs = (tx.outputs || []).length > 0;
                      return hasInputs || hasOutputs;
                    })
                    .map((tx: any) => {
                    if (!tx.participatingContracts || tx.participatingContracts.length === 0) {
                      const contracts = new Set<string>();

                      // Helper to extract contract name from type field like "CampaignNFT at CampaignContract"
                      const extractContract = (typeStr: string) => {
                        if (!typeStr) return null;
                        // Skip P2PKH, BCH, OP_RETURN, User entries
                        if (typeStr.includes('P2PKH') || typeStr.startsWith('BCH') ||
                            typeStr.includes('OP_RETURN') || typeStr.includes('User') ||
                            typeStr.includes('change')) return null;
                        // Try "at ContractName" pattern (most common: "CampaignNFT at CampaignContract")
                        const atMatch = typeStr.match(/at\s+(\w+)/);
                        if (atMatch) return atMatch[1];
                        // Try "ContractName (description)" pattern
                        const parenMatch = typeStr.match(/^(\w+)\s*\(/);
                        if (parenMatch) return parenMatch[1];
                        // Try just contract name at start
                        const startMatch = typeStr.match(/^(\w+Contract)/);
                        if (startMatch) return startMatch[1];
                        return null;
                      };

                      (tx.inputs || []).forEach((i: any) => {
                        if (i.contract) contracts.add(i.contract);
                        if (i.from && !i.from.includes('P2PKH') && !i.from.includes('User')) contracts.add(i.from);
                        const fromType = extractContract(i.type);
                        if (fromType) contracts.add(fromType);
                      });
                      (tx.outputs || []).forEach((o: any) => {
                        if (o.contract) contracts.add(o.contract);
                        if (o.to && !o.to.includes('P2PKH') && !o.to.includes('User')) contracts.add(o.to);
                        const toType = extractContract(o.type);
                        if (toType) contracts.add(toType);
                      });
                      return { ...tx, participatingContracts: Array.from(contracts) };
                    }
                    return tx;
                  });
                  setTransactions(enrichedTransactions);
                }
                // Store contract specs for skeleton display
                if (data.contractSpecs && Array.isArray(data.contractSpecs)) {
                  setPendingContracts(data.contractSpecs);
                  setIsMultiContract(data.contractSpecs.length > 1);
                }
                break;

              case 'phase3_start':
                setCurrentPhase(3);
                break;

              case 'phase3_complete':
                // Stay at phase 3 until phase 4 starts
                break;

              case 'phase4_start':
                setCurrentPhase(4);
                break;

              case 'phase4_complete':
                // Validation complete
                break;

              case 'validation':
                setCurrentPhase(4);
                // Update retry tracking for Phase 3 validation display
                setRetryCount(data.attempt - 1);
                // Store validation details for display
                setValidationDetails({
                  isMultiContract: data.isMultiContract || false,
                  validCount: data.validCount,
                  failedCount: data.failedCount,
                  contracts: data.contracts
                });
                // Update contract attempts only - don't overwrite pendingContracts
                // to preserve the rich object structure from Phase 2
                if (data.contracts && Array.isArray(data.contracts)) {
                  const attempts = new Map(contractAttempts());
                  data.contracts.forEach((c: any) => {
                    if (c.attempt) {
                      attempts.set(c.name, c.attempt);
                    }
                  });
                  setContractAttempts(attempts);
                }
                break;

              case 'contract_ready':
                // Add validated contract
                setValidatedContracts(prev => [...prev, data.contract]);
                // Update deployment guide if present
                if (data.deploymentGuide) {
                  setDeploymentGuide(data.deploymentGuide);
                }
                // Update total expected
                if (data.totalExpected) {
                  setTotalExpected(data.totalExpected);
                  setIsMultiContract(data.totalExpected > 1);
                }
                // Remove from pending list (compare by name property)
                setPendingContracts(prev => prev.filter(c => c.name !== data.contract.name));
                // Transition to results view if this is the first contract
                if (validatedContracts().length === 0) {
                  setLoading(false);
                }
                break;

              case 'done':
                setResult(data);
                setLoading(false);
                break;

              case 'error':
                console.error('[Jump] Error:', data);
                setError(data.message || 'Conversion failed');
                setLoading(false);
                break;
            }
          }
        }
      }
    } catch (err) {
      // Handle abort separately - not an error, user clicked "Start Over"
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      console.error('[Jump] Conversion error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Conversion failed: ${errorMessage}`);
      setLoading(false);
    }
  };

  return (
    <>
      <div class="container">
        <nav class="header-nav">
          <a href="https://faq.layer1.cash" class="nav-link">FAQ</a>
          <a href="https://arena.layer1.cash" class="nav-link">Arena</a>
          <a href="https://jump.layer1.cash" class="nav-link active">Jump</a>
        </nav>
        <header>
          <h1>Jump to layer 1 (beta)</h1>
          <p class="intro">Convert your Solidity smart contract to CashScript</p>
        </header>

        <div class="converter">
          <Show when={!result() && !loading() && validatedContracts().length === 0}>
            <div class="input-section">
              <div class="textarea-wrapper">
                <textarea
                  class="input-textarea"
                  placeholder="Paste your EVM smart contract code here..."
                  value={evmContract()}
                  onInput={(e) => setEvmContract(e.currentTarget.value)}
                  spellcheck={false}
                />
                <div class="example-buttons-overlay">
                  <Show when={!evmContract()}>
                    <span class="example-label">...Or choose an example:</span>
                  </Show>
                  <button
                    class="example-btn"
                    onClick={() => setEvmContract(SIMPLE_EXAMPLE)}
                    title="Load simple NFT contract example"
                  >
                    Simple
                  </button>
                  <button
                    class="example-btn"
                    onClick={() => setEvmContract(COMPLEX_EXAMPLE)}
                    title="Load complex voting contract example"
                  >
                    Complex
                  </button>
                  <button
                    class="example-btn"
                    onClick={() => setEvmContract(NATURAL_LANGUAGE_EXAMPLE)}
                    title="Try natural language description (experimental)"
                  >
                    Natural language (experimental)
                  </button>
                </div>
              </div>
            </div>

            <button
              class="convert-btn"
              onClick={handleConvert}
              disabled={loading() || !evmContract().trim()}
            >
              {loading() ? 'Converting...' : 'Convert to CashScript'}
            </button>
          </Show>

          <div class="output-section">
            {error() && <div class="error">{error()}</div>}

            {(loading() || result() || validatedContracts().length > 0 || transactions().length > 0) && (() => {
              // Use incremental state if available, otherwise fall back to result()
              const hasIncrementalData = validatedContracts().length > 0;
              const hasPendingContracts = pendingContracts().length > 0;
              const r = result();
              const isMulti = hasIncrementalData ? isMultiContract() : hasPendingContracts ? pendingContracts().length > 1 : (r && isMultiContractResult(r));
              // Use pending contracts as skeletons if no validated contracts yet
              const contractsToDisplay = hasIncrementalData
                ? allContracts()
                : hasPendingContracts
                  ? pendingContracts().map(c => ({ ...c, validated: false, code: '', isSkeleton: true }))
                  : (isMulti && r ? sortedContracts() : []);
              // Determine if we're showing skeleton tabs (early loading, no contracts yet)
              const hasSkeletonTabs = loading() && contractsToDisplay.length === 0;
              // Fix: Use >= for both multi and single to handle Original button setting tab to 9999
              // Multi or skeleton tabs: tab >= contractsToDisplay.length (or >= 3 for skeletons) means Original
              // Single: tab >= 1 means Original (tab 0 is the contract, tab 1+ is Original)
              const isOriginalTab = isMulti || hasSkeletonTabs
                ? activeContractTab() >= (hasSkeletonTabs ? 3 : contractsToDisplay.length)
                : activeContractTab() >= 1;

              return (
                <>
                  {/* Main tabs: Transactions / Contracts / Original / Start Over */}
                  <div class="main-tabs">
                    <button
                      class={`main-tab ${activeMainTab() === 'transactions' ? 'active' : ''}`}
                      onClick={() => setActiveMainTab('transactions')}
                    >
                      Transactions
                      <Show when={transactions().length > 0}>
                        <span class="tab-count">{transactions().length}</span>
                      </Show>
                    </button>

                    <button
                      class={`main-tab ${activeMainTab() === 'contracts' ? 'active' : ''}`}
                      onClick={() => setActiveMainTab('contracts')}
                    >
                      Contracts
                      <Show when={contractsToDisplay.length > 0}>
                        {(() => {
                          const allValidated = contractsToDisplay.every(c => c.validated);
                          return (
                            <span class={`tab-count ${!allValidated ? 'loading' : ''}`}>
                              {allValidated ? contractsToDisplay.length : <span class="tab-spinner-inline"></span>}
                              {!allValidated && ` ${contractsToDisplay.filter(c => c.validated).length}/${contractsToDisplay.length}`}
                            </span>
                          );
                        })()}
                      </Show>
                    </button>

                    <button class="main-tab start-over-btn" onClick={handleReset}>
                      Start over
                    </button>
                  </div>

                  {/* Content based on active main tab */}
                  <Show when={activeMainTab() === 'transactions'}>
                    <div class="transactions-view">
                      <Show when={transactions().length === 0 && loading()}>
                        <div class="transactions-skeleton">
                          {/* Phase progress indicator */}
                          <div class="phase-progress">
                            <div class={`phase-step ${currentPhase() >= 1 ? 'active' : ''} ${currentPhase() > 1 ? 'completed' : ''}`}>
                              <div class="phase-indicator">
                                {currentPhase() > 1 ? '✓' : currentPhase() === 1 ? <span class="phase-spinner"></span> : '1'}
                              </div>
                              <span>Domain Model</span>
                            </div>
                            <div class="phase-connector">
                              <div class="connector-fill" style={{ width: `${connectorProgress()[1] || 0}%`, background: (connectorProgress()[1] || 0) >= 100 ? 'rgba(57, 255, 20, 0.5)' : 'linear-gradient(90deg, rgba(255, 165, 0, 0.6), rgba(255, 165, 0, 0.3))' }}></div>
                            </div>
                            <div class={`phase-step ${currentPhase() >= 2 ? 'active' : ''} ${currentPhase() > 2 ? 'completed' : ''}`}>
                              <div class="phase-indicator">
                                {currentPhase() > 2 ? '✓' : currentPhase() === 2 ? <span class="phase-spinner"></span> : '2'}
                              </div>
                              <span>Architecture</span>
                            </div>
                            <div class="phase-connector">
                              <div class="connector-fill" style={{ width: `${connectorProgress()[2] || 0}%`, background: (connectorProgress()[2] || 0) >= 100 ? 'rgba(57, 255, 20, 0.5)' : 'linear-gradient(90deg, rgba(255, 165, 0, 0.6), rgba(255, 165, 0, 0.3))' }}></div>
                            </div>
                            <div class={`phase-step ${currentPhase() >= 3 ? 'active' : ''} ${currentPhase() > 3 ? 'completed' : ''}`}>
                              <div class="phase-indicator">
                                {currentPhase() > 3 ? '✓' : currentPhase() === 3 ? <span class="phase-spinner"></span> : '3'}
                              </div>
                              <span>Code Gen</span>
                            </div>
                            <div class="phase-connector">
                              <div class="connector-fill" style={{ width: `${connectorProgress()[3] || 0}%`, background: (connectorProgress()[3] || 0) >= 100 ? 'rgba(57, 255, 20, 0.5)' : 'linear-gradient(90deg, rgba(255, 165, 0, 0.6), rgba(255, 165, 0, 0.3))' }}></div>
                            </div>
                            <div class={`phase-step ${currentPhase() >= 4 ? 'active' : ''}`}>
                              <div class="phase-indicator">
                                {currentPhase() === 4 ? <span class="phase-spinner"></span> : '4'}
                              </div>
                              <span>Validation</span>
                            </div>
                          </div>

                          {/* Skeleton transaction cards */}
                          <div class="skeleton-transactions">
                            <For each={[1, 2, 3]}>
                              {() => (
                                <div class="skeleton-tx-card">
                                  <div class="skeleton-tx-header">
                                    <div class="skeleton-line w-40"></div>
                                    <div class="skeleton-line w-70"></div>
                                  </div>
                                  <div class="skeleton-tx-flow">
                                    <div class="skeleton-tx-side">
                                      <div class="skeleton-line w-20"></div>
                                      <div class="skeleton-slot"></div>
                                      <div class="skeleton-slot"></div>
                                    </div>
                                    <div class="skeleton-arrow"></div>
                                    <div class="skeleton-tx-side">
                                      <div class="skeleton-line w-20"></div>
                                      <div class="skeleton-slot"></div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                      <Show when={transactions().length > 0}>
                        <div class="transactions-list">
                          <For each={transactions()}>
                            {(tx) => (
                              <div class="transaction-card">
                                <div class="tx-header">
                                  <div class="tx-header-left">
                                    <h3 class="tx-name">{tx.name}</h3>
                                    <p class="tx-description">{tx.description}</p>
                                  </div>
                                  <Show when={(tx.participatingContracts || []).length > 0}>
                                    <div class="tx-header-right">
                                      <span class="tx-badge">{(tx.participatingContracts || []).join(' · ')}</span>
                                    </div>
                                  </Show>
                                </div>

                                <div class="tx-flow">
                                  <div class="tx-inputs">
                                    <h4>Inputs</h4>
                                    <For each={tx.inputs || []}>
                                      {(input: any) => (
                                        <div class={`tx-slot input-slot ${input.contract ? 'contract' : 'user'}`}>
                                          <div class="slot-index">[{input.index}]</div>
                                          <div class="slot-content">
                                            <div class="slot-label">
                                              {input.contract || input.from}
                                              <Show when={input.type}>
                                                <span class={`slot-type ${input.type}`}>{input.type}</span>
                                              </Show>
                                            </div>
                                            <div class="slot-description">{input.description}</div>
                                          </div>
                                        </div>
                                      )}
                                    </For>
                                  </div>

                                  <div class="tx-arrow">→</div>

                                  <div class="tx-outputs">
                                    <h4>Outputs</h4>
                                    <For each={tx.outputs || []}>
                                      {(output: any) => (
                                        <div class={`tx-slot output-slot ${output.contract ? 'contract' : 'user'}`}>
                                          <div class="slot-index">[{output.index}]</div>
                                          <div class="slot-content">
                                            <div class="slot-label">
                                              {output.contract || output.to}
                                              <Show when={output.type}>
                                                <span class={`slot-type ${output.type}`}>{output.type}</span>
                                              </Show>
                                            </div>
                                            <div class="slot-description">{output.description}</div>
                                            <Show when={output.changes && output.changes.length > 0}>
                                              <div class="slot-changes">
                                                <For each={output.changes}>
                                                  {(change: any) => (
                                                    <span class={`change-badge ${change.changeType}`}>
                                                      {change.field}: {change.changeType}
                                                    </span>
                                                  )}
                                                </For>
                                              </div>
                                            </Show>
                                          </div>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>

                                <Show when={tx.flowDescription}>
                                  <details class="tx-flow-description">
                                    <summary>Flow Description</summary>
                                    <p>{tx.flowDescription}</p>
                                  </details>
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  {/* Contracts view (existing) */}
                  <Show when={activeMainTab() === 'contracts'}>
                    {/* Contract sub-tabs */}
                    <div class="contract-tabs">
                      <Show when={contractsToDisplay.length > 0}>
                        <For each={contractsToDisplay}>
                          {(contract, idx) => {
                            const attemptNum = contractAttempts().get(contract.name);
                            return (
                              <button
                                class={`contract-tab ${activeContractTab() === idx() ? 'active' : ''} ${!contract.validated ? 'pending' : ''}`}
                                onClick={() => setActiveContractTab(idx())}
                              >
                                <span class="tab-name">{contract.name}</span>
                                {contract.validated ? (
                                  <span class="tab-status valid">✓</span>
                                ) : (
                                  <span class="tab-status pending">
                                    <span class="tab-spinner"></span>
                                    {attemptNum && attemptNum > 1 && (
                                      <span class="attempt-badge">attempt {attemptNum}</span>
                                    )}
                                  </span>
                                )}
                              </button>
                            );
                          }}
                        </For>
                      </Show>
                      {/* Skeleton tabs during early phases */}
                      <Show when={loading() && contractsToDisplay.length === 0}>
                        <button
                          class={`contract-tab pending skeleton-tab ${activeContractTab() === 0 ? 'active' : ''}`}
                          onClick={() => setActiveContractTab(0)}
                        >
                          <span class="tab-name-skeleton"></span>
                          <span class="tab-status pending"><span class="tab-spinner"></span></span>
                        </button>
                        <button
                          class={`contract-tab pending skeleton-tab ${activeContractTab() === 1 ? 'active' : ''}`}
                          onClick={() => setActiveContractTab(1)}
                        >
                          <span class="tab-name-skeleton"></span>
                          <span class="tab-status pending"><span class="tab-spinner"></span></span>
                        </button>
                        <button
                          class={`contract-tab pending skeleton-tab ${activeContractTab() === 2 ? 'active' : ''}`}
                          onClick={() => setActiveContractTab(2)}
                        >
                          <span class="tab-name-skeleton"></span>
                          <span class="tab-status pending"><span class="tab-spinner"></span></span>
                        </button>
                      </Show>
                      {/* Original button - always on right side */}
                      <button
                        class={`contract-tab original-tab ${isOriginalTab ? 'active' : ''}`}
                        onClick={() => setActiveContractTab(9999)}
                      >
                        <span class="tab-name">Original</span>
                      </button>
                    </div>

                  {/* Contract card (active tab content) */}
                  <div class="contract-card">
                    {isOriginalTab ? (
                      // Show original Solidity contract
                      <div class="code-container">
                        <div class="code-block" innerHTML={originalContractHTML()} />
                        <button
                          class={`code-copy-btn ${contractCopyStatus()['original'] === 'copied' ? 'copied' : ''}`}
                          onClick={() => copyContractToClipboard(evmContract(), 'original')}
                          disabled={contractCopyStatus()['original'] === 'copied'}
                          title={contractCopyStatus()['original'] === 'copied' ? 'Copied!' : 'Copy to clipboard'}
                        >
                          {contractCopyStatus()['original'] === 'copied'
                            ? <Check size={20} />
                            : <Copy size={20} />}
                        </button>
                      </div>
                    ) : isMulti ? (
                      // Show multi-contract content
                      (() => {
                        const contract = contractsToDisplay[activeContractTab()];
                        if (!contract) return null;

                        // Show loading state for pending contracts
                        if (!contract.validated) {
                          const attemptNum = contractAttempts().get(contract.name);
                          const phase = currentPhase();
                          const isSkeleton = (contract as any).isSkeleton;

                          // Determine phase message
                          let phaseMessage = 'Waiting...';
                          if (phase === 3) {
                            phaseMessage = 'Phase 3: Generating CashScript code...';
                          } else if (phase === 4) {
                            phaseMessage = attemptNum && attemptNum > 1
                              ? `Phase 4: Fixing contract (attempt ${attemptNum})`
                              : 'Phase 4: Validating with compiler...';
                          }

                          return (
                            <div class="pending-contract-state skeleton">
                              <div class="skeleton-header">
                                <div class="pending-spinner"></div>
                                <div class="pending-message">
                                  <strong>{contract.name}</strong>
                                  <p class="phase-info">{phaseMessage}</p>
                                </div>
                              </div>

                              {/* Show contract spec info if available */}
                              <Show when={isSkeleton && (contract.custodies || contract.validates)}>
                                <div class="skeleton-specs">
                                  <Show when={contract.custodies}>
                                    <div class="spec-item">
                                      <span class="spec-label">Custodies:</span>
                                      <span class="spec-value">{contract.custodies}</span>
                                    </div>
                                  </Show>
                                  <Show when={contract.validates}>
                                    <div class="spec-item">
                                      <span class="spec-label">Validates:</span>
                                      <span class="spec-value">{contract.validates}</span>
                                    </div>
                                  </Show>
                                </div>
                              </Show>

                              {/* Skeleton code block */}
                              <div class="skeleton-code">
                                <div class="skeleton-line w-40"></div>
                                <div class="skeleton-line w-60"></div>
                                <div class="skeleton-line w-80"></div>
                                <div class="skeleton-line w-50"></div>
                                <div class="skeleton-line w-70"></div>
                                <div class="skeleton-line w-45"></div>
                                <div class="skeleton-line w-90"></div>
                                <div class="skeleton-line w-55"></div>
                              </div>
                            </div>
                          );
                        }

                        // Get highlighting HTML (may be empty if still in progress)
                        const highlightedHtml = contractHighlightedHTML()[contract.id];

                        return (
                          <>
                            {contract.dependencies && contract.dependencies.length > 0 && (
                              <div class="contract-dependencies">
                                <strong>Dependencies:</strong> {contract.dependencies.join(', ')}
                              </div>
                            )}

                            <div class="code-container">
                              <div class="code-block" innerHTML={highlightedHtml} />
                              <button
                                class={`code-copy-btn ${contractCopyStatus()[contract.id] === 'copied' ? 'copied' : ''}`}
                                onClick={() => copyContractToClipboard(contract.code, contract.id)}
                                disabled={contractCopyStatus()[contract.id] === 'copied'}
                                title={contractCopyStatus()[contract.id] === 'copied' ? 'Copied!' : 'Copy to clipboard'}
                              >
                                {contractCopyStatus()[contract.id] === 'copied'
                                  ? <Check size={20} />
                                  : <Copy size={20} />}
                              </button>
                            </div>

                            {contract.bytecodeSize && (
                              <div class="bytecode-size">
                                Bytecode size: {contract.bytecodeSize} bytes
                              </div>
                            )}
                          </>
                        );
                      })()
                    ) : loading() && !hasIncrementalData && !r ? (
                      // Show skeleton during early loading phases (1-2)
                      <div class="pending-contract-state skeleton">
                        <div class="skeleton-code">
                          <div class="skeleton-line w-40"></div>
                          <div class="skeleton-line w-60"></div>
                          <div class="skeleton-line w-80"></div>
                          <div class="skeleton-line w-50"></div>
                          <div class="skeleton-line w-70"></div>
                          <div class="skeleton-line w-45"></div>
                          <div class="skeleton-line w-90"></div>
                          <div class="skeleton-line w-55"></div>
                        </div>
                      </div>
                    ) : (
                      // Show single contract content
                      (() => {
                        // Use incremental data if available (contract_ready flow), otherwise legacy result()
                        const html = hasIncrementalData && validatedContracts()[0]
                          ? contractHighlightedHTML()[validatedContracts()[0].id]
                          : highlightedHTML();

                        const code = hasIncrementalData && validatedContracts()[0]
                          ? validatedContracts()[0].code
                          : (r as SingleContractResult)?.primaryContract;

                        return (
                          <div class="code-container">
                            <div class="code-block" innerHTML={html} />
                            <button
                              class={`code-copy-btn ${copyStatus() === 'copied' ? 'copied' : copyStatus() === 'error' ? 'error' : ''}`}
                              onClick={() => {
                                if (code) copyToClipboard(code);
                              }}
                              disabled={copyStatus() === 'copied'}
                              title={copyStatus() === 'copied' ? 'Copied!' : 'Copy to clipboard'}
                            >
                              {copyStatus() === 'copied' ? <Check size={20} /> : copyStatus() === 'error' ? <X size={20} /> : <Copy size={20} />}
                            </button>
                          </div>
                        );
                      })()
                    )}
                  </div>

                  {/* Expandable sections */}
                  {!isOriginalTab && (
                    <div class="expandable-sections">
                      {isMulti ? (
                        // Deployment guide for multi-contract
                        (() => {
                          const guide = hasIncrementalData ? deploymentGuide() : (r as MultiContractResult)?.deploymentGuide;
                          if (!guide) return null;

                          return (
                            <details class="detail-section">
                              <summary class="detail-summary">Deployment Guide</summary>
                              <div class="deployment-guide">
                                <div class="deployment-steps">
                                  <strong>Deployment Steps:</strong>
                                  <ol>
                                    <For each={guide.steps}>
                                      {(step) => (
                                        <li>
                                          <div class="step-description">{step.description}</div>
                                          {step.prerequisites.length > 0 && (
                                            <div class="step-prereqs">
                                              Prerequisites: {step.prerequisites.join(', ')}
                                            </div>
                                          )}
                                          {step.outputs.length > 0 && (
                                            <div class="step-outputs">
                                              Outputs: {step.outputs.join(', ')}
                                            </div>
                                          )}
                                        </li>
                                      )}
                                    </For>
                                  </ol>
                                </div>

                                {guide.warnings.length > 0 && (
                                  <div class="deployment-warnings">
                                    <strong>Warnings:</strong>
                                    <ul>
                                      <For each={guide.warnings}>
                                        {(warning) => <li class="warning-item">{warning}</li>}
                                      </For>
                                    </ul>
                                  </div>
                                )}

                                {guide.testingNotes.length > 0 && (
                                  <div class="deployment-testing">
                                    <strong>Testing Notes:</strong>
                                    <ul>
                                      <For each={guide.testingNotes}>
                                        {(note) => <li>{note}</li>}
                                      </For>
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </details>
                          );
                        })()
                      ) : (
                        // Artifact for single contract
                        r && (r as SingleContractResult).artifact && (
                          <details class="detail-section">
                            <summary class="detail-summary">Compiled Artifact</summary>
                            <div class="code-container">
                              <div class="code-block" innerHTML={artifactHTML()} />
                            </div>
                          </details>
                        )
                      )}
                    </div>
                  )}
                  </Show>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <footer>
        contact:{' '}
        <a
          href="https://t.me/Toorik_2"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://t.me/Toorik_2
        </a>
      </footer>
    </>
  );
}
