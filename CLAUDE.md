# jump.layer1.cash - EVM to CashScript Converter

## Prime Directives (ALWAYS APPLY)

1. **No placeholders.** Write real, production-ready code only.
2. **Single path.** One solution, no alternate approaches in the same code.
3. **Fail loud.** No fallbacks. Errors must be visible and immediate.
4. **Simplify ruthlessly.** Cut everything that isn't essential.
5. **No code is the best code.** Delete before adding. Question every line.

---

## Project Overview
Web application that converts EVM smart contracts to CashScript.

## Tech Stack
- **Frontend**: SolidJS + TypeScript + Vite
- **Backend**: Express + TypeScript
- **AI**: Anthropic Claude SDK
- **Database**: better-sqlite3
- **Compiler**: CashC (CashScript compiler)

## Project Structure
- `src/client/` - Frontend (SolidJS)
- `src/server/` - Backend (Express)
- `BCH_knowledge_base/` - CashScript reference docs

## Development
6. **Use production server only.** Run `npm run server` (port 3001). Never use `npm run dev` (port 3002).
