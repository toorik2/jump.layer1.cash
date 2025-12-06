# CashScript Knowledge Base

A comprehensive reference for CashScript smart contracts on Bitcoin Cash, including language fundamentals, SDK usage, CashTokens integration, and practical examples.

## 📁 Knowledge Base Structure

```
BCH_knowledge_base/
├── concepts/                 # Core UTXO concepts (NEW)
│   ├── utxo-vs-account-model.md    # EVM to CashScript translation
│   └── multi-contract-architecture.md  # Multi-contract patterns
├── language/                 # CashScript language fundamentals
│   ├── syntax/              # Basic syntax and structure
│   ├── types/               # Data types and type system
│   ├── functions/           # Built-in functions
│   ├── globals/             # Global variables and constants
│   ├── operators/           # Operators and expressions
│   └── language-reference.md  # Comprehensive reference + design principles
├── sdk/                     # JavaScript/TypeScript SDK
│   ├── compilation/         # Contract compilation
│   ├── contracts/           # Contract instantiation
│   ├── transactions/        # Transaction building
│   ├── providers/           # Network providers
│   └── testing/             # Testing frameworks
├── examples/                # Practical examples
│   ├── basic/               # Beginner examples
│   ├── intermediate/        # Intermediate examples
│   ├── advanced/            # Advanced examples
│   └── real-world/          # Production use cases
│       ├── production-patterns.md   # Battle-tested patterns
│       └── parityusd-analysis.md    # ParityUSD 26-contract analysis (NEW)
├── cashtokens/              # CashTokens integration
│   ├── nft/                 # Non-fungible tokens
│   ├── ft/                  # Fungible tokens
│   ├── minting/             # Token minting
│   └── burning/             # Token burning
├── protocol/                # Bitcoin Cash protocol
│   └── upgrades/            # Network upgrades and CHIPs
├── best-practices/          # Best practices and patterns
│   ├── security/            # Security considerations (updated)
│   ├── performance/         # Performance optimization
│   └── patterns/            # Common patterns
└── reference/               # Reference documentation
    ├── opcodes/             # Bitcoin Script opcodes
    ├── errors/              # Error codes and debugging
    └── migration/           # Version migration guides
```

## 🚀 Quick Start

1. **Language Basics**: Start with `language/syntax/` for CashScript fundamentals
2. **SDK Usage**: Check `sdk/` for JavaScript/TypeScript integration
3. **Examples**: Browse `examples/` for practical implementations
4. **CashTokens**: Explore `cashtokens/` for token functionality
5. **Best Practices**: Review `best-practices/` for production guidelines

## 📚 Key Resources

- [CashScript Official Documentation](https://cashscript.org/docs/)
- [CashScript GitHub Repository](https://github.com/CashScript/cashscript)
- [Bitcoin Cash Developer Resources](https://developer.bitcoin.com/)
- [CashTokens Specification](https://cashtokens.org/docs/spec/)

## 🔧 Tools and Environment

- **Compiler**: `cashc` - Compiles `.cash` files to artifacts
- **SDK**: `cashscript` - JavaScript/TypeScript SDK for contract interaction
- **Networks**: Mainnet, Chipnet (testnet)
- **Wallets**: Electron Cash, Paytaca, Cashonize
- **Explorers**: FullStack.cash, BitcoinCash.org

## 💡 Latest Features

- **Loop Support**: Bounded loops with OP_BEGIN/OP_UNTIL for iterative logic
- **Reusable Functions**: OP_DEFINE/OP_INVOKE for code abstraction and reuse
- **Bitwise Operations**: Native bitwise ops (OP_INVERT, shift operations)
- **P2S Support**: Pay to Script standardness for efficient contract deployment
- **Extended Token Commitments**: 128-byte commitments (BLS12-381 compatible)
- **Enhanced Bytecode Limits**: 10KB unlocking bytecode for complex contracts
- **Version**: 0.11.2 (Latest)
- **CashTokens**: Full integration support
- **TypeScript**: Enhanced type safety
- **Performance**: Optimized transaction building

## 🆕 Recent Additions (Dec 2025)

- **Multi-Contract Architecture Guide**: Production patterns from ParityUSD analysis
- **ParityUSD Case Study**: Deep analysis of 26-contract stablecoin system
- **Contract Design Principles**: "What does this contract validate?" philosophy
- **Enhanced Security Docs**: Output count limiting, 5-point covenant validation
- **Solidity Translation Guide**: Pattern mappings for EVM-to-CashScript conversion

---

*Last updated: 2025-12-01*