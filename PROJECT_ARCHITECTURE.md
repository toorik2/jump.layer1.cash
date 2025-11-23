# Jump Layer1 Cash: Project Architecture

## System Overview
Jump Layer1 Cash is an automated smart contract converter that translates Solidity contracts into production-ready CashScript for Bitcoin Cash Layer 1. The system bridges account-based (EVM) and UTXO-based smart contract paradigms, handling both single contracts and complex multi-contract systems with automatic deployment guides.

## Core Components

### 1. User Interface (SolidJS/TypeScript)
- Real-time progress tracking with live phase updates
- Multi-contract tabbed display with syntax highlighting
- Example templates and copy-to-clipboard functionality

### 2. Backend Services (Express/Node.js)
- Three-phase conversion pipeline with intelligent retry logic
- SQLite database for session tracking and analytics
- Rate limiting and session management

### 3. AI Translation (Anthropic Claude Sonnet 4.5)
- Two-phase semantic approach: understanding first, then UTXO-aware code generation
- Structured outputs with prompt caching for cost optimization
- Up to 10 retry attempts with enhanced error feedback

### 4. Blockchain Integration (CashScript Compiler)
- Real-time contract validation with bytecode calculation
- Enhanced error messages with code context
- Multi-contract dependency management

## How It Works

### User Flow
1. **Input**: Paste Solidity contract or use example templates
2. **Processing** (2-5 minutes):
   - Phase 1: AI extracts semantic specification (what the contract does)
   - Phase 2: AI generates UTXO-based CashScript code
   - Phase 3: Validates with compiler, auto-retries up to 10 times if needed
3. **Results**: Production-ready CashScript with deployment guide and dependency information

### Technical Implementation
The system uses a three-phase pipeline that separates understanding from translation:
- **Phase 1**: Analyzes contract semantics without implementation details
- **Phase 2**: Translates to UTXO-based CashScript using semantic specification and 21 critical conversion rules
- **Phase 3**: Validates with CashScript compiler, intelligently retries failed contracts with error feedback

## Security Measures
- Rate limiting: 5 requests per 5 minutes per IP
- Request size limits and input validation
- HttpOnly cookies with CSRF protection
- API key stored in environment variables only
- Timeout protection to prevent resource exhaustion

## Getting Started

### Prerequisites
- Node.js (ES2020+), npm, and Anthropic API key

### Installation
```bash
git clone git@github.com:toorik2/jump.layer1.cash.git
cd jump.layer1.cash
npm install
cp .env.example .env
# Edit .env and add ANTHROPIC_API_KEY
```

### Running
```bash
# Development (frontend on :3002, backend on :3001)
npm run server  # Terminal 1
npm run dev     # Terminal 2

# Production
npm run build
npm run server  # Serves on :3001
```

## Future Enhancements
- Semantic specification visualization for user verification
- Natural language contract support improvements
- Enhanced analytics dashboard with error trend analysis
- Multi-language support (Vyper, Fe, other EVM languages)
- IDE plugins and CI/CD integration
