import { createSignal, createEffect, createMemo, For, Show } from 'solid-js';
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
  const [retryCount, setRetryCount] = createSignal(0);
  const [maxRetries, setMaxRetries] = createSignal(10);
  const [validationDetails, setValidationDetails] = createSignal<{
    isMultiContract: boolean;
    validCount?: number;
    failedCount?: number;
    contracts?: Array<{ name: string; validated: boolean; attempt?: number }>;
  } | null>(null);

  // Incremental display state
  const [validatedContracts, setValidatedContracts] = createSignal<any[]>([]);
  const [pendingContracts, setPendingContracts] = createSignal<string[]>([]);
  const [deploymentGuide, setDeploymentGuide] = createSignal<any>(null);
  const [totalExpected, setTotalExpected] = createSignal(0);
  const [allComplete, setAllComplete] = createSignal(false);
  const [contractAttempts, setContractAttempts] = createSignal<Map<string, number>>(new Map());
  const [isMultiContract, setIsMultiContract] = createSignal(false);

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

    // Create pending contract stubs
    const pendingStubs = pending.map(name => ({
      name,
      validated: false,
      code: '',
      role: 'unknown',
      deploymentOrder: 999 // Will be updated when contract arrives
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
    setHighlightedHTML('');
    setContractHighlightedHTML({});
    setArtifactHTML('');
    setOriginalContractHTML('');
    setActiveContractTab(0);
    setCopyStatus('idle');
    setContractCopyStatus({});
    setCurrentPhase(1);
    setRetryCount(0);
    // Clear incremental state
    setValidatedContracts([]);
    setPendingContracts([]);
    setDeploymentGuide(null);
    setTotalExpected(0);
    setAllComplete(false);
    setContractAttempts(new Map());
    setIsMultiContract(false);
  };

  // Syntax highlighting for incremental contracts
  createEffect(async () => {
    const validated = validatedContracts();
    if (validated.length > 0) {
      const contractHtmls: {[key: string]: string} = {};
      for (const contract of validated) {
        if (contract.code && contract.id) {
          const html = await codeToHtml(contract.code, {
            lang: 'javascript',
            theme: 'dark-plus'
          });
          contractHtmls[contract.id] = html;
        }
      }
      setContractHighlightedHTML(contractHtmls);
    }
  });

  // Auto-switch to first validated contract tab when results appear
  createEffect(() => {
    const validated = validatedContracts();
    const all = allContracts();

    // When we have validated contracts, ensure active tab shows a validated one
    if (validated.length > 0 && all.length > 0) {
      const currentTab = activeContractTab();
      const currentContract = all[currentTab];

      // If current tab is pending/invalid, switch to first validated contract
      if (!currentContract || !currentContract.validated) {
        const firstValidatedIndex = all.findIndex(c => c.validated);
        if (firstValidatedIndex !== -1) {
          setActiveContractTab(firstValidatedIndex);
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
          const html = await codeToHtml(contract.code, {
            lang: 'javascript',
            theme: 'dark-plus'
          });
          contractHtmls[contract.id] = html;
        }
        setContractHighlightedHTML(contractHtmls);
      } else {
        // Single contract response
        const html = await codeToHtml(r.primaryContract, {
          lang: 'javascript',
          theme: 'dark-plus'
        });
        setHighlightedHTML(html);

        if (r.artifact) {
          const artifactJson = JSON.stringify(r.artifact, null, 2);
          const artifactHtml = await codeToHtml(artifactJson, {
            lang: 'json',
            theme: 'dark-plus'
          });
          setArtifactHTML(artifactHtml);
        }
      }
    }
  });

  // Highlight original Solidity contract when results are shown
  createEffect(async () => {
    const contract = evmContract();
    const hasResults = result() || validatedContracts().length > 0;
    if (hasResults && contract) {
      const html = await codeToHtml(contract, {
        lang: 'solidity',
        theme: 'dark-plus'
      });
      setOriginalContractHTML(html);
    }
  });

  const handleConvert = async () => {
    console.log('[Jump] Starting conversion with SSE...');
    const contract = evmContract().trim();
    if (!contract) {
      console.log('[Jump] No contract provided');
      return;
    }

    console.log(`[Jump] Contract length: ${contract.length} characters`);
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
        body: JSON.stringify({ contract })
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

            console.log(`[Jump] SSE event: ${eventType}`, data);

            switch (eventType) {
              case 'phase1_start':
                setCurrentPhase(1);
                console.log('[Jump] Phase 1: Semantic analysis started');
                break;

              case 'phase1_complete':
                setCurrentPhase(2);
                console.log('[Jump] Phase 1: Complete');
                break;

              case 'phase2_start':
                setCurrentPhase(2);
                console.log('[Jump] Phase 2: Code generation started');
                break;

              case 'phase3_start':
                setCurrentPhase(3);
                console.log('[Jump] Phase 3: Validation started');
                break;

              case 'validation':
                setCurrentPhase(3);
                // Update retry tracking for Phase 3 validation display
                setRetryCount(data.attempt - 1);
                setMaxRetries(data.maxAttempts);
                // Store validation details for display
                setValidationDetails({
                  isMultiContract: data.isMultiContract || false,
                  validCount: data.validCount,
                  failedCount: data.failedCount,
                  contracts: data.contracts
                });
                // Update contract attempts and pending list
                if (data.contracts && Array.isArray(data.contracts)) {
                  const attempts = new Map(contractAttempts());
                  const pending: string[] = [];
                  data.contracts.forEach((c: any) => {
                    if (c.attempt) {
                      attempts.set(c.name, c.attempt);
                    }
                    if (!c.validated) {
                      pending.push(c.name);
                    }
                  });
                  setContractAttempts(attempts);
                  setPendingContracts(pending);
                }
                console.log('[Jump] Phase 3: Validation', data);
                break;

              case 'contract_ready':
                console.log('[Jump] Contract ready!', data);
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
                // Remove from pending list
                setPendingContracts(prev => prev.filter(name => name !== data.contract.name));
                // Transition to results view if this is the first contract
                if (validatedContracts().length === 0) {
                  setLoading(false);
                }
                break;

              case 'phase2_complete':
                console.log('[Jump] Phase 2: Complete');
                break;

              case 'phase3_complete':
                console.log('[Jump] Phase 3: Complete');
                break;

              case 'done':
                console.log('[Jump] Conversion complete!', data);
                setResult(data);
                setAllComplete(true);
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
          <h1>Jump to layer 1</h1>
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
                    Natural language
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
            <span class="output-label">
              CashScript Output
              {result() && (() => {
                const r = result()!;
                const isMulti = isMultiContractResult(r);
                if (isMulti) {
                  const count = (r as MultiContractResult).contracts.length;
                  return ` (${count} contract system)`;
                }
                return '';
              })()}
            </span>
            {loading() && validatedContracts().length === 0 && (
              <div class="loading-state">
                <div class="loading-header">
                  <div class="loading-spinner"></div>
                  <span>Converting to CashScript...</span>
                </div>
                <p class="loading-estimate">Up to 5 minutes for multi-contract systems</p>

                <details class="loading-details">
                  <summary>What's happening behind the scenes?</summary>
                  <ul>
                    <li class={currentPhase() === 1 ? 'active-phase' : currentPhase() > 1 ? 'completed-phase' : ''}>
                      Phase 1: Extracting semantic intent and business logic (~1 min for complex contracts)
                    </li>
                    <li class={currentPhase() === 2 ? 'active-phase' : currentPhase() > 2 ? 'completed-phase' : ''}>
                      Phase 2: Generating CashScript contracts (~2 min)
                    </li>
                    <li class={currentPhase() === 3 ? 'active-phase' : ''}>
                      <Show when={retryCount() === 0 && (!validationDetails() || validationDetails()?.failedCount === 0)}>
                        Phase 3: Validating each contract with the CashScript compiler. Moving to the results page as soon as there is a validated contract to show.
                      </Show>
                      <Show when={retryCount() > 0 || (validationDetails() && validationDetails()?.failedCount! > 0)}>
                        Phase 3: Refining code based on compiler feedback
                      </Show>
                      <Show when={validationDetails()?.isMultiContract && validationDetails()?.contracts && validationDetails()?.failedCount! > 0}>
                        <div class="validation-status">
                          <ul class="contract-status-list">
                            <For each={validationDetails()?.contracts}>
                              {(contract) => (
                                <li class={contract.validated ? 'contract-valid' : 'contract-failed'}>
                                  {contract.validated ? '✓' : '✗'} {contract.name}
                                  {!contract.validated && contract.attempt && (
                                    <span class="contract-attempt"> (fixing - attempt {contract.attempt})</span>
                                  )}
                                </li>
                              )}
                            </For>
                          </ul>
                        </div>
                      </Show>
                    </li>
                  </ul>
                </details>
              </div>
            )}
            {error() && <div class="error">{error()}</div>}

            {(result() || validatedContracts().length > 0) && (() => {
              // Use incremental state if available, otherwise fall back to result()
              const hasIncrementalData = validatedContracts().length > 0;
              const r = result();
              const isMulti = hasIncrementalData ? isMultiContract() : (r && isMultiContractResult(r));
              const contractsToDisplay = hasIncrementalData ? allContracts() : (isMulti && r ? sortedContracts() : []);
              const totalTabs = isMulti ? contractsToDisplay.length + 1 : 2; // +1 for "Original" tab
              const isOriginalTab = activeContractTab() === totalTabs - 1;

              return (
                <>
                  {/* Unified tabs for all results */}
                  <div class="contract-tabs">
                    {isMulti ? (
                      // Multi-contract tabs
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
                    ) : (
                      // Single contract tab
                      <button
                        class={`contract-tab ${activeContractTab() === 0 ? 'active' : ''}`}
                        onClick={() => setActiveContractTab(0)}
                      >
                        <span class="tab-name">CashScript</span>
                        <span class="tab-status valid">✓</span>
                      </button>
                    )}

                    {/* Original and Start over buttons on the right */}
                    <button
                      class={`original-btn ${isOriginalTab ? 'active' : ''}`}
                      onClick={() => setActiveContractTab(totalTabs - 1)}
                    >
                      Original
                    </button>

                    <button class="start-over-btn" onClick={handleReset}>
                      Start over
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
                          return (
                            <div class="pending-contract-state">
                              <div class="pending-spinner"></div>
                              <div class="pending-message">
                                <strong>{contract.name}</strong>
                                <p>
                                  {attemptNum && attemptNum > 1
                                    ? `Fixing contract - attempt ${attemptNum}`
                                    : 'Validating contract...'}
                                </p>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <>
                            {contract.dependencies && contract.dependencies.length > 0 && (
                              <div class="contract-dependencies">
                                <strong>Dependencies:</strong> {contract.dependencies.join(', ')}
                              </div>
                            )}

                            <div class="code-container">
                              <div class="code-block" innerHTML={contractHighlightedHTML()[contract.id] || ''} />
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
                    ) : (
                      // Show single contract content
                      <div class="code-container">
                        <div class="code-block" innerHTML={highlightedHTML()} />
                        <button
                          class={`code-copy-btn ${copyStatus() === 'copied' ? 'copied' : copyStatus() === 'error' ? 'error' : ''}`}
                          onClick={() => {
                            const code = hasIncrementalData && validatedContracts()[0]
                              ? validatedContracts()[0].code
                              : (r as SingleContractResult)?.primaryContract;
                            if (code) copyToClipboard(code);
                          }}
                          disabled={copyStatus() === 'copied'}
                          title={copyStatus() === 'copied' ? 'Copied!' : 'Copy to clipboard'}
                        >
                          {copyStatus() === 'copied' ? <Check size={20} /> : copyStatus() === 'error' ? <X size={20} /> : <Copy size={20} />}
                        </button>
                      </div>
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
