import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Users,
  ChevronRight,
  Calendar,
  CalendarCheck,
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
  AlertCircle,
  RefreshCw,
  Inbox
} from 'lucide-react';
import DatePicker from '../components/common/DatePicker';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { api, agentsApi, ticketsApi, dailyPicksApi } from '../api/client';
import type { DateMode } from '../api/client';
import { getAvatarColor, getAvatarInitial } from '../utils/avatarColors';
import AgentTrendSparkline from '../components/agent/AgentTrendSparkline';
import { useDateStore } from '../store/dateStore';
import { useEffect } from 'react';

export default function DashboardPage() {
  const { selectedDate, setSelectedDate, dateMode, setDateMode } = useDateStore();

  // Fetch available dates to auto-select the latest
  const { data: datesData, isLoading: datesLoading } = useQuery({
    queryKey: ['dates'],
    queryFn: () => agentsApi.getDates(),
    staleTime: 1000 * 60 * 60,
  });

  const latestDate = datesData?.data?.dates?.[0];
  // Data queries use selectedDate if user picked one, otherwise fall back to latestDate
  const effectiveDate = selectedDate || latestDate || '';
  // Picker always has a value — shows today as placeholder while dates are loading
  const pickerDate = effectiveDate || new Date().toISOString().slice(0, 10);

  // Auto-select the latest available date once loaded IF no date is already selected
  useEffect(() => {
    if (!selectedDate && latestDate) {
      setSelectedDate(latestDate);
    }
  }, [latestDate, selectedDate, setSelectedDate]);

  // Fetch daily insights
  const { data: insightsData, isLoading: insightsLoading } = useQuery({
    queryKey: ['insights', effectiveDate, dateMode],
    queryFn: () => ticketsApi.getInsights(effectiveDate, dateMode),
    enabled: !!effectiveDate,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  const insights = insightsData?.data || {};
  const summary = insights.summary || {};
  const topIssues = insights.topIssues || [];
  const bestAgents = insights.bestAgents || [];
  const frustratedCustomers = insights.frustratedCustomers || [];

  const formatTime = (seconds: number | null) => {
    if (seconds === null || seconds === undefined) return '-';
    const num = Number(seconds);
    if (isNaN(num) || !isFinite(num) || num <= 0) return '-';
    if (num < 60) return `${Math.round(num)}s`;
    if (num < 3600) return `${Math.round(num / 60)}m`;
    return `${(num / 3600).toFixed(1)}h`;
  };

  const isLoading = datesLoading || insightsLoading;
  const hasNoDashboardData =
    !isLoading &&
    topIssues.length === 0 &&
    bestAgents.length === 0 &&
    frustratedCustomers.length === 0;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
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
            selectedDate={pickerDate}
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
                  {topIssues.slice(0, 5).map((issue: any) => (
                    <div
                      key={issue.category || issue.count}
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
                    <BestAgentRow 
                      key={agent.agentEmail} 
                      agent={agent} 
                      idx={idx} 
                      effectiveDate={effectiveDate} 
                      dateMode={dateMode} 
                    />
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

          {/* Browse agents CTA — agent list lives on the Tickets tab */}
          <Link
            to={`/tickets?date=${effectiveDate}&dateMode=${dateMode}`}
            className="card flex items-center justify-between bg-gradient-to-r from-uh-purple/5 to-uh-cyan/5 hover:from-uh-purple/10 hover:to-uh-cyan/10 transition-all group"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-uh-purple/15 text-uh-purple">
                <Inbox size={22} />
              </div>
              <div>
                <p className="font-semibold">Browse Agents & Tickets</p>
                <p className="text-sm text-slate-500">{summary.activeAgents || 0} agents · {summary.totalTickets || 0} tickets today</p>
              </div>
            </div>
            <ChevronRight size={20} className="text-slate-400 group-hover:text-uh-purple group-hover:translate-x-1 transition-all" />
          </Link>

          {hasNoDashboardData && (
            <p className="text-sm text-slate-500 text-center mt-6 max-w-xl mx-auto">
              The app is running, but your local backend does not have ticket data yet. Add your Turso credentials or load local data into backend/dev.db to populate the dashboard.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function BestAgentRow({ agent, idx, effectiveDate, dateMode }: { 
  agent: any, 
  idx: number, 
  effectiveDate: string, 
  dateMode: string 
}) {
  const { data: trendData } = useQuery({
    queryKey: ['agent-qa-trend', agent.agentEmail],
    queryFn: () => agentsApi.getQATrend(agent.agentEmail, 7),
    staleTime: 1000 * 60 * 10,
  });

  const trend = trendData?.data?.trend || [];

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

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.agentEmail)}?date=${effectiveDate}&dateMode=${dateMode}`}
      className="flex items-center justify-between p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-all group"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="w-5 h-5 rounded-full bg-uh-warning/20 text-uh-warning text-xs flex items-center justify-center font-bold shrink-0">
          {idx + 1}
        </span>
        <div className="min-w-0">
          <p className="text-sm truncate font-medium">
            {formatAgentName(agent.agentEmail)}
          </p>
          <p className="text-[10px] text-slate-400">{agent.totalTickets} tickets</p>
        </div>
      </div>
      
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-12 h-6 opacity-60 group-hover:opacity-100 transition-opacity">
          <AgentTrendSparkline data={trend} height={24} />
        </div>
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-uh-success/20 text-uh-success min-w-[32px] text-center">
          {agent.avgCsat}
        </span>
      </div>
    </Link>
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
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // Always poll status — keeps UI in sync even if audit was triggered elsewhere
  const { data: statusData } = useQuery({
    queryKey: ['daily-picks-status', date, dateMode],
    queryFn: () => dailyPicksApi.getStatus(date, dateMode),
    enabled: !!date,
    refetchInterval: (query) => {
      const s = (query.state.data as any)?.data;
      return s?.inProgress ? 2000 : 15000; // 2s while running, 15s idle
    },
  });

  const inProgress = statusData?.data?.inProgress || false;

  // Picks data — refetch frequently while audit is running
  const { data: picksData, isLoading: picksLoading } = useQuery({
    queryKey: ['daily-picks', date, dateMode],
    queryFn: () => dailyPicksApi.getPicks(date, dateMode),
    enabled: !!date,
    staleTime: inProgress ? 0 : 1000 * 30,
    refetchInterval: inProgress ? 3000 : false,
  });

  const runAudit = useMutation({
    mutationFn: () => dailyPicksApi.runAudit(date, dateMode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-picks-status', date, dateMode] });
      queryClient.invalidateQueries({ queryKey: ['daily-picks', date, dateMode] });
    },
  });

  const resetPicks = useMutation({
    mutationFn: () => api.delete(`/daily-picks/reset?date=${date}&dateMode=${dateMode}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-picks', date, dateMode] });
      queryClient.invalidateQueries({ queryKey: ['daily-picks-status', date, dateMode] });
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
  const progressPct = totalPicks > 0 ? Math.round((analyzed / totalPicks) * 100) : 0;

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
        <div className="flex items-center gap-2">
          {totalPicks > 0 && !inProgress && (
            <button
              onClick={() => { if (confirm('Reset picks and regenerate with current settings?')) resetPicks.mutate(); }}
              disabled={resetPicks.isPending}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <RefreshCw size={14} /> Reset
            </button>
          )}
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
              className={`h-full rounded-full transition-all duration-500 ease-md3 ${
                progressPct === 100 ? 'bg-uh-success' : 'bg-uh-purple'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {progressPct === 100 && (
            <div className="mt-2 flex items-center gap-1.5 text-uh-success text-[10px] font-bold uppercase tracking-wider animate-in fade-in slide-in-from-top-1 duration-500">
              <CheckCircle2 size={12} />
              Daily Audit Complete
            </div>
          )}
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
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: getAvatarColor(name).bg, color: getAvatarColor(name).fg }}
                >
                  {getAvatarInitial(name)}
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
                      {pick.pickReason && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                          pick.pickReason === 'High Risk'
                            ? 'bg-uh-error/10 text-uh-error border border-uh-error/20'
                            : 'bg-uh-cyan/10 text-uh-cyan border border-uh-cyan/20'
                        }`}>
                          {pick.pickReason} {pick.riskScore > 0 ? `(${pick.riskScore})` : ''}
                        </span>
                      )}
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
