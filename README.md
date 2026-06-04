# AlgoLaunch — Algorand Crowdfunding Platform

A full-stack permissionless crowdfunding platform on Algorand. Developers post pitch decks and set funding parameters; investors contribute ALGO and receive project tokens on successful funding.

---

## Architecture

```
algorand-crowdfund/
├── contracts/          # PyTeal smart contract
│   ├── crowdfund.py    # Approval + clear programs
│   ├── compile.py      # Compile script → approval.teal / clear.teal
│   └── requirements.txt
└── frontend/           # React + Vite frontend
    ├── src/
    │   ├── components/ # Layout, ConnectWallet, ProjectCard, Account
    │   ├── pages/      # Home, ProjectDetail, CreateProject, MyProjects
    │   ├── utils/      # algorand.js, transactions.js, projectStore.js
    │   └── context/    # ToastContext
    ├── .env.example
    └── package.json
```

---

## Quickstart (GitHub Codespaces / Local)

### 1. Compile the Smart Contract

```bash
cd contracts
pip install -r requirements.txt
python compile.py
# Produces approval.teal and clear.teal
```

### 2. Set Up the Frontend

```bash
cd frontend
cp .env.example .env
# Edit .env and set VITE_ADMIN_ADDRESS to your Algorand wallet address
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### 3. Connect a Wallet

Use [Pera Wallet](https://perawallet.io/) or [Defly](https://defly.app/) on **Algorand Testnet**. Get free testnet ALGO from the [Algorand Testnet Dispenser](https://bank.testnet.algorand.network/).

---

## Contract Integration

The frontend uses **stub TEAL** by default (deploys a trivial valid contract). To use the real crowdfund contract:

1. Compile `contracts/crowdfund.py` to TEAL:
   ```bash
   python contracts/compile.py
   ```
2. Open `frontend/src/pages/CreateProject.jsx`
3. Replace the `APPROVAL_TEAL_SOURCE` and `CLEAR_TEAL_SOURCE` constants with the compiled TEAL (copy the file content).

---

## Smart Contract Flow

### Creating a Project (Developer)

1. **Deploy**: `CreateProject` page → sends `ApplicationCreate` transaction with goal, rate, deadline, admin address as args.
2. **Setup**: `MyProjects` page → sends a group of 3 transactions:
   - `[0]` AppCall `"setup"` with foreign ASA
   - `[1]` Payment of 2% of goal (deposit)
   - `[2]` ASA Transfer of `goal × rate / 1,000,000` tokens to the app

### Investing (Investor)

1. **Opt In**: Investor calls OptIn to the app to initialize local state.
2. **Contribute**: Sends a group of 2 transactions:
   - `[0]` AppCall `"contribute"`
   - `[1]` Payment of desired ALGO amount

### Closing Out

- **Success** (raised ≥ goal, before deadline): Call `"finalize"` with a list of investor accounts. They each receive tokens proportional to their contribution. When all contributions are processed, remaining tokens close to creator and ALGO balance closes to creator (minus 2% admin fee).
- **Failure** (after deadline, raised < goal): Call `"refund"` with a list of investor accounts. They each receive their ALGO back. Deposit is split 50/50 between admin and creator.

---

## Global State Keys

| Key       | Type  | Description                    |
|-----------|-------|-------------------------------|
| `goal`    | uint  | Funding goal in microAlgos    |
| `rate`    | uint  | Token units per 1 ALGO        |
| `deadline`| uint  | Deadline round number          |
| `asa_id`  | uint  | ASA ID (set in setup)         |
| `raised`  | uint  | Total raised microAlgos       |
| `deposit` | uint  | Creator deposit microAlgos    |
| `creator` | bytes | Creator address               |
| `admin`   | bytes | Admin address                 |

## Local State Keys (per investor)

| Key      | Type | Description              |
|----------|------|--------------------------|
| `contrib`| uint | Contributed microAlgos   |

---

## Tech Stack

- **Smart Contract**: [PyTeal](https://pyteal.readthedocs.io/) on Algorand AVM
- **Frontend**: React 18 + Vite 5
- **Wallet**: [@txnlab/use-wallet-react](https://github.com/TxnLab/use-wallet) (Pera, Defly, KMD)
- **Algorand SDK**: [algosdk](https://github.com/algorand/js-algorand-sdk) v3
- **Network**: Algorand Testnet (configurable via `.env`)

---

## Environment Variables

Copy `frontend/.env.example` to `frontend/.env`:

| Variable             | Description                              |
|----------------------|------------------------------------------|
| `VITE_ALGOD_SERVER`  | Algod API URL (default: AlgoNode testnet)|
| `VITE_ALGOD_PORT`    | Algod port (leave blank for AlgoNode)   |
| `VITE_ALGOD_TOKEN`   | Algod token (leave blank for AlgoNode)  |
| `VITE_INDEXER_SERVER`| Indexer API URL                          |
| `VITE_ADMIN_ADDRESS` | Your platform admin Algorand address     |

---

## Notes

- Project metadata (name, tagline, description, image URL, deck URL) is stored in **localStorage** for this demo. In production, use a backend API or IPFS.
- The `finalize` and `refund` operations process accounts in batches (Algorand limits accounts per transaction). Call them multiple times to process all investors.
- Inner transaction fees are covered by the caller — the app call fee is set proportionally to the number of accounts processed.
