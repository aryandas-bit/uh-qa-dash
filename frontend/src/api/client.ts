import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// Request interceptor for logging
api.interceptors.request.use((config) => {
  console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('[API Error]', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Date mode type - matches Yellow.ai vs Activity date counting
export type DateMode = 'activity' | 'initialized';

// API functions
export const agentsApi = {
  getDates: () => api.get('/agents/dates'),
  getDaily: (date: string, dateMode: DateMode = 'activity') =>
    api.get(`/agents/daily?date=${date}&dateMode=${dateMode}`),
  getTickets: (email: string, date: string, limit = 100, dateMode: DateMode = 'activity') =>
    api.get(`/agents/${encodeURIComponent(email)}/tickets?date=${date}&limit=${limit}&dateMode=${dateMode}`),
  getPerformance: (email: string, startDate: string, endDate: string) =>
    api.get(`/agents/${encodeURIComponent(email)}/performance?startDate=${startDate}&endDate=${endDate}`),
  getDefaulters: (minIssues = 5, days = 30) =>
    api.get(`/agents/defaulters?minIssues=${minIssues}&days=${days}`),
  getQATrend: (email: string, limit = 14) =>
    api.get(`/agents/${encodeURIComponent(email)}/qa-trend?limit=${limit}`),
  getQATrends: (emails: string[], limit = 14) =>
    api.get(`/agents/qa-trends?${new URLSearchParams({
      emails: emails.join(','),
      limit: String(limit),
    }).toString()}`),
  getReportCard: (email: string, date: string, dateMode: DateMode = 'activity') =>
    api.get(`/agents/${encodeURIComponent(email)}/report-card?date=${date}&dateMode=${dateMode}`, { timeout: 120000 }),
  auditNow: (email: string, date: string, dateMode: DateMode = 'activity', count = 10) =>
    api.post('/agents/audit-now', { email, date, dateMode, count }, { timeout: 300000 }),
  getAuditSummary: (date: string, dateMode: DateMode = 'activity') =>
    api.get(`/agents/audit-summary?date=${date}&dateMode=${dateMode}`),
};

export const ticketsApi = {
  getSummary: (date: string) => api.get(`/tickets/summary?date=${date}`),
  getInsights: (date: string, dateMode: DateMode = 'activity') =>
    api.get(`/tickets/insights?date=${date}&dateMode=${dateMode}`),
  getFlagged: (date: string, limit = 50) => api.get(`/tickets/flagged?date=${date}&limit=${limit}`),
  getById: (id: string) => api.get(`/tickets/${id}`),
};

export const analysisApi = {
  getSOPs: () => api.get('/analysis/sops'),
  getLLMStatus: () => api.get('/analysis/llm-status'),
  getTicketAnalysis: (id: string, refresh = false, cacheOnly = false) =>
    api.get(`/analysis/ticket/${id}?refresh=${refresh}&cacheOnly=${cacheOnly}`, { timeout: 120000 }),
  batchAnalyze: (date: string, agentEmail?: string, limit = 20, dateMode: DateMode = 'activity', ticketIds?: string[], forceRefresh = false) =>
    api.post('/analysis/batch', { date, agentEmail, limit, prioritizeFlagged: true, dateMode, ticketIds, forceRefresh }, { timeout: 120000 }),
  getAgentSummary: (email: string, date: string) =>
    api.get(`/analysis/agent/${encodeURIComponent(email)}/summary?date=${date}`),
  reviewTicket: (id: string, status: 'approved' | 'flagged', note?: string, reviewerName?: string) =>
    api.post(`/analysis/ticket/${id}/review`, { status, note, reviewerName }),
  clearReview: (id: string) =>
    api.delete(`/analysis/ticket/${id}/review`),
  getReviews: (ticketIds?: string[]) =>
    api.get(`/analysis/reviews${ticketIds?.length ? `?ticketIds=${ticketIds.join(',')}` : ''}`),
  getCachedScores: (ticketIds: string[]) =>
    api.post('/analysis/cached-scores', { ticketIds }),
  getAgentInsights: (email: string, date: string, dateMode: DateMode = 'activity', sampleTicketIds?: string[]) =>
    api.get(`/analysis/agent/${encodeURIComponent(email)}/insights?date=${date}&dateMode=${dateMode}${sampleTicketIds?.length ? `&ticketIds=${sampleTicketIds.join(',')}` : ''}`),
  adjustScore: (id: string, scoreOverride: number, adjustedBy: string, adjustmentReason?: string) =>
    api.patch(`/analysis/ticket/${id}/score`, { scoreOverride, adjustedBy, adjustmentReason }),
  getScoreHistory: (id: string) =>
    api.get(`/analysis/ticket/${id}/score-history`),
};

export const dumpApi = {
  importXlsx: (file: File, clearExisting = false) => {
    const form = new FormData();
    form.append('file', file);
    form.append('clearExisting', String(clearExisting));
    return api.post('/dump/import-xlsx', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
};

export const customersApi = {
  getHistory: (email: string, limit = 50) =>
    api.get(`/customers/${encodeURIComponent(email)}/history?limit=${limit}`),
};

export const auditorsApi = {
  list: () => api.get('/auditors/list'),
  getAssignments: (date: string, dateMode: DateMode = 'activity') =>
    api.get(`/auditors/assignments?date=${date}&dateMode=${dateMode}`),
  claim: (date: string, dateMode: DateMode, agentEmail: string, auditor: string) =>
    api.post('/auditors/claim', { date, dateMode, agentEmail, auditor }),
  release: (date: string, dateMode: DateMode, agentEmail: string, auditor: string) =>
    api.post('/auditors/release', { date, dateMode, agentEmail, auditor }),
  getPushedScores: (date: string, dateMode: DateMode = 'activity') =>
    api.get(`/auditors/pushed-scores?date=${date}&dateMode=${dateMode}`),
  pushScores: (date: string, dateMode: DateMode, agentEmail: string, auditor: string) =>
    api.post('/auditors/push-scores', { date, dateMode, agentEmail, auditor }),
  getTeamProgress: (date: string, dateMode: DateMode = 'activity') =>
    api.get(`/auditors/team-progress?date=${date}&dateMode=${dateMode}`),
  getMyStats: (date: string, dateMode: DateMode, auditor: string) =>
    api.get(`/auditors/my-stats?date=${date}&dateMode=${dateMode}&auditor=${encodeURIComponent(auditor)}`),
};

export const reevaluationsApi = {
  list: (status?: string) =>
    api.get(`/reevaluations${status ? `?status=${status}` : ''}`),
  create: (input: { ticketId: string; agentEmail?: string; reason?: string; requestedBy?: string; originalScore?: number | null }) =>
    api.post('/reevaluations', input),
  claim: (id: number, auditor: string) =>
    api.post(`/reevaluations/${id}/claim`, { auditor }),
  resolve: (id: number, auditor: string, status: 'resolved' | 'rejected', note?: string, newScore?: number | null) =>
    api.post(`/reevaluations/${id}/resolve`, { auditor, status, note, newScore }),
};

export const dailyPicksApi = {
  getPicks: (
    date: string,
    dateMode: DateMode = 'activity',
    agentEmail?: string,
    autoGenerate = true
  ) =>
    api.get(`/daily-picks?${new URLSearchParams({
      date,
      dateMode,
      ...(agentEmail ? { agentEmail } : {}),
      autoGenerate: String(autoGenerate),
    }).toString()}`),
  runAudit: (
    date: string,
    dateMode: DateMode = 'activity',
    options?: {
      agentEmail?: string;
      count?: number;
      randomizeSample?: boolean;
    }
  ) =>
    api.post('/daily-picks/run-audit', { date, dateMode, ...options }, { timeout: 300000 }),
  getStatus: (date: string, dateMode: DateMode = 'activity', agentEmail?: string) =>
    api.get(`/daily-picks/status?${new URLSearchParams({
      date,
      dateMode,
      ...(agentEmail ? { agentEmail } : {}),
    }).toString()}`),
};
