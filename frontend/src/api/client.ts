import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

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
  getTicketAnalysis: (id: string, refresh = false) =>
    api.get(`/analysis/ticket/${id}?refresh=${refresh}`),
  batchAnalyze: (date: string, agentEmail?: string, limit = 20) =>
    api.post('/analysis/batch', { date, agentEmail, limit, prioritizeFlagged: true }, { timeout: 120000 }), // 2 min for AI
  getAgentSummary: (email: string, date: string) =>
    api.get(`/analysis/agent/${encodeURIComponent(email)}/summary?date=${date}`),
};

export const customersApi = {
  getHistory: (email: string, limit = 50) =>
    api.get(`/customers/${encodeURIComponent(email)}/history?limit=${limit}`),
};
