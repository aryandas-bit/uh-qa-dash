import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Calendar, CalendarCheck } from 'lucide-react';
import DatePicker from '../components/common/DatePicker';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { agentsApi } from '../api/client';
import type { DateMode } from '../api/client';
import { getAvatarColor, getAvatarInitial } from '../utils/avatarColors';
import AgentTrendSparkline from '../components/agent/AgentTrendSparkline';
import { useDateStore } from '../store/dateStore';
import { useEffect } from 'react';

export default function TicketsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');

  const { selectedDate, setSelectedDate, dateMode: storeDateMode, setDateMode: setStoreDateMode } = useDateStore();

  const { data: datesData } = useQuery({
    queryKey: ['dates'],
    queryFn: () => agentsApi.getDates(),
    staleTime: 1000 * 60 * 60,
  });
  const latestDate = datesData?.data?.dates?.[0] || '';

  // Priorities: URL param > Global Store > API Latest
  const urlDate = searchParams.get('date');
  const urlDateMode = searchParams.get('dateMode') as DateMode;

  const date = urlDate || selectedDate || latestDate;
  const dateMode = urlDateMode || storeDateMode || 'activity';

  // Sync URL params to store if they are present and different
  useEffect(() => {
    if (urlDate && urlDate !== selectedDate) setSelectedDate(urlDate);
    if (urlDateMode && urlDateMode !== storeDateMode) setStoreDateMode(urlDateMode);
  }, [urlDate, urlDateMode, selectedDate, storeDateMode, setSelectedDate, setStoreDateMode]);

  // Initial fallback to latest date if nothing is set
  useEffect(() => {
    if (!selectedDate && latestDate && !urlDate) {
      setSelectedDate(latestDate);
    }
  }, [latestDate, selectedDate, urlDate, setSelectedDate]);

  const { data: agentsData, isLoading } = useQuery({
    queryKey: ['agents-daily', date, dateMode],
    queryFn: () => agentsApi.getDaily(date, dateMode),
    enabled: !!date,
    staleTime: 1000 * 60 * 5,
  });

  const agents: any[] = agentsData?.data?.agents || [];

  const filtered = agents.filter((a) => {
    const name = (a.agentEmail || '').toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const handleDateChange = (d: string) => {
    setSearchParams({ date: d, dateMode });
    setSelectedDate(d);
  };
  const handleDateModeChange = (mode: DateMode) => {
    setSearchParams({ date, dateMode: mode });
    setStoreDateMode(mode);
  };

  const handleAgentClick = (email: string) => {
    navigate(`/agent/${encodeURIComponent(email)}?date=${date}&dateMode=${dateMode}`);
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Tickets</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {agents.length > 0 ? `${agents.length} agents · ${agents.reduce((s, a) => s + (a.totalTickets || 0), 0)} tickets` : 'Loading…'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Date mode toggle */}
          <div className="flex items-center bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => handleDateModeChange('initialized')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                dateMode === 'initialized' ? 'bg-uh-purple text-white' : 'text-slate-500 hover:text-slate-900'
              }`}
              title="Count tickets by creation date (matches Yellow.ai)"
            >
              <Calendar size={14} />
              Created
            </button>
            <button
              onClick={() => handleDateModeChange('activity')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                dateMode === 'activity' ? 'bg-uh-purple text-white' : 'text-slate-500 hover:text-slate-900'
              }`}
              title="Count tickets by activity/resolved date"
            >
              <CalendarCheck size={14} />
              Activity
            </button>
          </div>
          <DatePicker selectedDate={date} onDateChange={handleDateChange} />
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents…"
          className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-uh-purple/30 transition-all"
        />
      </div>

      {/* Agent Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner text="Loading agents…" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-slate-400 text-center py-20">
          {search ? 'No agents match your search.' : 'No agent data for this date.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((agent) => (
            <AgentCardRow 
              key={agent.agentEmail} 
              agent={agent} 
              onClick={() => handleAgentClick(agent.agentEmail)} 
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCardRow({ agent, onClick }: { 
  agent: any, 
  onClick: () => void 
}) {
  const { data: trendData } = useQuery({
    queryKey: ['agent-qa-trend', agent.agentEmail],
    queryFn: () => agentsApi.getQATrend(agent.agentEmail, 7),
    staleTime: 1000 * 60 * 10,
  });

  const trend = trendData?.data?.trend || [];
  const name = (agent.agentEmail || '').split('@')[0].replace(/[._]/g, ' ');
  const initial = getAvatarInitial(name);
  const color = getAvatarColor(name);
  const lowCsat = agent.lowCsatCount || 0;

  return (
    <button
      onClick={onClick}
      className="card text-left flex items-center gap-4 hover:shadow-elevation-2 transition-all group"
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
        style={{ background: color.bg, color: color.fg }}
      >
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold capitalize truncate group-hover:text-uh-purple transition-colors">
          {name}
        </p>
        <p className="text-sm text-slate-400">{agent.totalTickets} tickets</p>
      </div>
      
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="w-16 h-8 opacity-40 group-hover:opacity-100 transition-opacity">
          <AgentTrendSparkline data={trend} />
        </div>
        <div className="flex flex-col items-end">
          {lowCsat > 0 && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-uh-error/10 text-uh-error font-medium mb-0.5">
              {lowCsat} low CSAT
            </span>
          )}
          {agent.avgCsat != null && agent.avgCsat > 0 && (
            <span className="text-[10px] text-slate-400">
              CSAT {(agent.avgCsat * 20).toFixed(0)}%
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
