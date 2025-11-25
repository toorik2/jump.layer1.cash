# jump.layer1.cash - EVM to CashScript Converter

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
