# Sprout — Grassroots Crowdfunding on Algorand

Sprout is a **non-custodial** crowdfunding platform on Algorand. Each campaign is
backed by its own independent smart contract — funds are held by the contract,
never by the platform. Backers are refunded automatically if a campaign doesn't
reach its goal. Creators can run **reward campaigns** (backers receive a project
token) or **contribution campaigns** (no token distribution).

The founding thesis: Algorand has many capable builders with working projects but
no clean, honest path to community funding. Sprout is built to close that gap —
flat, transparent fees, no platform token, no cut of project tokens, and a
deliberate "backer, not investor" framing.

---

## Architecture

```
Algorand-Crowdfund/
├── contracts/              # PyTeal smart contract (source of truth for funds)
│   ├── crowdfund.py        # Approval + clear programs
│   ├── compile.py          # Compiles crowdfund.py -> approval.teal / clear.teal
│   └── requirements.txt
├── frontend/               # React + Vite (deployed on Vercel)
│   └── src/
│       ├── components/     # Layout, ConnectWallet, ProjectCard, UI, ...
│       ├── pages/          # Home, ProjectDetail, CreateProject, MyProjects, ...
│       ├── utils/          # algorand.js, transactions.js, api.js
│       └── context/        # ToastContext
└── backend/                # Node + Express API (deployed on Render)
    └── src/
        ├── routes/         # projects, health
        ├── services/       # projects (DB writes), sync (on-chain reconciliation)
        ├── middleware/     # auth (wallet-signature verification)
        ├── jobs/           # syncJob (scheduled chain->DB sync)
        └── utils/          # supabase, algorand, migrate
```

**Data model.** The smart contract holds authoritative on-chain state (goal,
raised, deadline, exchange rate, ASA). **Supabase (Postgres)** caches campaign
metadata and lifecycle flags for fast querying; the `sync` service reconciles the
cache against on-chain state. The frontend reads a mix of live chain state
(`gs.*`) and cached metadata (`meta.*`).

---

## Exchange rate (two-integer ratio)

Reward campaigns price tokens with **two whole integers**, not a single rate:

- `tpb` — tokens_per_bundle (whole tokens)
- `apb` — algo_per_bundle (whole ALGO)

Read as "**tpb tokens per apb ALGO**" (e.g. `1 token per 10 ALGO`). Payout floors
to whole tokens:

```
whole_tokens = floor( contribution_microALGO * tpb / (apb * 1,000,000) )
tokens_due   = whole_tokens * 10^ASA_decimals
```

So a contribution below the ratio rounds down (9 ALGO at 1-per-10 -> 0 tokens;
15 ALGO -> 1 token). `tpb == 0` signals a **contribution campaign** (no tokens). `apb`
is always >= 1 (it's a divisor). ASA decimals are read **on-chain** at setup and
stored as `dec_factor`; a setup-time overflow guard rejects token/rate/goal
combinations that would exceed uint64.

Rug-capable tokens are rejected at setup: an ASA with a **clawback** address,
**freeze** address, or **default-frozen** enabled cannot be used for a campaign.

---

## Smart contract flow

### Create (creator)
`CreateProject` sends an `ApplicationCreate` + listing-fee payment group. Args:
admin address, goal (microAlgos), `tpb`, days, `apb`. The listing fee
(`goal * days / 100,000`, min 10 ALGO) is paid to the admin at creation.

### Setup (creator)
`MyProjects` -> "Set up contract" sends a 2-transaction group:
- `[0]` AppCall `"setup"` (reads ASA decimals on-chain, enforces the overflow
  guard and clawback/freeze rejection, inner opt-in to the ASA)
- `[1]` ASA transfer of the token pool into the app
  (`floor(goal * tpb / apb) * 10^decimals` base units)

Contribution campaigns (`tpb == 0`) skip setup entirely.

### Contribute (backer)
Opt in to the app, then send a 2-transaction group: AppCall `"contribute"` +
a whole-ALGO payment (contributions must be a positive whole number of ALGO).

### Close out
- **Success** (raised >= goal): backers call `"finalize"` to receive their whole-
  token allocation; the creator claims the raised ALGO minus the 4% success fee.
- **Failure** (deadline passed, goal not met): backers call `"refund"` to reclaim
  their ALGO in full. If the creator has reclaimed the token pool, `asa_id`
  resets to 0 while the campaign remains in a failed (refundable) state.

---

## Fees

- **Listing fee**: `goal * days / 100,000` (minimum 10 ALGO), paid at creation,
  non-refundable.
- **Success fee**: 4%, deducted from the creator's payout only if the campaign
  funds. No fee on failed campaigns.
- No platform token, no cut of project tokens.

---

## Global state keys

| Key               | Type  | Description                                   |
|-------------------|-------|-----------------------------------------------|
| `goal`            | uint  | Funding goal (microAlgos, whole ALGO)         |
| `tpb`             | uint  | tokens_per_bundle (0 = donation campaign)     |
| `apb`             | uint  | algo_per_bundle (always >= 1)                 |
| `dec_factor`      | uint  | 10^ASA_decimals (set at setup, read on-chain) |
| `deadline`        | uint  | Deadline round                                |
| `days`            | uint  | Campaign duration in days                     |
| `asa_id`          | uint  | Project token ASA (0 until setup)             |
| `raised`          | uint  | Total raised (microAlgos)                     |
| `funded_round`    | uint  | Round the goal was first reached (0 if never) |
| `cancelled`       | uint  | Cancellation flag                             |
| `creator_claimed` | uint  | Creator payout claimed flag                   |
| `admin_claimed`   | uint  | Admin fee claimed flag                        |
| `creator`         | bytes | Creator address                               |
| `admin`           | bytes | Admin / fee-collection address                |

### Local state (per backer)

| Key       | Type | Description             |
|-----------|------|-------------------------|
| `contrib` | uint | Contributed microAlgos  |

---

## Quickstart (local / Codespaces)

### 1. Compile the contract
```bash
cd contracts
pip install -r requirements.txt   # or: pip install pyteal --break-system-packages
python compile.py                 # writes approval.teal and clear.teal
```

### 2. Backend
```bash
cd backend
npm install
# set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALGOD_SERVER, INDEXER_SERVER,
# ADMIN_ADDRESS in the environment (.env locally)
node src/utils/migrate.js         # applies the Supabase schema/migrations
npm run dev
```

### 3. Frontend
```bash
cd frontend
npm install
# set VITE_ALGOD_SERVER, VITE_INDEXER_SERVER, VITE_ADMIN_ADDRESS,
# VITE_WALLETCONNECT_PROJECT_ID, and (optional) VITE_NETWORK in the environment
npm run dev
```

Open `http://localhost:5173`. Connect with **Pera** or **Defly**.

---

## Contract integration

The frontend deploys the **real** contract — it imports the compiled
`contracts/approval.teal` and `contracts/clear.teal` directly (as raw text, see
`CreateProject.jsx`) and deploys them per campaign. There is no stub.

To change the contract: edit `crowdfund.py` -> run `python contracts/compile.py`
-> **rebuild and redeploy the frontend** (the TEAL is bundled at build time, so a
recompile alone doesn't change what deploys).

> **Mainnet note:** verify the timing constants `ROUNDS_PER_DAY` (30857) and
> `GRACE_PERIOD_ROUNDS` (5580866) hold their mainnet values before compiling a
> production build. Testnet values will make campaign deadlines meaningless.

---

## Environment variables

**Frontend** (`VITE_` vars are baked in at build time — a redeploy is required
to change them):

| Variable                        | Description                                    |
|---------------------------------|------------------------------------------------|
| `VITE_ALGOD_SERVER`             | Algod API URL (mainnet in production)          |
| `VITE_INDEXER_SERVER`           | Indexer API URL                                |
| `VITE_ALGOD_PORT` / `_TOKEN`    | Blank for AlgoNode                             |
| `VITE_ADMIN_ADDRESS`            | Platform admin / fee-collection address        |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project ID                 |
| `VITE_NETWORK`                  | `testnet` to override; defaults to mainnet     |

**Backend:**

| Variable                     | Description                          |
|------------------------------|--------------------------------------|
| `SUPABASE_URL`               | Supabase project URL                 |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase service-role key            |
| `ALGOD_SERVER`               | Algod API URL                        |
| `INDEXER_SERVER`             | Indexer API URL                      |
| `ADMIN_ADDRESS`              | Must match the frontend admin address|

---

## Tech stack

- **Smart contract**: PyTeal on the Algorand AVM
- **Frontend**: React 18 + Vite (Vercel)
- **Backend**: Node + Express (Render)
- **Database**: Supabase (Postgres)
- **Wallets**: Pera, Defly via `@txnlab/use-wallet`
- **Algorand SDK**: algosdk v3
- **Explorer links**: Lora (AlgoKit)

---

## Notes

- `finalize` (claim tokens on success) and `refund` (reclaim ALGO on failure)
  are **self-service, one backer per call**: each backer calls the operation for
  their own address (`Txn.sender()`) from the project page. There is no admin
  batch step — backers pull their own tokens/refunds.
- Backend auth uses a signed 0-ALGO self-transaction (a challenge in the note
  field) to prove address ownership — works across all wallets and avoids
  `signBytes`. Signatures are resource-bound.
- Terminology is deliberately "backer," not "investor"; tokens are utility /
  early-access, not equity. This framing is intentional and load-bearing.
