# AlgoLaunch Backend

REST API for the AlgoLaunch crowdfunding platform. Stores project metadata and
lifecycle status in Supabase (PostgreSQL). All financial operations (contributions,
finalization, refunds) remain on the Algorand blockchain — this backend is
purely the metadata and status layer.

## Stack

- **Runtime:** Node.js 20+
- **Framework:** Express 4
- **Database:** Supabase (PostgreSQL)
- **Auth:** Ed25519 wallet signature verification
- **Deployment:** Render / Railway / any Node host

---

## Quick Start

### 1. Create a Supabase project

1. Go to https://app.supabase.com and create a new project
2. Note your **Project URL** and **service_role key** from Settings → API
3. Open the **SQL Editor** and paste + run the SQL from `src/utils/migrate.js`
   (or run `node src/utils/migrate.js` to print it)

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_ADDRESS=your-algorand-admin-address
ALLOWED_ORIGINS=http://localhost:5173,https://your-frontend.vercel.app
```

### 3. Install and run

```bash
npm install
npm run dev       # development (nodemon)
npm start         # production
```

### 4. Verify

```
GET http://localhost:3001/api/health
```

Should return `{ "status": "healthy" }`.

---

## API Reference

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check — DB + algod status |
| GET | `/api/projects` | All public projects (Explore page) |
| GET | `/api/projects/:appId` | Single project metadata |
| GET | `/api/projects/by-creator/:address` | Projects by creator (My Projects) |

### Creator (requires wallet signature)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects` | Register a newly deployed project |
| PATCH | `/api/projects/:appId/status` | Update lifecycle flags |

### Admin (requires admin wallet signature)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/admin/all` | All projects including hidden |
| PATCH | `/api/projects/:appId/visibility` | Hide/unhide from Explore |
| DELETE | `/api/projects/:appId` | Permanently purge from DB |

---

## Authentication

Write endpoints require the caller to prove they control an Algorand address
by signing a short challenge message with their wallet.

### How it works

The frontend (`src/utils/api.js`) handles this automatically:

```js
const { message, headers } = buildAuthMessage(address, context)
const sig = await signBytes(new TextEncoder().encode(message))
const signature = sigToBase64(sig)
```

The backend verifies the Ed25519 signature against the public key derived
from the Algorand address using the standard Algorand message prefix (`MX`).

### Creator endpoints

Send these headers:
```
x-algo-address: ALGO_ADDRESS
x-algo-message: AlgoLaunch:context:timestamp
```
And include `signature` and `message` in the request body.

### Admin endpoints

Same headers, plus:
```
Authorization: Bearer BASE64_SIGNATURE
```

---

## Database Schema

```sql
projects (
  app_id          bigint PRIMARY KEY,   -- Algorand app ID
  creator_address text NOT NULL,

  -- Metadata
  name            text,
  tagline         text,
  description     text,
  category        text,
  website_url     text,
  deck_url        text,
  image_url       text,
  token_name      text,

  -- Economics (survives contract deletion)
  goal_micro      bigint,   -- funding goal in microALGO
  rate_per_algo   bigint,   -- token base units per 1 ALGO

  -- Lifecycle flags
  is_funded       boolean DEFAULT false,
  is_distributed  boolean DEFAULT false,
  is_refunded     boolean DEFAULT false,
  is_cancelled    boolean DEFAULT false,
  is_hidden       boolean DEFAULT false,

  created_at      timestamptz,
  updated_at      timestamptz
)
```

---

## Deployment (Render)

1. Push this directory to a GitHub repository
2. Create a new **Web Service** on https://render.com
3. Set **Build Command:** `npm install`
4. Set **Start Command:** `npm start`
5. Add all environment variables from `.env.example`
6. Set **Node Version** to 20 in the environment

Update `ALLOWED_ORIGINS` to include your Vercel frontend URL.
Update `VITE_API_URL` in the frontend `.env` to your Render service URL.

---

## Deployment (Frontend — Vercel)

1. Push the `frontend/` directory to GitHub
2. Import into https://vercel.com
3. Add environment variables matching `frontend/.env`
4. Set `VITE_API_URL` to your deployed backend URL

---

## Migrating from localStorage

All project metadata previously stored in the browser's localStorage under
`algolaunch_projects` is now stored in Supabase. Existing projects created
before the backend was introduced will not appear until they are re-registered.

To migrate existing projects: the creator must visit the Create Project flow
again for each project and re-submit. Alternatively, you can manually insert
rows into the `projects` table in the Supabase dashboard for any existing
app IDs.
