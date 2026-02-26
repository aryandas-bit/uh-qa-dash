# QA Dashboard

AI-powered Quality Assurance dashboard for Ultrahuman Support team.

## Features

- **Day-by-day agent performance** - Track QA scores and metrics per agent
- **AI-powered ticket analysis** - GPT-4 analyzes conversations against SOPs
- **Customer history** - View all tickets from a customer across time
- **Defaulters tracking** - Identify agents needing improvement
- **SOP compliance scoring** - Automatic checking against SOPs

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, React Query
- **Backend**: Node.js, Express, better-sqlite3
- **AI**: OpenAI GPT-4-turbo
- **Data**: SQLite (yellow_bot_analysis.db)

## Quick Start

### 1. Install Dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Configure Environment

Edit `backend/.env`:

```env
PORT=3001
DATABASE_PATH=../../yellow_bot_analysis.db
SOPS_PATH=../../all_sops.json
OPENAI_API_KEY=your-openai-key
METABASE_URL=https://metabase.ultrahuman.com
METABASE_API_KEY=your-metabase-key
```

### 3. Start the Application

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

### 4. Open Dashboard

Visit: http://localhost:5173

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/agents/daily?date=YYYY-MM-DD` | Agent summary for a date |
| `GET /api/agents/:email/tickets?date=` | Agent's tickets |
| `GET /api/tickets/:id` | Single ticket with messages |
| `GET /api/analysis/ticket/:id` | AI analysis for ticket |
| `POST /api/analysis/batch` | Batch analyze tickets |
| `GET /api/customers/:email/history` | Customer ticket history |
| `GET /api/agents/defaulters` | Agents with low CSAT |

## QA Scoring

| Category | Points |
|----------|--------|
| Opening Issues | -15 |
| Response Quality | -50 |
| Grammar/AI Artifacts | -20 |
| Closing Issues | -15 |
| Fatal Errors | -100 (=0) |

## Project Structure

```
qa-dashboard/
├── frontend/          # React application
│   ├── src/
│   │   ├── api/       # API client
│   │   ├── components/# UI components
│   │   ├── pages/     # Route pages
│   │   └── types/     # TypeScript types
│   └── package.json
├── backend/           # Express API server
│   ├── src/
│   │   ├── routes/    # API routes
│   │   └── services/  # Business logic
│   └── package.json
└── README.md
```

## Brand Colors

- Primary Purple: `#7c3aed`
- Accent Cyan: `#00d4ff`
- Dark Background: `#0a0a0a`
- Success: `#00ff88`
- Error: `#ff6b6b`
