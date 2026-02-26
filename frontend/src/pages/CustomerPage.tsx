import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Mail, Ticket, Star, Users } from 'lucide-react';
import ScoreBadge from '../components/common/ScoreBadge';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { customersApi } from '../api/client';

export default function CustomerPage() {
  const { email } = useParams<{ email: string }>();
  const decodedEmail = decodeURIComponent(email || '');

  const { data, isLoading } = useQuery({
    queryKey: ['customer-history', decodedEmail],
    queryFn: () => customersApi.getHistory(decodedEmail),
    enabled: !!decodedEmail,
  });

  const history = data?.data;
  const tickets = history?.tickets || [];

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <LoadingSpinner text="Loading customer history..." />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => window.history.back()}
          className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-all"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Customer History</h1>
          <div className="flex items-center gap-2 text-slate-500 mt-1">
            <Mail size={14} />
            <span className="text-sm">{decodedEmail}</span>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-uh-purple/20">
              <Ticket size={20} className="text-uh-purple" />
            </div>
            <div>
              <p className="text-slate-500 text-sm">Total Tickets</p>
              <p className="text-2xl font-bold">{history?.totalTickets || 0}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-uh-cyan/20">
              <Star size={20} className="text-uh-cyan" />
            </div>
            <div>
              <p className="text-slate-500 text-sm">Avg CSAT</p>
              <div className="mt-1">
                <ScoreBadge
                  score={history?.avgCsat ? history.avgCsat * 20 : null}
                  size="md"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-uh-success/20">
              <Users size={20} className="text-uh-success" />
            </div>
            <div>
              <p className="text-slate-500 text-sm">Agents Involved</p>
              <p className="text-2xl font-bold">
                {Object.keys(history?.agentSummary || {}).length}
              </p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-uh-warning/20">
              <Ticket size={20} className="text-uh-warning" />
            </div>
            <div>
              <p className="text-slate-500 text-sm">Low CSAT</p>
              <p className="text-2xl font-bold text-uh-error">
                {tickets.filter((t: any) => t.TICKET_CSAT > 0 && t.TICKET_CSAT < 3).length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Agent Summary */}
      {history?.agentSummary && Object.keys(history.agentSummary).length > 0 && (
        <div className="card mb-8">
          <h2 className="text-lg font-semibold mb-4">Agents Who Handled This Customer</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(history.agentSummary).map(([agent, count]: [string, any]) => (
              <Link
                key={agent}
                to={`/agent/${encodeURIComponent(agent)}`}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-uh-purple/30 transition-all"
              >
                <span className="text-sm">{agent.split('@')[0]}</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-uh-purple/20 text-uh-purple">
                  {count} tickets
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Ticket Timeline */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Ticket History</h2>
        {tickets.length === 0 ? (
          <p className="text-slate-400 text-center py-8">No tickets found</p>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-100" />

            <div className="space-y-4">
              {tickets.map((ticket: any) => (
                <div key={ticket.TICKET_ID} className="relative pl-10">
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-2.5 w-3 h-3 rounded-full ${
                      ticket.TICKET_CSAT > 0 && ticket.TICKET_CSAT < 3
                        ? 'bg-uh-error'
                        : 'bg-uh-purple'
                    }`}
                  />

                  <Link
                    to={`/ticket/${ticket.TICKET_ID}`}
                    className="block p-4 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-100 hover:border-uh-purple/30 transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-uh-cyan font-mono text-sm">
                            #{ticket.TICKET_ID}
                          </span>
                          <span className="text-xs text-slate-400">
                            {ticket.DAY}
                          </span>
                          {ticket.TICKET_CSAT > 0 && ticket.TICKET_CSAT < 3 && (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-uh-error/20 text-uh-error">
                              Low CSAT
                            </span>
                          )}
                        </div>
                        <p className="text-sm line-clamp-2">{ticket.SUBJECT}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                          <span>{ticket.TICKET_STATUS}</span>
                          <span>Agent: {ticket.AGENT_EMAIL?.split('@')[0]}</span>
                          <span>CSAT: {ticket.TICKET_CSAT || 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
