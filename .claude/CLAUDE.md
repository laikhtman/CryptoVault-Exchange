# CryptoVault-Exchange — Project Context for Claude

## What This Project Is

A 100% client-side React + Vite + TypeScript tool for Trezor hardware wallet owners.
It connects to a Trezor device, imports the account-level XPUB, derives up to 500+
Ethereum wallet addresses (identical to Trezor Suite's derivation), and scans them all
via Etherscan to show ETH, USDT, and USDC balances — with aggregate totals on the dashboard.

**Primary use case:** A user has a Trezor wallet with 300+ generated addresses. Rather
than adding them one-by-one in Trezor Suite, they use this app to scan all of them at once.

## Architecture at a Glance

```
Browser (Vite + React)
├── AdminPanel     — Trezor Connect, xpub input, seed helper
├── WalletsView    — Wallet generation + Etherscan scan (ETH/USDT/USDC)
├── ClientDashboard — Aggregate totals from scanned wallets
├── DepositModal   — QR code deposit address generator (legacy)
│
├── crypto.ts      — HD wallet derivation (BIP32/BIP44/BIP84)
│   ├── deriveUsdtAddress(xpub, index)  — ETH, m/44'/60'/0'/0/index
│   └── deriveBtcAddress(xpub, index)   — BTC P2WPKH, m/84'/0'/0'/0/index
│
├── models.ts      — TypeScript interfaces (AppConfig, GeneratedWallet, etc.)
└── localStorage   — All persistence (no backend, no cookies)
    ├── cryptovault_config_v1        — {ethMasterXpub, btcMasterXpub, trezorConnected}
    └── cryptovault_generated_wallets_v1  — GeneratedWallet[]
```

## Key Technical Facts

**Derivation paths (must not change without explicit review):**
- ETH/USDT/USDC: `m/44'/60'/0'/0/index` — account xpub at `m/44'/60'/0'`, derive `0/index`
- BTC native segwit: `m/84'/0'/0'/0/index` — account xpub at `m/84'/0'/0'`, derive `0/index`

**Token contracts (Ethereum mainnet):**
- USDT: `0xdAC17F958D2ee523a2206206994597C13D831ec7` (6 decimals)
- USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (6 decimals)

**Etherscan free tier:** 5 req/sec. Current sync uses 450ms delay for 2 concurrent token
calls per wallet = ~4.4 calls/sec.

**Trezor Connect:** `@trezor/connect-web` v9.7.2. Init once per session (module-level flag).
Opens a popup to `connect.trezor.io`. Works with Trezor Bridge (port 21325) or WebUSB.

**BTC address derivation:** Uses `@scure/btc-signer`'s `p2wpkh(compressedPubKey)`.
Compressed pubkey extracted via `ethers.SigningKey.computePublicKey(node.publicKey, true)`.

## Available Agents

| Agent | When to Use |
|-------|-------------|
| `blockchain-expert` | Any change to crypto.ts, derivation paths, key handling, token amounts |
| `trezor-expert` | AdminPanel Trezor connect flow, xpub format, path verification |
| `product-manager` | New features, prioritization, acceptance criteria, user flow design |
| `frontend-blockchain` | React components, UI, Tailwind, wallet display patterns |
| `backend-blockchain` | Etherscan API, rate limiting, localStorage schema, new data sources |
| `qa` | Test plans, regression testing, verifying address correctness |
| `documentation` | README, .env.example, code comments, UI text |

## Multi-Agent Workflow

### For a new feature:
1. `product-manager` → define acceptance criteria + task breakdown
2. `frontend-blockchain` + `backend-blockchain` (parallel) → implement UI + data layer
3. `blockchain-expert` → review any crypto/derivation changes
4. `trezor-expert` → review if hardware wallet integration is touched
5. `qa` → test plan + regression checklist
6. `documentation` → update README, comments, env docs

### For a bug fix:
1. `qa` → reproduce + define expected behavior
2. The relevant specialist agent (blockchain-expert / trezor-expert / frontend / backend) → fix
3. `qa` → verify fix
4. `documentation` → update if user-facing behavior changed

### For a security review:
1. `blockchain-expert` → key handling, derivation correctness, API safety
2. `trezor-expert` → hardware wallet flow, xpub exposure

## Do Not

- Store private keys, seed phrases, or mnemonic words in localStorage or any persistent state
- Hardcode API keys (use `import.meta.env.VITE_*` only)
- Change the derivation path without running through `blockchain-expert` AND `trezor-expert`
- Add a backend server — this is intentionally client-side only
- Use `any` type in TypeScript unless wrapping an untyped external library
- Make network calls inside React render (only in event handlers or effects)

## Environment Setup

```bash
npm install
cp .env.example .env.local
# Edit .env.local: set VITE_ETHERSCAN_API_KEY=your_key
npm run dev  # runs on http://localhost:3000
```

Get an Etherscan API key at: https://etherscan.io/myapikey (free tier is sufficient)
