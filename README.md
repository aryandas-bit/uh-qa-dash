# Ultrahuman QA Dashboard

Internal QA dashboard for support-ticket review, agent performance tracking, and AI-assisted conversation audits.

## Overview

This repository contains two apps:

- `frontend/`: React + Vite dashboard for daily QA operations
- `backend/`: Express + TypeScript API for analytics, ticket drill-downs, and review workflows

The system combines operational reporting from local SQLite data with LLM-backed ticket analysis and a QC review workflow that can sync reviewer decisions to Google Sheets.

## Current Capabilities

- Dashboard view for daily agent QA metrics
- Agent drill-down pages with ticket-level performance
- Ticket detail pages with AI-generated QA scoring
- Customer history lookup across prior tickets
- Defaulter tracking for risky or low-quality patterns
- QC review queue and review history
- Google Sheets sync for QC review records

## Stack

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS
- TanStack Query
- React Router
- Recharts
- Zustand

### Backend

- Node.js
- Express
- TypeScript
- better-sqlite3
- Google Sheets API (`googleapis`)

### AI / Data

- OpenAI SDK
- Anthropic SDK
- Local SQLite databases
- SOP JSON inputs for policy-aware scoring

## Repository Structure

```text
qa-dashboard/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   └── services/
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   └── pages/
│   ├── package.json
│   └── vite.config.ts
├── vercel.json
└── README.md
```

## Frontend Routes

- `/`: dashboard
- `/agent/:email`: agent detail view
- `/ticket/:id`: ticket analysis view
- `/customer/:email`: customer history
- `/defaulters`: defaulters list
- `/qc-reviews`: QC review workflow

## Backend API

The backend exposes these main routes:

- `GET /api/health`
- `GET /api/agents/daily`
- `GET /api/agents/:email/tickets`
- `GET /api/agents/defaulters`
- `GET /api/tickets/:id`
- `GET /api/customers/:email/history`
- `GET /api/analysis/ticket/:id`
- `POST /api/analysis/batch`

Additional QC review endpoints live under the analysis route layer and support saving/retrieving review outcomes used by the frontend QC reviews page.

## Local Development

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Start the backend

```bash
cd backend
npm run dev
```

The API runs at `http://localhost:3001`.

Backend configuration notes:

- If `TURSO_DB_URL` is set, the API uses that LibSQL/Turso database.
- If `TURSO_DB_URL` is **not** set, the API falls back to a local dev database at `backend/dev.db` (it will be empty unless you load data into it).
- `OPENAI_API_KEY` is only required for AI analysis endpoints (ticket scoring); the rest of the API can run without it.

### 3. Start the frontend

```bash
cd frontend
npm run dev
```

The dashboard runs at `http://localhost:5173`.

## Build Commands

### Frontend

```bash
cd frontend
npm run build
```

### Backend

```bash
cd backend
npm run build
```

## Data Model Notes

- Primary ticket and agent analytics come from the main SQLite database referenced by `DATABASE_PATH`.
- QC review decisions are stored separately via `REVIEWS_DB_PATH`.
- SOP definitions are loaded from the JSON file referenced by `SOPS_PATH`.
- Google Sheets sync writes QC review rows to the `QC Reviews` sheet tab.

## Deployment

The repository includes [`vercel.json`](/Users/aryan/Desktop/qa-dashboard/vercel.json) for deploying the frontend from the repo root.

If you deploy on Vercel:

1. Import the GitHub repository.
2. Keep the project root at the repository root.
3. Configure the frontend build as defined in `vercel.json`.
4. Deploy the backend separately if you need API access in production.

The backend requires its own runtime, environment variables, and access to the database / SOP files.

## Notes

- This is an internal project and depends on local or private data sources that are not committed.
- `backend/.env`, service-account JSON files, and database assets should stay out of version control.
- Production behavior depends on valid data paths, provider keys, and Google API credentials.

## License

This repository is private/internal unless a license file is added explicitly.
