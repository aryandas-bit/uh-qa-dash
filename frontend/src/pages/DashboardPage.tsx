import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format, subDays } from 'date-fns';
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
  CheckCircle
} from 'lucide-react';
import DatePicker from '../components/common/DatePicker';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { agentsApi, ticketsApi } from '../api/client';
import type { DateMode } from '../api/client';

export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState('');
  const [dateMode, setDateMode] = useState<DateMode>('activity');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch available dates to auto-select the latest
  const { data: datesData } = useQuery({
    queryKey: ['dates'],
    queryFn: () => agentsApi.getDates(),
    staleTime: 1000 * 60 * 60,
  });

  // Auto-select the latest available date once loaded
  const latestDate = datesData?.data?.dates?.[0];
  const effectiveDate = selectedDate || latestDate || format(subDays(new Date(), 2), 'yyyy-MM-dd');

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
      const name = formatAgentName(agent.agentEmail).toLowerCase();
      const email = agent.agentEmail.toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }, [agents, searchQuery]);

  // Format agent name nicely
  function formatAgentName(email: string) {
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

  const isLoading = agentsLoading || insightsLoading;

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
          <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1">
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
                  className="pl-9 pr-4 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:border-uh-purple/50 w-64 transition-all"
                />
              </div>
            </div>

            {filteredAgents.length === 0 ? (
              <p className="text-slate-400 text-center py-12">
                {searchQuery ? 'No agents match your search' : 'No agents found for this date'}
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredAgents.map((agent: any) => (
                  <Link
                    key={agent.agentEmail}
                    to={`/agent/${encodeURIComponent(agent.agentEmail)}?date=${effectiveDate}&dateMode=${dateMode}`}
                    className="flex items-center justify-between p-4 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 hover:border-uh-purple/30 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-uh-purple to-uh-cyan flex items-center justify-center text-white font-bold">
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
