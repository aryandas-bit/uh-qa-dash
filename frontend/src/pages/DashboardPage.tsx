import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Users,
  ChevronRight,
  Calendar,
  CalendarCheck,
  Search,
  Ticket,
  TrendingUp,
  AlertTriangle,
  Star,
  Frown,
  Clock,
  CheckCircle,
  Play,
  Loader2,
  X,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import DatePicker from '../components/common/DatePicker';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { agentsApi, ticketsApi, dailyPicksApi } from '../api/client';
import type { DateMode } from '../api/client';

export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState('');
  const [dateMode, setDateMode] = useState<DateMode>('activity');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch available dates to auto-select the latest
  const { data: datesData, isLoading: datesLoading } = useQuery({
    queryKey: ['dates'],
    queryFn: () => agentsApi.getDates(),
    staleTime: 1000 * 60 * 60,
  });

  // Auto-select the latest available date once loaded
  const latestDate = datesData?.data?.dates?.[0];
  const effectiveDate = selectedDate || latestDate || '';

  // Fetch agent daily data
  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents', effectiveDate, dateMode],
    queryFn: () => agentsApi.getDaily(effectiveDate, dateMode),
    enabled: !!effectiveDate,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  // Fetch daily insights
  const { data: insightsData, isLoading: insightsLoading } = useQuery({
    queryKey: ['insights', effectiveDate, dateMode],
    queryFn: () => ticketsApi.getInsights(effectiveDate, dateMode),
    enabled: !!effectiveDate,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  const agents = agentsData?.data?.agents || [];
  const insights = insightsData?.data || {};
  const summary = insights.summary || {};
  const topIssues = insights.topIssues || [];
  const bestAgents = insights.bestAgents || [];
  const frustratedCustomers = insights.frustratedCustomers || [];

  // Filter agents by search query
  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const query = searchQuery.toLowerCase();
    return agents.filter((agent: any) => {
      const agentEmail = agent?.agentEmail || '';
      const name = formatAgentName(agentEmail).toLowerCase();
      const email = agentEmail.toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }, [agents, searchQuery]);

  // Format agent name nicely
  function formatAgentName(email?: string) {
    if (!email) return 'Unknown Agent';
    return email
      .split('@')[0]
      .replace(/_ext$/, '')
      .replace(/[._]/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  const formatTime = (seconds: number | null) => {
    if (seconds === null || seconds === undefined) return '-';
    const num = Number(seconds);
    if (isNaN(num) || !isFinite(num) || num <= 0) return '-';
    if (num < 60) return `${Math.round(num)}s`;
    if (num < 3600) return `${Math.round(num / 60)}m`;
    return `${(num / 3600).toFixed(1)}h`;
  };

  const isLoading = datesLoading || agentsLoading || insightsLoading;
  const hasNoDashboardData =
    !isLoading &&
    !searchQuery &&
    agents.length === 0 &&
    topIssues.length === 0 &&
    bestAgents.length === 0 &&
    frustratedCustomers.length === 0;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">QA Dashboard</h1>
          <p className="text-slate-500 mt-1">
            Daily support performance overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Date Mode Toggle */}
          <div className="flex items-center bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => setDateMode('initialized')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                dateMode === 'initialized'
                  ? 'bg-uh-purple text-white'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Count tickets by when they were created (matches Yellow.ai)"
            >
              <Calendar size={14} />
              <span>Created</span>
            </button>
            <button
              onClick={() => setDateMode('activity')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                dateMode === 'activity'
                  ? 'bg-uh-purple text-white'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Count tickets by when they had activity/resolved"
            >
              <CalendarCheck size={14} />
              <span>Activity</span>
            </button>
          </div>
          <DatePicker
            selectedDate={effectiveDate}
            onDateChange={setSelectedDate}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner text="Loading dashboard..." />
        </div>
      ) : (
        <>
          {/* Summary Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <div className="card flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-uh-purple/20">
                <Ticket size={20} className="text-uh-purple" />
              </div>
              <div>
                <p className="text-slate-500 text-xs">Total Tickets</p>
                <p className="text-2xl font-bold">{summary.totalTickets || 0}</p>
              </div>
            </div>
            <div className="card flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-uh-cyan/20">
                <Users size={20} className="text-uh-cyan" />
              </div>
              <div>
                <p className="text-slate-500 text-xs">Active Agents</p>
                <p className="text-2xl font-bold">{summary.activeAgents || 0}</p>
              </div>
            </div>
            <div className="card flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-uh-success/20">
                <CheckCircle size={20} className="text-uh-success" />
              </div>
              <div>
                <p className="text-slate-500 text-xs">Resolved</p>
                <p className="text-2xl font-bold">{summary.resolvedCount || 0}</p>
              </div>
            </div>
            <div className="card flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-uh-warning/20">
                <Star size={20} className="text-uh-warning" />
              </div>
              <div>
                <p className="text-slate-500 text-xs">Avg CSAT</p>
                <p className="text-2xl font-bold">{summary.avgCsat || '-'}</p>
              </div>
            </div>
            <div className="card flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-uh-cyan/20">
                <Clock size={20} className="text-uh-cyan" />
              </div>
              <div>
                <p className="text-slate-500 text-xs">Avg Response</p>
                <p className="text-2xl font-bold">{formatTime(summary.avgResponseTime)}</p>
              </div>
            </div>
            <div className="card flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-uh-error/20">
                <AlertTriangle size={20} className="text-uh-error" />
              </div>
              <div>
                <p className="text-slate-500 text-xs">Low CSAT</p>
                <p className="text-2xl font-bold">{summary.lowCsatCount || 0}</p>
              </div>
            </div>
          </div>

          {/* Three Column Layout: Top Issues, Best Agents, Frustrated Customers */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* Top Issues */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={18} className="text-uh-purple" />
                <h2 className="text-lg font-semibold">Top Issues</h2>
              </div>
              {topIssues.length === 0 ? (
                <p className="text-slate-400 text-center py-4">No data</p>
              ) : (
                <div className="space-y-2">
                  {topIssues.slice(0, 5).map((issue: any, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-100"
                    >
                      <span className="text-sm truncate flex-1 mr-2">
                        {issue.category || 'Unknown'}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-uh-purple/20 text-uh-purple">
                        {issue.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Best Agents */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Star size={18} className="text-uh-warning" />
                <h2 className="text-lg font-semibold">Best Agents (by CSAT)</h2>
              </div>
              {bestAgents.length === 0 ? (
                <p className="text-slate-400 text-center py-4">No data (need 3+ rated tickets)</p>
              ) : (
                <div className="space-y-2">
                  {bestAgents.map((agent: any, idx: number) => (
                    <Link
                      key={agent.agentEmail}
                      to={`/agent/${encodeURIComponent(agent.agentEmail)}?date=${effectiveDate}&dateMode=${dateMode}`}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-uh-warning/20 text-uh-warning text-xs flex items-center justify-center font-bold">
                          {idx + 1}
                        </span>
                        <span className="text-sm truncate">
                          {formatAgentName(agent.agentEmail)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">{agent.totalTickets} tickets</span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-uh-success/20 text-uh-success">
                          {agent.avgCsat}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Frustrated Customers */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Frown size={18} className="text-uh-error" />
                <h2 className="text-lg font-semibold">Most Frustrated Customers</h2>
              </div>
              {frustratedCustomers.length === 0 ? (
                <p className="text-slate-400 text-center py-4">No low CSAT today</p>
              ) : (
                <div className="space-y-2">
                  {frustratedCustomers.map((customer: any) => (
                    <Link
                      key={customer.customerEmail}
                      to={`/customer/${encodeURIComponent(customer.customerEmail)}`}
                      className="block p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-all"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate">
                          {customer.customerName || customer.customerEmail?.split('@')[0] || 'Unknown'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-uh-error/20 text-uh-error">
                          CSAT: {customer.lowestCsat}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate" title={customer.subjects}>
                        {customer.subjects?.split(' | ')[0] || 'No subject'}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Daily Audit Section */}
          {effectiveDate && <DailyAuditSection date={effectiveDate} dateMode={dateMode} />}

          {/* Agent List */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Agents ({filteredAgents.length})</h2>
              {/* Search Bar */}
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search agents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 rounded-xl bg-slate-50 text-sm focus:outline-none focus:bg-white shadow-elevation-1 focus:shadow-elevation-2 w-64 transition-all duration-md3 ease-md3"
                />
              </div>
            </div>

            {filteredAgents.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <p className="text-slate-400">
                  {searchQuery ? 'No agents match your search' : 'No agents found for this date'}
                </p>
                {hasNoDashboardData && (
                  <p className="text-sm text-slate-500 max-w-xl mx-auto">
                    The app is running, but your local backend does not have ticket data yet. Add your Turso credentials or load local data into `backend/dev.db` to populate the dashboard.
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredAgents.map((agent: any) => (
                  <Link
                    key={agent.agentEmail}
                    to={`/agent/${encodeURIComponent(agent.agentEmail)}?date=${effectiveDate}&dateMode=${dateMode}`}
                    className="flex items-center justify-between p-4 rounded-xl bg-white shadow-elevation-1 hover:shadow-elevation-2 transition-all duration-md3 ease-md3 group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-uh-purple flex items-center justify-center text-white font-bold">
                        {formatAgentName(agent.agentEmail).charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium">{formatAgentName(agent.agentEmail)}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>{agent.totalTickets} tickets</span>
                          {agent.avgCsat && (
                            <>
                              <span>•</span>
                              <span className={agent.avgCsat >= 4 ? 'text-uh-success' : agent.avgCsat < 3 ? 'text-uh-error' : ''}>
                                CSAT: {agent.avgCsat}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={20} className="text-slate-400 group-hover:text-uh-purple transition-colors" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Daily Audit Section — shows picks and allows triggering batch analysis
type DailyPickRow = {
  pickDate: string;
  dateMode: DateMode;
  agentEmail: string;
  ticketId: string;
  pickOrder: number;
  analyzed: boolean;
  analysisStatus: string | null;
  ticket: {
    ticketId: string;
    subject: string | null;
    customerEmail: string | null;
    status: string | null;
    priority: string | null;
    groupName: string | null;
    day: string | null;
    responseTimeSeconds: number | null;
    hasStoredAnalysis: boolean;
  } | null;
};

function DailyAuditSection({ date, dateMode }: { date: string; dateMode: DateMode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isPolling, setIsPolling] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const { data: picksData, isLoading: picksLoading } = useQuery({
    queryKey: ['daily-picks', date, dateMode],
    queryFn: () => dailyPicksApi.getPicks(date, dateMode),
    enabled: !!date,
    staleTime: 1000 * 30,
  });

  const { data: statusData } = useQuery({
    queryKey: ['daily-picks-status', date, dateMode],
    queryFn: () => dailyPicksApi.getStatus(date, dateMode),
    enabled: !!date && isPolling,
    refetchInterval: isPolling ? 3000 : false,
  });

  const runAudit = useMutation({
    mutationFn: () => dailyPicksApi.runAudit(date, dateMode),
    onSuccess: () => {
      setIsPolling(true);
      queryClient.invalidateQueries({ queryKey: ['daily-picks-status', date, dateMode] });
      queryClient.invalidateQueries({ queryKey: ['daily-picks', date, dateMode] });
    },
  });

  const status = statusData?.data;
  const picks = picksData?.data;
  const byAgent = picks?.byAgent || {};
  const agentEmails = Object.keys(byAgent).sort((left, right) => {
    const leftData = byAgent[left];
    const rightData = byAgent[right];
    if (rightData.analyzed !== leftData.analyzed) return rightData.analyzed - leftData.analyzed;
    if (rightData.total !== leftData.total) return rightData.total - leftData.total;
    return left.localeCompare(right);
  });
  const totalPicks = picks?.totalPicks || 0;
  const analyzed = status?.analyzed ?? picks?.picks?.filter((pick: DailyPickRow) => pick.analyzed).length ?? 0;
  const errors = status?.errors || 0;
  const inProgress = status?.inProgress || false;
  const progressPct = totalPicks > 0 ? Math.round((analyzed / totalPicks) * 100) : 0;

  // Stop polling when audit completes
  useEffect(() => {
    if (isPolling && status && !status.inProgress) {
      setIsPolling(false);
      queryClient.invalidateQueries({ queryKey: ['daily-picks', date, dateMode] });
      queryClient.invalidateQueries({ queryKey: ['daily-picks-status', date, dateMode] });
    }
  }, [status, isPolling, date, dateMode, queryClient]);

  if (picksLoading) return null;

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Daily Audit</h2>
          <p className="text-slate-500 text-sm">
            {totalPicks > 0
              ? `${totalPicks} tickets sampled across ${agentEmails.length} agents (${dateMode === 'activity' ? 'activity date' : 'created date'})`
              : 'Generate random ticket picks for QA review'}
          </p>
        </div>
        <button
          onClick={() => runAudit.mutate()}
          disabled={runAudit.isPending || inProgress}
          className="btn-primary flex items-center gap-2 text-sm !px-4 !py-2.5"
        >
          {runAudit.isPending || inProgress ? (
            <><Loader2 size={16} className="animate-spin" /> Running...</>
          ) : (
            <><Play size={16} /> {totalPicks > 0 ? 'Re-run Audit' : 'Run Daily Audit'}</>
          )}
        </button>
      </div>

      {/* Progress Bar */}
      {totalPicks > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-sm text-slate-500 mb-1">
            <span>{analyzed} / {totalPicks} analyzed</span>
            <span>{progressPct}%{errors > 0 ? ` • ${errors} failed` : ''}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-uh-purple rounded-full transition-all duration-500 ease-md3"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Per-agent breakdown */}
      {agentEmails.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {agentEmails.map(email => {
            const agent = byAgent[email];
            const name = email.split('@')[0].replace(/[._]/g, ' ').replace(/_ext$/, '');
            const pct = agent.total > 0 ? Math.round((agent.analyzed / agent.total) * 100) : 0;
            return (
              <button
                key={email}
                onClick={() => setSelectedAgent(email)}
                className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 hover:bg-slate-100 hover:shadow-elevation-1 transition-all duration-md3 ease-md3 text-left"
              >
                <div className="w-7 h-7 rounded-full bg-uh-purple/10 text-uh-purple flex items-center justify-center text-xs font-bold">
                  {name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{name}</p>
                  <p className="text-[10px] text-slate-400 flex items-center gap-1">
                    <span>{agent.analyzed}/{agent.total} done</span>
                    <span>•</span>
                    <span>{pct}%</span>
                    {agent.errors > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-uh-error">{agent.errors} failed</span>
                      </>
                    )}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Modal for selected agent's tickets */}
      {selectedAgent && (
        <AnalyzedTicketsModal
          email={selectedAgent}
          date={date}
          picks={picks?.picks || []}
          onClose={() => setSelectedAgent(null)}
          onTicketClick={(ticketId) => {
            navigate(`/ticket/${ticketId}?refresh=true`);
            setSelectedAgent(null);
          }}
        />
      )}
    </div>
  );
}

// Modal showing analyzed tickets for a specific agent
function AnalyzedTicketsModal({
  email,
  date,
  picks,
  onClose,
  onTicketClick,
}: {
  email: string;
  date: string;
  picks: any[];
  onClose: () => void;
  onTicketClick: (ticketId: string) => void;
}) {
  const agentPicks = picks
    .filter((pick) => pick.agentEmail === email)
    .sort((left, right) => left.pickOrder - right.pickOrder);
  const name = email.split('@')[0].replace(/[._]/g, ' ').replace(/_ext$/, '');

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-elevation-3 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-semibold">{name}'s Analyzed Tickets</h2>
            <p className="text-sm text-slate-500 mt-1">{date} • {agentPicks.length} sampled tickets</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-auto flex-1">
          {agentPicks.length === 0 ? (
            <div className="p-6 text-center text-slate-500">No tickets found</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {agentPicks.map((pick) => (
                <button
                  key={pick.ticketId}
                  onClick={() => onTicketClick(pick.ticketId)}
                  className="w-full px-6 py-4 hover:bg-slate-50 transition-colors text-left flex items-center justify-between group"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">Ticket {pick.ticketId}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        #{pick.pickOrder}
                      </span>
                      {pick.ticket?.status && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          pick.ticket.status === 'RESOLVED'
                            ? 'bg-uh-success/20 text-uh-success'
                            : 'bg-uh-warning/20 text-uh-warning'
                        }`}>
                          {pick.ticket.status}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 truncate">
                      {pick.ticket?.subject || 'No subject'}
                    </p>
                    <div className="flex items-center gap-2">
                      {pick.analyzed ? (
                        <>
                          {pick.analysisStatus === 'success' ? (
                            <CheckCircle2 size={14} className="text-uh-success" />
                          ) : (
                            <AlertCircle size={14} className="text-uh-error" />
                          )}
                          <span className="text-xs text-slate-500">
                            {pick.analysisStatus === 'success'
                              ? (pick.ticket?.hasStoredAnalysis ? 'Analyzed and cached' : 'Analyzed')
                              : 'Analysis failed'}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">Pending</span>
                      )}
                      {pick.ticket?.groupName && (
                        <>
                          <span className="text-slate-300">•</span>
                          <span className="text-xs text-slate-500 truncate">{pick.ticket.groupName}</span>
                        </>
                      )}
                      {pick.ticket?.customerEmail && (
                        <>
                          <span className="text-slate-300">•</span>
                          <span className="text-xs text-slate-400 truncate">{pick.ticket.customerEmail}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-slate-400 group-hover:text-uh-purple transition-colors" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
