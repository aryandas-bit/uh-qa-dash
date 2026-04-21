import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Calendar,
  CalendarCheck,
  CheckCircle,
  Copy,
  ChevronDown,
  ClipboardCheck,
  Download,
  FileText,
  Flag,
  Layers3,
  Loader2,
  Mail,
  Skull,
  Sparkles,
  ThumbsUp,
  Ticket,
  TrendingDown,
} from 'lucide-react';
import DatePicker from '../components/common/DatePicker';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { agentsApi, analysisApi, dailyPicksApi } from '../api/client';
import type { DateMode } from '../api/client';
import AgentTrendSparkline from '../components/agent/AgentTrendSparkline';
import { useDateStore } from '../store/dateStore';
import { getAvatarColor, getAvatarInitial } from '../utils/avatarColors';

interface AgentTicketRow {
  TICKET_ID: string;
  SUBJECT: string;
  VISITOR_EMAIL: string;
  TICKET_STATUS: string;
  FIRST_RESPONSE_DURATION_SECONDS: number | null;
  TICKET_CSAT: number | string | null;
}

interface ScoreEntry {
  qaScore: number;
  summary: string | null;
  deductions: Array<{ category: string; points: number; reason: string }>;
}

interface QAReview {
  status: 'approved' | 'flagged';
  note: string | null;
  reviewerName?: string | null;
  reviewedAt?: string;
}

interface AgentDailyPick {
  ticketId: string;
  agentEmail: string;
  pickOrder: number;
  pickReason?: string | null;
  analyzed: boolean;
  analysisStatus?: string | null;
  riskScore?: number | null;
  ticket?: {
    subject: string | null;
    customerEmail: string | null;
    status: string | null;
    groupName: string | null;
    responseTimeSeconds: number | null;
    hasStoredAnalysis: boolean;
  } | null;
}

interface ReportCard {
  overallAssessment: string;
  summary: string;
  sample: {
    requiredCount: number;
    auditedCount: number;
    reviewedCount: number;
    approvedCount: number;
    flaggedCount: number;
    avgQaScore: number;
  };
  dailyPerformance: {
    totalTickets: number;
    resolvedCount: number;
    avgResponseTime: number | null;
    lowCsatCount: number;
  };
  strengths: string[];
  coachingPriorities: string[];
  topDeductionCategories: Array<{ category: string; label: string; count: number }>;
  topIssues: Array<{ subject: string; count: number }>;
  flaggedTickets: Array<{
    ticketId: string;
    subject: string;
    qaScore: number | null;
    reviewNote: string | null;
    deductionSummary: string | null;
  }>;
  reviewedSample: Array<{
    ticketId: string;
    pickOrder: number;
    pickReason: string | null;
    subject: string | null;
    qaScore: number | null;
    reviewStatus: string | null;
    reviewNote: string | null;
  }>;
}

function formatTime(seconds: number | null) {
  if (seconds === null || seconds === undefined) return '-';
  const num = Number(seconds);
  if (Number.isNaN(num) || !Number.isFinite(num) || num <= 0 || num > 86400) return '-';
  if (num < 60) return `${Math.round(num)}s`;
  if (num < 3600) return `${Math.round(num / 60)}m`;
  return `${(num / 3600).toFixed(1)}h`;
}

function isResolvedStatus(status: unknown) {
  return String(status || '').trim().toLowerCase() === 'resolved';
}

function formatAgentName(email?: string) {
  if (!email) return 'Unknown Agent';
  return email
    .split('@')[0]
    .replace(/_ext$/, '')
    .replace(/[._]/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function AgentDetailPage() {
  const { email } = useParams<{ email: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [reportCard, setReportCard] = useState<ReportCard | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [insightsEnabled, setInsightsEnabled] = useState(false);
  const { selectedDate, setSelectedDate, dateMode: storeDateMode, setDateMode: setStoreDateMode } = useDateStore();

  const { data: datesData } = useQuery({
    queryKey: ['dates'],
    queryFn: () => agentsApi.getDates(),
    staleTime: 1000 * 60 * 60,
  });
  const latestDate = datesData?.data?.dates?.[0] || '';

  const urlDate = searchParams.get('date');
  const urlDateMode = searchParams.get('dateMode') as DateMode;
  const date = urlDate || selectedDate || latestDate;
  const dateMode = urlDateMode || storeDateMode || 'activity';
  const decodedEmail = decodeURIComponent(email || '');
  const agentName = decodedEmail.split('@')[0].replace(/[._]/g, ' ').replace(/_ext$/, '');

  useEffect(() => {
    if (urlDate && urlDate !== selectedDate) setSelectedDate(urlDate);
    if (urlDateMode && urlDateMode !== storeDateMode) setStoreDateMode(urlDateMode);
  }, [urlDate, urlDateMode, selectedDate, storeDateMode, setSelectedDate, setStoreDateMode]);

  useEffect(() => {
    if (!latestDate || urlDate) return;
    const available: string[] = datesData?.data?.dates || [];
    if (!selectedDate || (available.length > 0 && !available.includes(selectedDate))) {
      setSelectedDate(latestDate);
    }
  }, [latestDate, selectedDate, urlDate, datesData, setSelectedDate]);

  useEffect(() => {
    setInsightsEnabled(false);
  }, [decodedEmail, date, dateMode]);

  const { data: ticketsData, isLoading: ticketsLoading } = useQuery({
    queryKey: ['agent-tickets', decodedEmail, date, dateMode],
    queryFn: () => agentsApi.getTickets(decodedEmail, date, 500, dateMode),
    enabled: !!decodedEmail && !!date,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  const { data: picksData } = useQuery({
    queryKey: ['daily-picks', date, dateMode, decodedEmail],
    queryFn: () => dailyPicksApi.getPicks(date, dateMode, decodedEmail, false).then((response) => response.data),
    enabled: !!date && !!decodedEmail,
    staleTime: 1000 * 10,
    refetchInterval: (query) => ((query.state.data as any)?.inProgress ? 3000 : false),
  });

  const { data: auditStatusData } = useQuery({
    queryKey: ['daily-picks-status', date, dateMode, decodedEmail],
    queryFn: () => dailyPicksApi.getStatus(date, dateMode, decodedEmail).then((response) => response.data),
    enabled: !!date && !!decodedEmail,
    staleTime: 0,
    refetchInterval: (query) => ((query.state.data as any)?.inProgress ? 2000 : false),
  });

  const tickets: AgentTicketRow[] = ticketsData?.data?.tickets || [];
  const relevantTicketIds = tickets
    .filter((ticket) => isResolvedStatus(ticket.TICKET_STATUS))
    .map((ticket) => String(ticket.TICKET_ID));

  // Include sample pick IDs in score queries — picks may include non-resolved tickets
  const sampleTicketIdsForQuery = (picksData?.picks || []).map((p: any) => String(p.ticketId));
  const scoreQueryIds = [...new Set([...relevantTicketIds, ...sampleTicketIdsForQuery])];

  const { data: reviewsData } = useQuery({
    queryKey: ['reviews', relevantTicketIds.join(',')],
    queryFn: () => analysisApi.getReviews(relevantTicketIds),
    enabled: relevantTicketIds.length > 0,
    staleTime: 1000 * 10,
  });
  const reviews: Record<string, QAReview> = reviewsData?.data?.reviews || {};

  const { data: scoresData } = useQuery({
    queryKey: ['cached-scores', scoreQueryIds.join(',')],
    queryFn: () => analysisApi.getCachedScores(scoreQueryIds),
    enabled: scoreQueryIds.length > 0,
    staleTime: 1000 * 10,
    // Poll while audit is running or picks exist (catches delayed score saves after mutation)
    refetchInterval: (auditStatusData?.inProgress || sampleTicketIdsForQuery.length > 0) ? 4000 : false,
  });
  const cachedScores: Record<string, ScoreEntry> = scoresData?.data?.scores || {};
  const fallbackIds: Set<string> = new Set(scoresData?.data?.fallbackIds || []);

  const { data: insightsData, isFetching: insightsFetching } = useQuery({
    queryKey: ['agent-insights', decodedEmail, date, dateMode, sampleTicketIdsForQuery.join(',')],
    queryFn: () => analysisApi.getAgentInsights(decodedEmail, date, dateMode, sampleTicketIdsForQuery.length > 0 ? sampleTicketIdsForQuery : undefined),
    enabled: !!decodedEmail && !!date && insightsEnabled,
    staleTime: 1000 * 60,
  });
  const insightsResult = insightsData?.data;

  const { data: trendData } = useQuery({
    queryKey: ['agent-qa-trend', decodedEmail],
    queryFn: () => agentsApi.getQATrend(decodedEmail, 30),
    enabled: !!decodedEmail,
    staleTime: 1000 * 60 * 5,
  });
  const trend = trendData?.data?.trend || [];

  const handleDateChange = (newDate: string) => {
    setSearchParams({ date: newDate, dateMode });
    setSelectedDate(newDate);
    setReportCard(null);
  };

  const handleDateModeChange = (newMode: DateMode) => {
    setSearchParams({ date, dateMode: newMode });
    setStoreDateMode(newMode);
    setReportCard(null);
  };

  const samplePicks: AgentDailyPick[] = [...(picksData?.picks || [])].sort((left, right) => left.pickOrder - right.pickOrder);
  const sampleIdSet = new Set(samplePicks.map((pick) => String(pick.ticketId)));

  const sampleRows = samplePicks.map((pick) => {
    const ticket = tickets.find((candidate) => String(candidate.TICKET_ID) === String(pick.ticketId));
    return {
      pick,
      ticket,
      score: cachedScores[String(pick.ticketId)],
      review: reviews[String(pick.ticketId)],
    };
  });

  const otherResolvedTickets = tickets.filter((ticket) => (
    isResolvedStatus(ticket.TICKET_STATUS) && !sampleIdSet.has(String(ticket.TICKET_ID))
  ));

  const totalTickets = tickets.length;
  const resolvedCount = tickets.filter((ticket) => isResolvedStatus(ticket.TICKET_STATUS)).length;

  const issueBreakdown = sampleRows.reduce<Record<string, number>>((acc, row) => {
    const subject = row.pick.ticket?.subject || 'Unknown';
    acc[subject] = (acc[subject] || 0) + 1;
    return acc;
  }, {});
  const sortedIssues = Object.entries(issueBreakdown)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 15) as [string, number][];

  const sampleAuditedCount = sampleRows.filter((row) => row.score).length;
  const auditedScores = sampleRows.filter((row) => row.score).map((row) => row.score!.qaScore);
  const sampleAvgQaScore = auditedScores.length > 0
    ? Math.round(auditedScores.reduce((sum, s) => sum + s, 0) / auditedScores.length)
    : null;
  const sampleReviewedCount = sampleRows.filter((row) => row.review).length;
  const sampleApprovedCount = sampleRows.filter((row) => row.review?.status === 'approved').length;
  const sampleFlaggedCount = sampleRows.filter((row) => row.review?.status === 'flagged').length;
  const reportReady = sampleAuditedCount > 0;

  const auditNowMutation = useMutation({
    mutationFn: async () => {
      const response = await dailyPicksApi.runAudit(date, dateMode, {
        agentEmail: decodedEmail,
        count: 10,
        randomizeSample: true,
      });
      return response.data;
    },
    onSuccess: async () => {
      setReportCard(null);
      setInsightsEnabled(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['daily-picks', date, dateMode, decodedEmail] }),
        queryClient.invalidateQueries({ queryKey: ['daily-picks-status', date, dateMode, decodedEmail] }),
        queryClient.invalidateQueries({ queryKey: ['cached-scores'] }),
        queryClient.invalidateQueries({ queryKey: ['reviews'] }),
        queryClient.invalidateQueries({ queryKey: ['agent-insights'] }),
      ]);
    },
  });

  const reportCardMutation = useMutation({
    mutationFn: async () => {
      const response = await agentsApi.getReportCard(decodedEmail, date, dateMode);
      return response.data as ReportCard;
    },
    onSuccess: (data) => {
      setReportCard(data);
    },
  });

  const buildReportCardMarkdown = (card: ReportCard) => {
    const lines = [
      `# Daily QA Report Card`,
      ``,
      `- Agent: ${formatAgentName(decodedEmail)} (${decodedEmail})`,
      `- Date: ${date}`,
      `- Date Mode: ${dateMode}`,
      `- Overall Assessment: ${card.overallAssessment}`,
      ``,
      `## Summary`,
      card.summary,
      ``,
      `## Sample Metrics`,
      `- Required Sample Size: ${card.sample.requiredCount}`,
      `- Audited: ${card.sample.auditedCount}`,
      `- Reviewed: ${card.sample.reviewedCount}`,
      `- Approved: ${card.sample.approvedCount}`,
      `- Flagged: ${card.sample.flaggedCount}`,
      `- Average QA Score: ${card.sample.avgQaScore}`,
      ``,
      `## Daily Performance`,
      `- Total Tickets: ${card.dailyPerformance.totalTickets}`,
      `- Resolved Tickets: ${card.dailyPerformance.resolvedCount}`,
      `- Average Response Time: ${formatTime(card.dailyPerformance.avgResponseTime)}`,
      `- Low CSAT Count: ${card.dailyPerformance.lowCsatCount}`,
      ``,
      `## Strengths`,
      ...card.strengths.map((item) => `- ${item}`),
      ``,
      `## Coaching Priorities`,
      ...card.coachingPriorities.map((item) => `- ${item}`),
      ``,
      `## Top Miss Categories`,
      ...(card.topDeductionCategories.length > 0
        ? card.topDeductionCategories.map((item) => `- ${item.label}: ${item.count}`)
        : ['- None']),
      ``,
      `## Top Issues`,
      ...(card.topIssues.length > 0
        ? card.topIssues.map((item) => `- ${item.subject}: ${item.count}`)
        : ['- None']),
      ``,
      `## Flagged Tickets`,
      ...(card.flaggedTickets.length > 0
        ? card.flaggedTickets.flatMap((item) => [
            `- Ticket #${item.ticketId}: ${item.subject}`,
            `  - QA Score: ${item.qaScore ?? '—'}`,
            `  - Review Note: ${item.reviewNote || '—'}`,
            `  - Deduction Summary: ${item.deductionSummary || '—'}`,
          ])
        : ['- None']),
      ``,
      `## Reviewed Sample`,
      ...card.reviewedSample.flatMap((item) => [
        `- Pick ${item.pickOrder} | Ticket #${item.ticketId} | ${item.subject || 'No subject'}`,
        `  - Pick Reason: ${item.pickReason || '—'}`,
        `  - QA Score: ${item.qaScore ?? '—'}`,
        `  - Review Status: ${item.reviewStatus || '—'}`,
        `  - Review Note: ${item.reviewNote || '—'}`,
      ]),
    ];

    return lines.join('\n');
  };

  const handleDownloadReportCard = () => {
    if (!reportCard) return;
    const content = buildReportCardMarkdown(reportCard);
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${decodedEmail.split('@')[0]}-${date}-${dateMode}-report-card.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleCopyReportCard = async () => {
    if (!reportCard) return;
    try {
      await navigator.clipboard.writeText(buildReportCardMarkdown(reportCard));
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error('Failed to copy report card:', error);
    }
  };

  const ReviewBadge = ({ ticketId }: { ticketId: string }) => {
    const review = reviews[ticketId];
    if (!review) return null;

    const tooltip = [
      review.reviewerName ? `By: ${review.reviewerName}` : null,
      review.note || null,
    ].filter(Boolean).join(' · ') || (review.status === 'approved' ? 'Approved' : 'Flagged');

    return review.status === 'approved' ? (
      <span title={tooltip} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-uh-success/20 text-uh-success">
        <ThumbsUp size={10} /> QC OK
      </span>
    ) : (
      <span title={tooltip} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-uh-error/20 text-uh-error">
        <Flag size={10} /> Flagged
      </span>
    );
  };

  const ScorePill = ({ ticketId }: { ticketId: string }) => {
    const score = cachedScores[ticketId];
    if (!score) return <span className="text-slate-300 text-sm">—</span>;

    const scoreColor =
      score.qaScore >= 80
        ? 'bg-uh-success/20 text-uh-success'
        : score.qaScore >= 60
        ? 'bg-uh-warning/20 text-uh-warning'
        : 'bg-uh-error/20 text-uh-error';

    return (
      <span title={score.summary || ''} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${scoreColor}`}>
        {Math.round(score.qaScore)}
      </span>
    );
  };

  if (ticketsLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner text="Loading agent data..." />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <Link to="/tickets" className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-all">
          <ArrowLeft size={20} />
        </Link>
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0"
          style={{ background: getAvatarColor(agentName).bg, color: getAvatarColor(agentName).fg }}
        >
          {getAvatarInitial(agentName)}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold capitalize">{agentName}</h1>
          <div className="flex items-center gap-2 text-slate-500 mt-1">
            <Mail size={14} />
            <span className="text-sm">{decodedEmail}</span>
          </div>
        </div>
        <div className="hidden lg:flex items-center gap-4 px-6 border-x border-slate-100 mx-4 h-12">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">QA Trend (30d)</p>
            <div className="w-32 h-8">
              <AgentTrendSparkline data={trend} showTooltip />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => handleDateModeChange('initialized')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                dateMode === 'initialized' ? 'bg-uh-purple text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Calendar size={14} />
              <span>Created</span>
            </button>
            <button
              onClick={() => handleDateModeChange('activity')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                dateMode === 'activity' ? 'bg-uh-purple text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <CalendarCheck size={14} />
              <span>Activity</span>
            </button>
          </div>
          <DatePicker selectedDate={date} onDateChange={handleDateChange} />
        </div>
      </div>

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
          <div className="p-3 rounded-xl bg-uh-purple/20">
            <Sparkles size={24} className="text-uh-purple" />
          </div>
          <div>
            <p className="text-slate-500 text-sm">Avg QA Score</p>
            <p className={`text-3xl font-bold ${
              sampleAvgQaScore === null ? 'text-slate-300' :
              sampleAvgQaScore >= 80 ? 'text-uh-success' :
              sampleAvgQaScore >= 60 ? 'text-uh-warning' : 'text-uh-error'
            }`}>
              {sampleAvgQaScore ?? '—'}
            </p>
            <p className="text-xs text-slate-400">audited sample</p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="p-3 rounded-xl bg-uh-cyan/20">
            <ClipboardCheck size={24} className="text-uh-cyan" />
          </div>
          <div>
            <p className="text-slate-500 text-sm">Audited Today</p>
            <p className="text-3xl font-bold">{sampleAuditedCount}</p>
            {sampleRows.length > 0 && (
              <p className="text-xs text-slate-400">of {sampleRows.length} sampled</p>
            )}
          </div>
        </div>
      </div>

      <div className="card mb-6 bg-gradient-to-br from-uh-purple/5 to-uh-cyan/5 border border-uh-purple/10">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-uh-purple/20 shrink-0">
            <Sparkles size={18} className="text-uh-purple" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">AI Insights</h3>
                {insightsResult?.stats && (
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">
                    Sample · {insightsResult.stats.analyzedCount}/{insightsResult.stats.totalTickets} audited
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {insightsResult?.insight && !insightsFetching && (
                  <button
                    onClick={() => {
                      queryClient.invalidateQueries({ queryKey: ['agent-insights'] });
                    }}
                    className="text-xs text-slate-400 hover:text-uh-purple transition-colors"
                  >
                    Refresh
                  </button>
                )}
                {!insightsEnabled && (
                  <button
                    onClick={() => setInsightsEnabled(true)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-uh-purple text-white hover:bg-uh-purple/90 transition-all"
                  >
                    <Sparkles size={12} />
                    Generate Insights
                  </button>
                )}
              </div>
            </div>
            {!insightsEnabled ? (
              <p className="text-sm text-slate-500">
                Click "Generate Insights" to get AI analysis of the audited sample tickets.
              </p>
            ) : insightsFetching ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 size={14} className="animate-spin text-uh-purple" />
                Analyzing audited sample...
              </div>
            ) : insightsResult?.insight ? (
              <p className="text-sm text-slate-700 leading-relaxed">{insightsResult.insight}</p>
            ) : insightsResult?.stats?.analyzedCount === 0 ? (
              <p className="text-sm text-slate-500">Audit the 10-ticket sample below to unlock day-level insights and report card generation.</p>
            ) : (
              <p className="text-sm text-slate-500">Insight unavailable right now. Try refreshing after auditing more tickets.</p>
            )}
            {insightsResult?.stats?.analyzedCount > 0 && (
              <div className="flex items-center gap-4 mt-3 text-xs flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-slate-700">Avg QA:</span>
                  <span className={`font-bold ${
                    (insightsResult.stats.avgScore ?? 0) >= 80 ? 'text-uh-success' :
                    (insightsResult.stats.avgScore ?? 0) >= 60 ? 'text-uh-warning' : 'text-uh-error'
                  }`}>
                    {insightsResult.stats.avgScore ?? '—'}
                  </span>
                </span>
                {insightsResult.stats.lowScoreCount > 0 && (
                  <span className="flex items-center gap-1 text-uh-error">
                    <TrendingDown size={12} />
                    {insightsResult.stats.lowScoreCount} low-score
                  </span>
                )}
                {insightsResult.stats.topDeductionCategories?.length > 0 && (
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-slate-500">Top misses:</span>
                    {insightsResult.stats.topDeductionCategories.slice(0, 3).map((item: any) => (
                      <span key={item.category} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] capitalize">
                        {item.category} <span className="font-semibold">×{item.count}</span>
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card mb-6 border border-uh-purple/10 bg-gradient-to-br from-white via-white to-uh-purple/5">
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Layers3 size={18} className="text-uh-purple" />
              New Daily Order
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Click "Run Audits" to generate a random 10-ticket sample, score each ticket with Gemini, and refresh AI insights scoped to this sample.
            </p>
            {auditStatusData?.inProgress && (
              <p className="text-xs text-uh-purple mt-2 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Audit is running in the background. Scores and Groq summary will update automatically.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => auditNowMutation.mutate()}
              disabled={auditNowMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm !px-4 !py-2.5 disabled:opacity-50"
            >
              {auditNowMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Run Audits
            </button>
            <button
              onClick={() => reportCardMutation.mutate()}
              disabled={!reportReady || reportCardMutation.isPending}
              className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 transition-all"
            >
              {reportCardMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
              Create Report Card
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
            {sampleRows.length} sampled
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-uh-cyan/10 text-uh-cyan">
            {sampleAuditedCount}/{sampleRows.length} audited
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-uh-purple/10 text-uh-purple">
            {sampleReviewedCount}/{sampleRows.length} verified
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-uh-success/10 text-uh-success">
            {sampleApprovedCount} approved
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-uh-error/10 text-uh-error">
            {sampleFlaggedCount} flagged
          </span>
          {!reportReady && sampleRows.length > 0 && (
            <span className="text-xs text-slate-400">
              Report card unlocks after at least one ticket is audited.
            </span>
          )}
        </div>

        {reportCardMutation.isError && (
          <div className="mb-4 p-3 rounded-xl bg-uh-error/10 text-uh-error text-sm">
            {(reportCardMutation.error as any)?.response?.data?.error || 'Failed to generate report card'}
          </div>
        )}

        {auditNowMutation.isError && (
          <div className="mb-4 p-3 rounded-xl bg-uh-error/10 text-uh-error text-sm">
            {(auditNowMutation.error as any)?.response?.data?.error || (auditNowMutation.error as Error)?.message || 'Failed to audit random sample'}
          </div>
        )}

        {sampleRows.length === 0 ? (
          <p className="text-sm text-slate-400">No daily order sample exists yet for this agent on this date. Click "Run Audits" to generate one instantly.</p>
        ) : (
          <div className="space-y-3">
            {sampleRows.map((row) => (
              <Link
                key={row.pick.ticketId}
                to={`/ticket/${row.pick.ticketId}`}
                className="block p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-uh-cyan font-mono text-xs">#{row.pick.ticketId}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-700">
                        Pick {row.pick.pickOrder}
                      </span>
                      {row.pick.pickReason && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          row.pick.pickReason === 'High Risk'
                            ? 'bg-uh-error/10 text-uh-error border border-uh-error/20'
                            : 'bg-uh-cyan/10 text-uh-cyan border border-uh-cyan/20'
                        }`}>
                          {row.pick.pickReason}
                        </span>
                      )}
                      <ReviewBadge ticketId={String(row.pick.ticketId)} />
                      {!row.review && row.score && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-uh-warning/10 text-uh-warning">
                          Review pending
                        </span>
                      )}
                      {!row.score && fallbackIds.has(String(row.pick.ticketId)) && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-uh-warning/15 text-uh-warning border border-uh-warning/30">
                          Triage-only — Gemini unavailable
                        </span>
                      )}
                      {!row.score && !fallbackIds.has(String(row.pick.ticketId)) && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-200 text-slate-500">
                          Audit pending
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {row.ticket?.SUBJECT || row.pick.ticket?.subject || 'No subject'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 truncate">
                      {row.ticket?.VISITOR_EMAIL || row.pick.ticket?.customerEmail || 'No customer email'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="mb-2">
                      <ScorePill ticketId={String(row.pick.ticketId)} />
                    </div>
                    <p className="text-xs text-slate-400">
                      {formatTime(row.ticket?.FIRST_RESPONSE_DURATION_SECONDS ?? row.pick.ticket?.responseTimeSeconds ?? null)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {reportCard && (
        <div className="card mb-6 border border-uh-cyan/20 bg-gradient-to-br from-white via-uh-cyan/5 to-white">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileText size={18} className="text-uh-cyan" />
                Daily Report Card
              </h2>
              <p className="text-sm text-slate-500 mt-1">{reportCard.summary}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleCopyReportCard}
                className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all"
              >
                <Copy size={14} />
                {copySuccess ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={handleDownloadReportCard}
                className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all"
              >
                <Download size={14} />
                Download
              </button>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                reportCard.overallAssessment === 'Excellent'
                  ? 'bg-uh-success/15 text-uh-success'
                  : reportCard.overallAssessment === 'Good'
                  ? 'bg-uh-cyan/15 text-uh-cyan'
                  : reportCard.overallAssessment === 'Needs Coaching'
                  ? 'bg-uh-warning/15 text-uh-warning'
                  : 'bg-uh-error/15 text-uh-error'
              }`}>
                {reportCard.overallAssessment}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
            <div className="p-3 rounded-xl bg-slate-50">
              <p className="text-xs text-slate-400 mb-1">Sample Avg QA</p>
              <p className="text-2xl font-bold">{reportCard.sample.avgQaScore}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50">
              <p className="text-xs text-slate-400 mb-1">Verified Sample</p>
              <p className="text-2xl font-bold">{reportCard.sample.reviewedCount}/{reportCard.sample.requiredCount}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50">
              <p className="text-xs text-slate-400 mb-1">Approved</p>
              <p className="text-2xl font-bold text-uh-success">{reportCard.sample.approvedCount}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50">
              <p className="text-xs text-slate-400 mb-1">Flagged</p>
              <p className="text-2xl font-bold text-uh-error">{reportCard.sample.flaggedCount}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Strengths</h3>
              <div className="space-y-2">
                {reportCard.strengths.map((item) => (
                  <div key={item} className="p-3 rounded-xl bg-uh-success/5 border border-uh-success/10 text-sm text-slate-700">
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Coaching Priorities</h3>
              <div className="space-y-2">
                {reportCard.coachingPriorities.map((item) => (
                  <div key={item} className="p-3 rounded-xl bg-uh-warning/5 border border-uh-warning/10 text-sm text-slate-700">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Top Miss Categories</h3>
              <div className="space-y-2">
                {reportCard.topDeductionCategories.length === 0 ? (
                  <p className="text-sm text-slate-400">No recurring miss categories in the verified sample.</p>
                ) : reportCard.topDeductionCategories.map((item) => (
                  <div key={item.category} className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
                    <span className="text-sm text-slate-700">{item.label}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-uh-purple/10 text-uh-purple">
                      ×{item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Flagged Tickets</h3>
              <div className="space-y-2">
                {reportCard.flaggedTickets.length === 0 ? (
                  <p className="text-sm text-slate-400">No flagged sample tickets in this report card.</p>
                ) : reportCard.flaggedTickets.map((item) => (
                  <Link
                    key={item.ticketId}
                    to={`/ticket/${item.ticketId}`}
                    className="block p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-all"
                  >
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-uh-cyan font-mono text-xs">#{item.ticketId}</span>
                      <span className="text-xs font-semibold text-uh-error">{item.qaScore ?? '—'}</span>
                    </div>
                    <p className="text-sm text-slate-700 truncate">{item.subject}</p>
                    {(item.reviewNote || item.deductionSummary) && (
                      <p className="text-xs text-slate-400 mt-1 truncate">{item.reviewNote || item.deductionSummary}</p>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {sampleRows.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold mb-4">Issue Breakdown</h2>
          {sortedIssues.length === 0 ? (
            <p className="text-slate-400 text-center py-8">No tickets found</p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {sortedIssues.map(([subject, count]) => (
                <div key={subject} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-all">
                  <span className="text-sm truncate flex-1 mr-4" title={subject}>
                    {subject.length > 60 ? `${subject.substring(0, 60)}...` : subject}
                  </span>
                  <span className="px-3 py-1 rounded-full text-sm font-semibold bg-uh-purple/20 text-uh-purple">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <details className="card group">
        <summary className="list-none cursor-pointer flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Other Resolved Tickets</h2>
            <p className="text-sm text-slate-500 mt-1">
              Remaining resolved tickets for this day, excluding the AI-picked 10-ticket audit sample.
            </p>
          </div>
          <div className="flex items-center gap-2 text-slate-500">
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
              {otherResolvedTickets.length}
            </span>
            <ChevronDown size={18} className="transition-transform group-open:rotate-180" />
          </div>
        </summary>

        <div className="mt-4 overflow-x-auto">
          {otherResolvedTickets.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">No additional resolved tickets outside the sampled audit set.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-slate-500 text-sm">
                  <th className="pb-3 pr-4">Ticket ID</th>
                  <th className="pb-3 px-4">Subject</th>
                  <th className="pb-3 px-4">Customer</th>
                  <th className="pb-3 px-4">Response</th>
                  <th className="pb-3 px-4">QC Score</th>
                  <th className="pb-3 pl-4">QC Review</th>
                </tr>
              </thead>
              <tbody>
                {otherResolvedTickets.map((ticket) => (
                  <tr
                    key={ticket.TICKET_ID}
                    className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                      (cachedScores[String(ticket.TICKET_ID)]?.qaScore ?? 100) < 50 ? 'bg-uh-error/5' : ''
                    }`}
                  >
                    <td className="py-3 pr-4">
                      <Link to={`/ticket/${ticket.TICKET_ID}`} className="text-uh-cyan hover:underline font-mono text-sm">
                        #{ticket.TICKET_ID}
                      </Link>
                    </td>
                    <td className="py-3 px-4 max-w-[360px]">
                      <span className="text-sm truncate block" title={ticket.SUBJECT}>
                        {ticket.SUBJECT?.length > 65 ? `${ticket.SUBJECT.substring(0, 65)}...` : ticket.SUBJECT}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Link to={`/customer/${encodeURIComponent(ticket.VISITOR_EMAIL)}`} className="text-xs text-slate-500 hover:text-uh-cyan">
                        {ticket.VISITOR_EMAIL?.length > 30 ? `${ticket.VISITOR_EMAIL.substring(0, 30)}...` : ticket.VISITOR_EMAIL}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-500">
                      {formatTime(ticket.FIRST_RESPONSE_DURATION_SECONDS)}
                    </td>
                    <td className="py-3 px-4">
                      <ScorePill ticketId={String(ticket.TICKET_ID)} />
                    </td>
                    <td className="py-3 pl-4">
                      {cachedScores[String(ticket.TICKET_ID)]?.qaScore !== undefined && cachedScores[String(ticket.TICKET_ID)]?.qaScore < 50 ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-uh-error text-white">
                            <Skull size={9} /> Fatal
                          </span>
                          <ReviewBadge ticketId={String(ticket.TICKET_ID)} />
                        </div>
                      ) : (
                        <ReviewBadge ticketId={String(ticket.TICKET_ID)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>
    </div>
  );
}
