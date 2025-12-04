# Jump - EVM to CashScript Converter

Convert EVM smart contracts to [CashScript](https://cashscript.org) for Bitcoin Cash.

**Live at [jump.layer1.cash](https://jump.layer1.cash)**

## What it does

Paste a Solidity contract, get working CashScript. The converter:
- Extracts business logic from EVM contracts
- Redesigns for UTXO architecture
- Generates validated CashScript code

## Tech Stack

- **Frontend**: SolidJS + TypeScript + Vite
- **Backend**: Express + TypeScript
- **AI**: Claude (Anthropic)
- **Validation**: CashC compiler

## Run locally

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env

npm install
npm run dev
```

## Links

- [CashScript Docs](https://cashscript.org)
- [Community (Telegram)](https://t.me/CashScript_Arena)
- [Feedback](https://forms.gle/tQVieRgHnmx3XGs89)

## License

MIT
