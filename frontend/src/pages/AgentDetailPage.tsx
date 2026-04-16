import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Mail, Ticket, Clock, CheckCircle, AlertTriangle, Calendar, CalendarCheck, ThumbsUp, Flag } from 'lucide-react';
import DatePicker from '../components/common/DatePicker';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { agentsApi, analysisApi } from '../api/client';
import type { DateMode } from '../api/client';
export default function AgentDetailPage() {
  const { email } = useParams<{ email: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Fetch available dates to get a valid fallback
  const { data: datesData } = useQuery({
    queryKey: ['dates'],
    queryFn: () => agentsApi.getDates(),
    staleTime: 1000 * 60 * 60,
  });
  const latestDate = datesData?.data?.dates?.[0] || '';
  const date = searchParams.get('date') || latestDate;
  const dateMode = (searchParams.get('dateMode') as DateMode) || 'activity';

  const decodedEmail = decodeURIComponent(email || '');
  const agentName = decodedEmail.split('@')[0].replace(/[._]/g, ' ').replace(/_ext$/, '');

  // Fetch agent's tickets
  const { data: ticketsData, isLoading: ticketsLoading } = useQuery({
    queryKey: ['agent-tickets', decodedEmail, date, dateMode],
    queryFn: () => agentsApi.getTickets(decodedEmail, date, 500, dateMode),
    enabled: !!decodedEmail && !!date,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  const handleDateChange = (newDate: string) => {
    setSearchParams({ date: newDate, dateMode });
  };

  const handleDateModeChange = (newMode: DateMode) => {
    setSearchParams({ date, dateMode: newMode });
  };

  const tickets = ticketsData?.data?.tickets || [];

  // Fetch review statuses for all loaded tickets
  const ticketIds = tickets.map((t: any) => String(t.TICKET_ID));
  const { data: reviewsData } = useQuery({
    queryKey: ['reviews', ticketIds.join(',')],
    queryFn: () => analysisApi.getReviews(ticketIds),
    enabled: ticketIds.length > 0,
    staleTime: 1000 * 60 * 5,
  });
  const reviews: Record<string, { status: string; note: string | null }> = reviewsData?.data?.reviews || {};

  // Calculate stats
  const totalTickets = tickets.length;
  const resolvedCount = tickets.filter((t: any) => t.TICKET_STATUS === 'RESOLVED').length;

  // Calculate avg response time, filtering out invalid values
  const validResponseTimes: number[] = tickets
    .map((t: any) => {
      const val = Number(t.FIRST_RESPONSE_DURATION_SECONDS);
      return isNaN(val) ? null : val;
    })
    .filter((t: number | null): t is number => t !== null && t > 0 && t < 86400); // 0 < t < 24 hours
  const avgResponseTime = validResponseTimes.length > 0
    ? Math.round(validResponseTimes.reduce((a: number, b: number) => a + b, 0) / validResponseTimes.length)
    : null;

  const lowCsatCount = tickets.filter((t: any) => t.TICKET_CSAT && t.TICKET_CSAT > 0 && t.TICKET_CSAT < 3).length;

  // Group by subject for issue breakdown
  const issueBreakdown = tickets.reduce((acc: Record<string, number>, t: any) => {
    const subject = t.SUBJECT || 'Unknown';
    acc[subject] = (acc[subject] || 0) + 1;
    return acc;
  }, {});

  const sortedIssues = Object.entries(issueBreakdown)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 15) as [string, number][];

  const formatTime = (seconds: number | null) => {
    if (seconds === null || seconds === undefined) return '-';
    const num = Number(seconds);
    if (isNaN(num) || !isFinite(num) || num <= 0 || num > 86400) return '-';
    if (num < 60) return `${Math.round(num)}s`;
    if (num < 3600) return `${Math.round(num / 60)}m`;
    return `${(num / 3600).toFixed(1)}h`;
  };

  const ReviewBadge = ({ ticketId }: { ticketId: string }) => {
    const r = reviews[ticketId] as any;
    if (!r) return null;
    const tooltip = [
      r.reviewerName ? `By: ${r.reviewerName}` : null,
      r.note || null,
    ].filter(Boolean).join(' · ') || (r.status === 'approved' ? 'Approved' : 'Flagged');
    return r.status === 'approved' ? (
      <span title={tooltip} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-uh-success/20 text-uh-success">
        <ThumbsUp size={9} /> QC OK
      </span>
    ) : (
      <span title={tooltip} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-uh-error/20 text-uh-error">
        <Flag size={9} /> Flagged
      </span>
    );
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          to="/"
          className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-all"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold capitalize">{agentName}</h1>
          <div className="flex items-center gap-2 text-slate-500 mt-1">
            <Mail size={14} />
            <span className="text-sm">{decodedEmail}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Date Mode Toggle */}
          <div className="flex items-center bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => handleDateModeChange('initialized')}
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
              onClick={() => handleDateModeChange('activity')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                dateMode === 'activity'
                  ? 'bg-uh-purple text-white'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Count tickets by when they had activity/resolved (includes carry-overs)"
            >
              <CalendarCheck size={14} />
              <span>Activity</span>
            </button>
          </div>
          <DatePicker selectedDate={date} onDateChange={handleDateChange} />
        </div>
      </div>

      {ticketsLoading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner text="Loading agent data..." />
        </div>
      ) : (
        <>
          {/* Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="card flex items-center gap-4">
              <div className="p-3 rounded-xl bg-uh-purple/20">
                <Ticket size={24} className="text-uh-purple" />
              </div>
              <div>
                <p className="text-slate-500 text-sm">Total Tickets</p>
                <p className="text-3xl font-bold">{totalTickets}</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="p-3 rounded-xl bg-uh-success/20">
                <CheckCircle size={24} className="text-uh-success" />
              </div>
              <div>
                <p className="text-slate-500 text-sm">Resolved</p>
                <p className="text-3xl font-bold">{resolvedCount}</p>
                <p className="text-xs text-slate-400">
                  {totalTickets > 0 ? Math.round((resolvedCount / totalTickets) * 100) : 0}%
                </p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="p-3 rounded-xl bg-uh-cyan/20">
                <Clock size={24} className="text-uh-cyan" />
              </div>
              <div>
                <p className="text-slate-500 text-sm">Avg Response</p>
                <p className="text-3xl font-bold">{formatTime(avgResponseTime)}</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="p-3 rounded-xl bg-uh-error/20">
                <AlertTriangle size={24} className="text-uh-error" />
              </div>
              <div>
                <p className="text-slate-500 text-sm">Low CSAT</p>
                <p className="text-3xl font-bold">{lowCsatCount}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Issue Breakdown */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">Issue Breakdown</h2>
              {sortedIssues.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No tickets found</p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {sortedIssues.map(([subject, count], idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-all"
                    >
                      <span className="text-sm truncate flex-1 mr-4" title={subject}>
                        {subject.length > 60 ? subject.substring(0, 60) + '...' : subject}
                      </span>
                      <span className="px-3 py-1 rounded-full text-sm font-semibold bg-uh-purple/20 text-uh-purple">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Tickets */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">Recent Tickets</h2>
              {tickets.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No tickets found for this date</p>
              ) : (
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {tickets.slice(0, 20).map((ticket: any) => (
                    <Link
                      key={ticket.TICKET_ID}
                      to={`/ticket/${ticket.TICKET_ID}`}
                      className="block p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors duration-md3 ease-md3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-uh-cyan font-mono text-xs">
                              #{ticket.TICKET_ID}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              ticket.TICKET_STATUS === 'RESOLVED'
                                ? 'bg-uh-success/20 text-uh-success'
                                : 'bg-uh-warning/20 text-uh-warning'
                            }`}>
                              {ticket.TICKET_STATUS}
                            </span>
                            <ReviewBadge ticketId={String(ticket.TICKET_ID)} />
                          </div>
                          <p className="text-sm mt-1 truncate">{ticket.SUBJECT}</p>
                          <p className="text-xs text-slate-400 mt-1 truncate">
                            {ticket.VISITOR_EMAIL}
                          </p>
                        </div>
                        <div className="text-right text-xs text-slate-400">
                          <p>{formatTime(ticket.FIRST_RESPONSE_DURATION_SECONDS || 0)}</p>
                          {ticket.TICKET_CSAT && ticket.TICKET_CSAT !== 'NA' && (
                            <p className={ticket.TICKET_CSAT < 3 ? 'text-uh-error' : 'text-uh-success'}>
                              CSAT: {ticket.TICKET_CSAT}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Full Tickets Table */}
          <div className="card mt-6">
            <h2 className="text-lg font-semibold mb-4">All Tickets ({totalTickets})</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-slate-500 text-sm">
                    <th className="pb-3 pr-4">Ticket ID</th>
                    <th className="pb-3 px-4">Subject</th>
                    <th className="pb-3 px-4">Customer</th>
                    <th className="pb-3 px-4">Status</th>
                    <th className="pb-3 px-4">Response</th>
                    <th className="pb-3 px-4">CSAT</th>
                    <th className="pb-3 pl-4">QC Review</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.slice(0, 50).map((ticket: any) => (
                    <tr
                      key={ticket.TICKET_ID}
                      className="hover:bg-slate-50 transition-colors rounded-lg"
                    >
                      <td className="py-3 pr-4">
                        <Link
                          to={`/ticket/${ticket.TICKET_ID}`}
                          className="text-uh-cyan hover:underline font-mono text-sm"
                        >
                          #{ticket.TICKET_ID}
                        </Link>
                      </td>
                      <td className="py-3 px-4 max-w-[300px]">
                        <span className="text-sm truncate block" title={ticket.SUBJECT}>
                          {ticket.SUBJECT?.length > 50
                            ? ticket.SUBJECT.substring(0, 50) + '...'
                            : ticket.SUBJECT}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          to={`/customer/${encodeURIComponent(ticket.VISITOR_EMAIL)}`}
                          className="text-xs text-slate-500 hover:text-uh-cyan"
                        >
                          {ticket.VISITOR_EMAIL?.length > 30
                            ? ticket.VISITOR_EMAIL.substring(0, 30) + '...'
                            : ticket.VISITOR_EMAIL}
                        </Link>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded text-xs ${
                          ticket.TICKET_STATUS === 'RESOLVED'
                            ? 'bg-uh-success/20 text-uh-success'
                            : 'bg-uh-warning/20 text-uh-warning'
                        }`}>
                          {ticket.TICKET_STATUS}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-500">
                        {formatTime(ticket.FIRST_RESPONSE_DURATION_SECONDS || 0)}
                      </td>
                      <td className="py-3 px-4">
                        {ticket.TICKET_CSAT && ticket.TICKET_CSAT !== 'NA' ? (
                          <span className={`text-sm font-medium ${
                            ticket.TICKET_CSAT < 3 ? 'text-uh-error' : 'text-uh-success'
                          }`}>
                            {ticket.TICKET_CSAT}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-sm">-</span>
                        )}
                      </td>
                      <td className="py-3 pl-4">
                        <ReviewBadge ticketId={String(ticket.TICKET_ID)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tickets.length > 50 && (
                <p className="text-center text-slate-400 text-sm mt-4">
                  Showing 50 of {tickets.length} tickets
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
