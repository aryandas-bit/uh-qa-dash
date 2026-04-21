import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ThumbsUp, Flag, ClipboardList, TrendingUp, AlertTriangle, MessageSquare, Search, X } from 'lucide-react';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { analysisApi } from '../api/client';

export default function QCReviewsPage() {
  const [dateFilter, setDateFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['qc-reviews-all'],
    queryFn: () => analysisApi.getReviews(),
    staleTime: 1000 * 60 * 2,
  });

  const allReviews: any[] = data?.data?.reviews || [];
  const summary = data?.data?.summary || { total: 0, approved: 0, flagged: 0, approvalRate: 0 };
  const byAgent: Record<string, { approved: number; flagged: number }> = data?.data?.byAgent || {};

  const reviews = allReviews.filter(r => {
    if (dateFilter && !(r.day || '').includes(dateFilter)) return false;
    if (agentFilter && !(r.agentEmail || '').toLowerCase().includes(agentFilter.toLowerCase())) return false;
    return true;
  });

  const agentRows = Object.entries(byAgent)
    .map(([agent, counts]) => ({ agent, ...counts, total: counts.approved + counts.flagged }))
    .sort((a, b) => b.total - a.total);

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <LoadingSpinner text="Loading QC reviews..." />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList size={24} className="text-uh-purple" />
          QC Review Scores
        </h1>
        <p className="text-slate-500 mt-1">All approved and flagged QC analyses</p>
      </div>

      {reviews.length === 0 ? (
        <div className="card text-center py-16">
          <ClipboardList size={40} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium">No reviews yet</p>
          <p className="text-slate-400 text-sm mt-1">Open any ticket and approve or flag its AI analysis to get started.</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="card flex items-center gap-4">
              <div className="p-3 rounded-xl bg-uh-purple/20">
                <ClipboardList size={22} className="text-uh-purple" />
              </div>
              <div>
                <p className="text-slate-500 text-sm">Total Reviewed</p>
                <p className="text-3xl font-bold">{summary.total}</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="p-3 rounded-xl bg-uh-success/20">
                <ThumbsUp size={22} className="text-uh-success" />
              </div>
              <div>
                <p className="text-slate-500 text-sm">Approved</p>
                <p className="text-3xl font-bold text-uh-success">{summary.approved}</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="p-3 rounded-xl bg-uh-error/20">
                <Flag size={22} className="text-uh-error" />
              </div>
              <div>
                <p className="text-slate-500 text-sm">Flagged</p>
                <p className="text-3xl font-bold text-uh-error">{summary.flagged}</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="p-3 rounded-xl bg-uh-cyan/20">
                <TrendingUp size={22} className="text-uh-cyan" />
              </div>
              <div>
                <p className="text-slate-500 text-sm">QC Accuracy</p>
                <p className={`text-3xl font-bold ${
                  summary.approvalRate >= 70 ? 'text-uh-success' :
                  summary.approvalRate >= 40 ? 'text-uh-warning' : 'text-uh-error'
                }`}>
                  {summary.approvalRate}%
                </p>
                <p className="text-xs text-slate-400">of analyses approved</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Accuracy bar */}
            <div className="card lg:col-span-1">
              <h2 className="text-sm font-semibold text-slate-500 mb-3">Accuracy Breakdown</h2>
              <div className="flex rounded-full overflow-hidden h-5 mb-2">
                {summary.approved > 0 && (
                  <div
                    style={{ width: `${summary.approvalRate}%` }}
                    className="bg-uh-success flex items-center justify-center text-white text-[10px] font-bold"
                  >
                    {summary.approvalRate >= 15 ? `${summary.approvalRate}%` : ''}
                  </div>
                )}
                {summary.flagged > 0 && (
                  <div
                    style={{ width: `${100 - summary.approvalRate}%` }}
                    className="bg-uh-error flex items-center justify-center text-white text-[10px] font-bold"
                  >
                    {100 - summary.approvalRate >= 15 ? `${100 - summary.approvalRate}%` : ''}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-uh-success inline-block" /> Approved ({summary.approved})</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-uh-error inline-block" /> Flagged ({summary.flagged})</span>
              </div>
            </div>

            {/* Per-agent breakdown */}
            <div className="card lg:col-span-2">
              <h2 className="text-sm font-semibold text-slate-500 mb-3 flex items-center gap-2">
                <AlertTriangle size={14} /> Per-Agent QC Accuracy
              </h2>
              {agentRows.length === 0 ? (
                <p className="text-slate-400 text-sm">No agent data</p>
              ) : (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {agentRows.map(row => {
                    const rate = Math.round((row.approved / row.total) * 100);
                    const name = row.agent.split('@')[0].replace(/[._]/g, ' ');
                    return (
                      <div key={row.agent} className="flex items-center gap-3">
                        <Link
                          to={`/agent/${encodeURIComponent(row.agent)}`}
                          className="text-sm text-uh-cyan hover:underline capitalize w-36 truncate shrink-0"
                        >
                          {name}
                        </Link>
                        <div className="flex-1 flex rounded-full overflow-hidden h-3">
                          {row.approved > 0 && (
                            <div style={{ width: `${rate}%` }} className="bg-uh-success" />
                          )}
                          {row.flagged > 0 && (
                            <div style={{ width: `${100 - rate}%` }} className="bg-uh-error" />
                          )}
                        </div>
                        <span className="text-xs text-slate-500 w-12 text-right shrink-0">
                          {rate}% OK
                        </span>
                        <span className="text-xs text-slate-400 w-16 text-right shrink-0">
                          {row.approved}✓ {row.flagged}✗
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* All reviews table */}
          <div className="card">
            <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
              <h2 className="text-lg font-semibold">
                All Reviewed Tickets
                <span className="ml-2 text-sm font-normal text-slate-400">
                  {reviews.length}{reviews.length !== allReviews.length ? ` of ${allReviews.length}` : ''}
                </span>
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filter by date (YYYY-MM-DD)"
                    value={dateFilter}
                    onChange={e => setDateFilter(e.target.value)}
                    className="pl-7 pr-7 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-uh-purple w-52 transition-colors"
                  />
                  {dateFilter && (
                    <button onClick={() => setDateFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filter by agent"
                    value={agentFilter}
                    onChange={e => setAgentFilter(e.target.value)}
                    className="pl-7 pr-7 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-uh-purple w-40 transition-colors"
                  />
                  {agentFilter && (
                    <button onClick={() => setAgentFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs border-b border-slate-200">
                    <th className="pb-3 pr-4">Ticket</th>
                    <th className="pb-3 px-4">Subject</th>
                    <th className="pb-3 px-4">Agent</th>
                    <th className="pb-3 px-4">CSAT</th>
                    <th className="pb-3 px-4">Date</th>
                    <th className="pb-3 px-4">QC Status</th>
                    <th className="pb-3 px-4">Reviewed By</th>
                    <th className="pb-3 pl-4">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r: any) => (
                    <tr key={r.ticketId} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="py-3 pr-4">
                        <Link to={`/ticket/${r.ticketId}`} className="text-uh-cyan hover:underline font-mono text-xs">
                          #{r.ticketId}
                        </Link>
                      </td>
                      <td className="py-3 px-4 max-w-[220px]">
                        <span className="text-xs truncate block" title={r.subject || ''}>
                          {r.subject ? (r.subject.length > 40 ? r.subject.substring(0, 40) + '…' : r.subject) : '-'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {r.agentEmail ? (
                          <Link
                            to={`/agent/${encodeURIComponent(r.agentEmail)}`}
                            className="text-xs text-slate-600 hover:text-uh-cyan capitalize"
                          >
                            {r.agentEmail.split('@')[0].replace(/[._]/g, ' ')}
                          </Link>
                        ) : (
                          <span className="text-slate-300 text-xs">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {r.csat ? (
                          <span className={`text-xs font-medium ${r.csat < 3 ? 'text-uh-error' : 'text-uh-success'}`}>
                            {r.csat}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-400">{r.day || '-'}</td>
                      <td className="py-3 px-4">
                        {r.status === 'approved' ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-uh-success/20 text-uh-success w-fit">
                            <ThumbsUp size={10} /> Approved
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-uh-error/20 text-uh-error w-fit">
                            <Flag size={10} /> Flagged
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {r.reviewerName ? (
                          <span className="text-xs font-medium text-slate-700">{r.reviewerName}</span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 pl-4">
                        {r.note ? (
                          <span className="flex items-start gap-1 text-xs text-slate-500 max-w-[200px]" title={r.note}>
                            <MessageSquare size={11} className="mt-0.5 shrink-0 text-slate-400" />
                            <span className="truncate">{r.note}</span>
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
