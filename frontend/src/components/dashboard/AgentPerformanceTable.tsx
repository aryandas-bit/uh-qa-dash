import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, ExternalLink, AlertTriangle } from 'lucide-react';
import ScoreBadge from '../common/ScoreBadge';
import type { AgentSummary } from '../../types';

interface AgentPerformanceTableProps {
  agents: AgentSummary[];
  isLoading: boolean;
  date: string;
}

type SortField = 'totalTickets' | 'avgCsat' | 'lowCsatCount' | 'avgResponseTime';
type SortDirection = 'asc' | 'desc';

export default function AgentPerformanceTable({
  agents,
  isLoading,
  date,
}: AgentPerformanceTableProps) {
  const [sortField, setSortField] = useState<SortField>('lowCsatCount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedAgents = [...agents].sort((a, b) => {
    const aVal = Number(a[sortField]) || 0;
    const bVal = Number(b[sortField]) || 0;
    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const formatResponseTime = (seconds: number | null) => {
    if (!seconds) return 'N/A';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp size={16} />
    ) : (
      <ChevronDown size={16} />
    );
  };

  if (isLoading) {
    return (
      <div className="card">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-slate-100 rounded w-1/4" />
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-50 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Agent Performance</h2>
        <span className="text-sm text-slate-400">{agents.length} agents</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-slate-500 text-sm">
              <th className="pb-4 pr-4">Agent</th>
              <th
                className="pb-4 px-4 cursor-pointer hover:text-slate-900 transition-colors"
                onClick={() => handleSort('totalTickets')}
              >
                <div className="flex items-center gap-1">
                  Tickets
                  {renderSortIcon('totalTickets')}
                </div>
              </th>
              <th
                className="pb-4 px-4 cursor-pointer hover:text-slate-900 transition-colors"
                onClick={() => handleSort('avgCsat')}
              >
                <div className="flex items-center gap-1">
                  Avg CSAT
                  {renderSortIcon('avgCsat')}
                </div>
              </th>
              <th
                className="pb-4 px-4 cursor-pointer hover:text-slate-900 transition-colors"
                onClick={() => handleSort('lowCsatCount')}
              >
                <div className="flex items-center gap-1">
                  Low CSAT
                  {renderSortIcon('lowCsatCount')}
                </div>
              </th>
              <th
                className="pb-4 px-4 cursor-pointer hover:text-slate-900 transition-colors"
                onClick={() => handleSort('avgResponseTime')}
              >
                <div className="flex items-center gap-1">
                  Avg Response
                  {renderSortIcon('avgResponseTime')}
                </div>
              </th>
              <th className="pb-4 pl-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedAgents.map((agent) => (
              <tr
                key={agent.agentEmail}
                className="hover:bg-slate-50 transition-colors rounded-lg"
              >
                <td className="py-4 pr-4">
                  <div>
                    <p className="font-medium">
                      {agent.agentEmail.split('@')[0]}
                    </p>
                    <p className="text-xs text-slate-400">{agent.agentEmail}</p>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <span className="font-semibold">{agent.totalTickets}</span>
                </td>
                <td className="py-4 px-4">
                  <ScoreBadge
                    score={agent.avgCsat ? agent.avgCsat * 20 : null}
                    size="sm"
                  />
                </td>
                <td className="py-4 px-4">
                  {agent.lowCsatCount > 0 ? (
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={16} className="text-uh-error" />
                      <span className="text-uh-error font-semibold">
                        {agent.lowCsatCount}
                      </span>
                    </div>
                  ) : (
                    <span className="text-uh-success">0</span>
                  )}
                </td>
                <td className="py-4 px-4 text-slate-500">
                  {formatResponseTime(agent.avgResponseTime)}
                </td>
                <td className="py-4 pl-4">
                  <Link
                    to={`/agent/${encodeURIComponent(agent.agentEmail)}?date=${date}`}
                    className="flex items-center gap-1 text-uh-cyan hover:text-uh-purple transition-colors text-sm"
                  >
                    View
                    <ExternalLink size={14} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {agents.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          No agent data available for this date
        </div>
      )}
    </div>
  );
}
