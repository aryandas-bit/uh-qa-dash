import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, TrendingDown, ExternalLink } from 'lucide-react';
import LoadingSpinner from '../components/common/LoadingSpinner';
import ScoreBadge from '../components/common/ScoreBadge';
import { agentsApi } from '../api/client';

export default function DefaultersPage() {
  const [minIssues, setMinIssues] = useState(3);
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ['defaulters', minIssues, days],
    queryFn: () => agentsApi.getDefaulters(minIssues, days),
  });

  const defaulters = data?.data?.defaulters || [];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <AlertTriangle className="text-uh-error" />
            Defaulters
          </h1>
          <p className="text-slate-500 mt-1">
            Agents with repeated QA scores below 50
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div>
            <label className="text-sm text-slate-500 block mb-1">
              Min Issues
            </label>
            <select
              value={minIssues}
              onChange={(e) => setMinIssues(Number(e.target.value))}
              className="input"
            >
              <option value={2}>2+</option>
              <option value={3}>3+</option>
              <option value={5}>5+</option>
              <option value={10}>10+</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-500 block mb-1">
              Time Period
            </label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="input"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="card bg-gradient-to-br from-uh-error/20 to-uh-error/5 border-uh-error/30">
          <p className="text-slate-500 text-sm">Total Defaulters</p>
          <p className="text-3xl font-bold mt-1">{defaulters.length}</p>
        </div>
        <div className="card">
          <p className="text-slate-500 text-sm">Total Low QA Tickets</p>
          <p className="text-3xl font-bold mt-1">
            {defaulters.reduce((sum: number, d: any) => sum + d.lowQaCount, 0)}
          </p>
        </div>
        <div className="card">
          <p className="text-slate-500 text-sm">Avg Low QA Rate</p>
          <p className="text-3xl font-bold mt-1">
            {defaulters.length > 0
              ? (
                  defaulters.reduce((sum: number, d: any) => sum + Number(d.lowQaPercent || 0), 0) /
                  defaulters.length
                ).toFixed(1)
              : 0}
            %
          </p>
        </div>
      </div>

      {/* Defaulters List */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Agents Requiring Attention</h2>

        {isLoading ? (
          <LoadingSpinner text="Loading defaulters..." />
        ) : defaulters.length === 0 ? (
          <div className="text-center py-12">
            <TrendingDown size={48} className="text-uh-success mx-auto mb-4" />
            <p className="text-slate-500">
              No defaulters found with current filters
            </p>
            <p className="text-slate-400 text-sm mt-1">
              Try adjusting the minimum issues or time period
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-slate-500 text-sm border-b border-slate-200">
                  <th className="pb-4 pr-4">Agent</th>
                  <th className="pb-4 px-4">Total Tickets</th>
                  <th className="pb-4 px-4">Low QA Count (&lt;50)</th>
                  <th className="pb-4 px-4">Low QA %</th>
                  <th className="pb-4 px-4">Avg QA Score</th>
                  <th className="pb-4 pl-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {defaulters.map((defaulter: any) => (
                  <tr
                    key={defaulter.agentEmail}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-4 pr-4">
                      <div>
                        <p className="font-medium">
                          {defaulter.agentEmail.split('@')[0]}
                        </p>
                        <p className="text-xs text-slate-400">
                          {defaulter.agentEmail}
                        </p>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className="font-semibold">
                        {defaulter.totalTickets}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={16} className="text-uh-error" />
                        <span className="text-uh-error font-semibold">
                          {defaulter.lowQaCount}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`font-semibold ${
                          Number(defaulter.lowQaPercent) > 20
                            ? 'text-uh-error'
                            : Number(defaulter.lowQaPercent) > 10
                            ? 'text-uh-warning'
                            : 'text-slate-500'
                        }`}
                      >
                        {Number(defaulter.lowQaPercent || 0).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <ScoreBadge
                        score={defaulter.avgQaScore ?? null}
                        size="sm"
                      />
                    </td>
                    <td className="py-4 pl-4">
                      <Link
                        to={`/agent/${encodeURIComponent(defaulter.agentEmail)}`}
                        className="flex items-center gap-1 text-uh-cyan hover:text-uh-purple transition-colors text-sm"
                      >
                        View Details
                        <ExternalLink size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
