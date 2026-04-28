import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { agentsApi } from '../api/client';
import { useDateStore } from '../store/dateStore';
import LoadingSpinner from '../components/common/LoadingSpinner';

interface TrendPoint {
  date: string;
  avgScore: number;
}

function formatAgentName(email: string) {
  return email.split('@')[0].replace(/_ext$/, '').replace(/[._]/g, ' ')
    .split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getScoreColor(score: number | null): string {
  if (score === null) return '#94a3b8';
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

function getScoreTextClass(score: number | null): string {
  if (score === null) return 'text-slate-400';
  if (score >= 80) return 'text-uh-success';
  if (score >= 60) return 'text-uh-warning';
  return 'text-uh-error';
}

function AgentTrendCard({ agentEmail, trend }: { agentEmail: string; trend: TrendPoint[] }) {
  const [expanded, setExpanded] = useState(false);
  const latestScore = trend.length > 0 ? trend[trend.length - 1].avgScore : null;
  const color = getScoreColor(latestScore);
  const safeId = agentEmail.replace(/[^a-zA-Z0-9]/g, '_');
  const gradId = `tg_${safeId}`;
  const gradIdFull = `tgf_${safeId}`;

  const formattedData = trend.map(p => ({
    ...p,
    displayDate: p.date.split('-').slice(1).join('/'),
  }));

  return (
    <div className="card">
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="min-w-0">
            <p className="font-medium truncate">{formatAgentName(agentEmail)}</p>
            <p className="text-xs text-slate-400 truncate">{agentEmail}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0 ml-4">
          {latestScore !== null ? (
            <span className={`text-xl font-bold tabular-nums ${getScoreTextClass(latestScore)}`}>
              {Math.round(latestScore)}
            </span>
          ) : (
            <span className="text-sm text-slate-300">—</span>
          )}
          <div className="w-24 h-8">
            {formattedData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={formattedData}>
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis domain={[0, 100]} hide />
                  <Area type="monotone" dataKey="avgScore" stroke={color} fill={`url(#${gradId})`} strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-300">No data</div>
            )}
          </div>
          <div className="text-slate-400">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {formattedData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No trend data yet — run audits to start building this agent's history.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={formattedData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id={gradIdFull} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="displayDate" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const val = Math.round(Number(payload[0].value));
                        return (
                          <div className="bg-white px-2 py-1.5 border border-slate-200 rounded shadow-sm text-xs">
                            <p className="text-slate-400 mb-0.5">{payload[0].payload.displayDate}</p>
                            <p className="font-bold" style={{ color }}>{val}/100</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="avgScore"
                    stroke={color}
                    fill={`url(#${gradIdFull})`}
                    strokeWidth={2}
                    dot={{ fill: color, r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: color }}
                  />
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <span>{formattedData.length} audit sessions</span>
                <Link
                  to={`/agent/${encodeURIComponent(agentEmail)}`}
                  onClick={e => e.stopPropagation()}
                  className="text-uh-cyan hover:underline"
                >
                  View full profile →
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function TrendsPage() {
  const { selectedDate, dateMode } = useDateStore();
  const [search, setSearch] = useState('');

  const { data: datesData } = useQuery({
    queryKey: ['dates'],
    queryFn: () => agentsApi.getDates(),
    staleTime: 1000 * 60 * 60,
  });
  const latestDate = datesData?.data?.dates?.[0] || '';
  const effectiveDate = selectedDate || latestDate || new Date().toISOString().slice(0, 10);

  const { data: dailyData, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents-daily', effectiveDate, dateMode],
    queryFn: () => agentsApi.getDaily(effectiveDate, dateMode),
    enabled: !!effectiveDate,
    staleTime: 1000 * 60 * 30,
  });

  const agents: any[] = dailyData?.data?.agents || [];
  const agentEmails: string[] = agents.map((a: any) => a.agentEmail).filter(Boolean);

  const { data: trendsData, isLoading: trendsLoading } = useQuery({
    queryKey: ['agent-qa-trends-page', agentEmails.join(','), 30],
    queryFn: () => agentsApi.getQATrends(agentEmails, 30),
    enabled: agentEmails.length > 0,
    staleTime: 1000 * 60 * 10,
  });
  const trendMap: Record<string, TrendPoint[]> = trendsData?.data?.trends || {};

  const filteredEmails = agentEmails.filter(email =>
    !search ||
    email.toLowerCase().includes(search.toLowerCase()) ||
    formatAgentName(email).toLowerCase().includes(search.toLowerCase())
  );

  const sortedEmails = [...filteredEmails].sort((a, b) => {
    const tA = trendMap[a] || [];
    const tB = trendMap[b] || [];
    const sA = tA.length > 0 ? tA[tA.length - 1].avgScore : -1;
    const sB = tB.length > 0 ? tB[tB.length - 1].avgScore : -1;
    return sB - sA;
  });

  const isLoading = agentsLoading || (agentEmails.length > 0 && trendsLoading);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">QA Trends</h1>
        <p className="text-slate-500 mt-1">Per-agent QA score history — click any row to expand</p>
      </div>

      <div className="mb-6">
        <input
          type="text"
          placeholder="Search agents..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-xs px-4 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-uh-purple transition-colors"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner text="Loading trends..." />
        </div>
      ) : sortedEmails.length === 0 ? (
        <div className="card text-center py-16">
          <TrendingUp size={40} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium">No agents found</p>
          <p className="text-slate-400 text-sm mt-1">
            {search ? 'No agents match your search.' : 'No agent data available for the current date.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedEmails.map(email => (
            <AgentTrendCard
              key={email}
              agentEmail={email}
              trend={trendMap[email] || []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
