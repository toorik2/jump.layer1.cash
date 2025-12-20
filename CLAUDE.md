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
6. **Use production server only.** Run on port 3001. Never use `npm run dev` (port 3002).
7. **Server commands.** Kill the old server first, then start the new one as a background process:
   ```bash
   # Step 1: Kill existing server (run normally)
   fuser -k 3001/tcp 2>/dev/null; sleep 1

   # Step 2: Start server (MUST use run_in_background: true)
   npm run server
   ```

## Background Process Rules (CRITICAL)
8. **Use `run_in_background: true` for long-running processes.** Do NOT use shell `&` syntax - it doesn't work with the Bash tool. Instead, set the `run_in_background` parameter to `true` in the Bash tool call.
9. **Commands that MUST use `run_in_background: true`:**
   - `npm run server` - production server
   - `npm run dev` - dev server (if ever used)
   - Any command with: `server`, `dev`, `watch`, `serve`, `start`
   - Any process expected to run indefinitely
10. **Two-step pattern for server restart:**
    - First call: `fuser -k 3001/tcp 2>/dev/null; sleep 1` (normal execution, wait for completion)
    - Second call: `npm run server` with `run_in_background: true` (returns immediately)
11. **Monitor background tasks:** Use `TaskOutput` tool with the returned task ID to check output. Use `/tasks` command to list all running tasks.
