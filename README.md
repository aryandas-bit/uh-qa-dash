# Ultrahuman QA Dashboard

A full-stack QA analytics dashboard for reviewing customer support conversations, tracking agent performance, and running AI-assisted ticket audits against internal SOPs.

## Overview

This repository contains two applications:

- `frontend/`: a React + Vite dashboard for browsing QA insights, agent performance, customer history, and ticket-level analysis
- `backend/`: an Express + TypeScript API that reads support data, exposes reporting endpoints, and runs LLM-based QA scoring

The project is designed for internal support-quality workflows where reviewers need both operational metrics and deeper ticket-by-ticket audit context.

## Key Capabilities

- Daily QA visibility for support agents
- Ticket-level AI analysis with structured deductions
- SOP compliance scoring and audit summaries
- Customer history lookup across prior conversations
- Defaulter tracking for low-quality or high-risk patterns
- Dashboard views for trends, summaries, and agent drill-downs

## Tech Stack

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS
- TanStack Query
- React Router
- Recharts

### Backend

- Node.js
- Express
- TypeScript
- better-sqlite3

### AI / Data

- OpenAI SDK
- Anthropic SDK
- Local SQLite data source
- SOP JSON inputs for policy-aware analysis

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
│   ├── public/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── types/
│   │   └── utils/
│   ├── package.json
│   └── vite.config.ts
├── vercel.json
└── README.md
```

## Local Development

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure backend environment

Create `backend/.env` with the required values:

```env
PORT=3001
DATABASE_PATH=../../yellow_bot_analysis.db
SOPS_PATH=../../all_sops.json
OPENAI_API_KEY=your_openai_key
METABASE_URL=https://metabase.ultrahuman.com
METABASE_API_KEY=your_metabase_api_key
```

If your deployment uses Anthropic or Gemini-backed analysis in service code, add the matching provider keys as needed for your environment.

### 3. Start the backend

```bash
cd backend
npm run dev
```

The API will be available at `http://localhost:3001`.

### 4. Start the frontend

```bash
cd frontend
npm run dev
```

The dashboard will be available at `http://localhost:5173`.

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

## API Surface

The backend exposes a small REST API used by the dashboard:

- `GET /api/health`: service health check
- `GET /api/agents/daily`: daily agent metrics
- `GET /api/agents/:email/tickets`: ticket list for an agent
- `GET /api/agents/defaulters`: low-performing or flagged agents
- `GET /api/tickets/:id`: ticket details and conversation data
- `GET /api/analysis/ticket/:id`: AI QA analysis for a ticket
- `POST /api/analysis/batch`: batch analysis workflow
- `GET /api/customers/:email/history`: customer conversation history

## QA Scoring Model

The audit flow uses structured deductions across common support-review categories:

- `opening`
- `process`
- `chat_handling`
- `closing`
- `fatal`

The implementation is tuned for support QA reviews and SOP-backed scoring rather than generic sentiment analysis.

## Deployment

The repository includes a root [`vercel.json`](/Users/aryan/Desktop/qa-dashboard/vercel.json) that builds the Vite frontend from `frontend/` and serves the generated static output.

For Vercel:

1. Import the GitHub repository.
2. Keep the project root at the repository root.
3. Redeploy after each push to `main`.

If you deploy the backend separately, configure its environment variables on the target host before starting the Node service.

## Notes

- This project expects local data files and internal service credentials that are not committed to the repository.
- The frontend and backend are intentionally decoupled so the dashboard can be deployed separately from the API.
- Production readiness depends on valid data sources, API keys, and environment configuration.

## License

This repository is private/internal unless you explicitly add a license file and publish it under that license.
