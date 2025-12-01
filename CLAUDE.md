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

## Development Commands
```bash
npm run dev       # Start dev server (port 3002)
npm run build     # Build for production
npm run server    # Run backend server
```

## Project Structure
- `src/` - Source code (frontend + backend)
- `dist/` - Build output
- `data/` - Database and data files
- `conversions.db` - SQLite database for conversions

## Notes
- Dev server runs on port 3002
- Uses tsx for TypeScript execution
