import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
  Inbox
} from 'lucide-react';
import DatePicker from '../components/common/DatePicker';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { agentsApi, ticketsApi } from '../api/client';
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

  // Auto-select the latest available date if none is selected or if the selected date is outdated
  useEffect(() => {
    if (!latestDate) return;
    const available: string[] = datesData?.data?.dates || [];
    if (!selectedDate || (available.length > 0 && !available.includes(selectedDate))) {
      setSelectedDate(latestDate);
    }
  }, [latestDate, selectedDate, datesData, setSelectedDate]);

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
  const bestAgentEmails = bestAgents.map((agent: any) => agent.agentEmail).filter(Boolean);

  const { data: trendMapData } = useQuery({
    queryKey: ['agent-qa-trends', bestAgentEmails.join(','), 7],
    queryFn: () => agentsApi.getQATrends(bestAgentEmails, 7),
    enabled: bestAgentEmails.length > 0,
    staleTime: 1000 * 60 * 10,
  });
  const trendMap = trendMapData?.data?.trends || {};

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
                      trend={trendMap[agent.agentEmail] || []}
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

function BestAgentRow({ agent, idx, effectiveDate, dateMode, trend }: { 
  agent: any, 
  idx: number, 
  effectiveDate: string, 
  dateMode: string,
  trend: Array<{ date: string; avgScore: number }>
}) {
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
