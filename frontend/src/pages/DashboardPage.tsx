import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Users,
  ChevronRight,
  Calendar,
  CalendarCheck,
  Ticket,
  TrendingUp,
  Star,
  Frown,
  CheckCircle,
  Inbox,
  ClipboardCheck,
  ShieldAlert,
  Send,
  Lock,
  RotateCcw,
  CheckCheck,
  Loader2,
} from 'lucide-react';
import DatePicker from '../components/common/DatePicker';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { agentsApi, ticketsApi, auditorsApi, reevaluationsApi } from '../api/client';
import { useDateStore } from '../store/dateStore';
import { useAuditorStore } from '../store/auditorStore';

function formatAgentName(email?: string) {
  if (!email) return 'Unknown';
  return email.split('@')[0].replace(/_ext$/, '').replace(/[._]/g, ' ')
    .split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function ScoreChip({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-slate-400">—</span>;
  const color = score >= 80 ? 'text-uh-success bg-uh-success/10' : score >= 60 ? 'text-uh-warning bg-uh-warning/10' : 'text-uh-error bg-uh-error/10';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>{score}</span>;
}

interface AuditAgentSummary {
  agentEmail: string;
  auditedCount: number;
  sampleSize: number;
  lowScoreCount: number;
  avgQaScore: number | null;
}

interface AuditOverall {
  agentCount?: number;
  avgQaScore?: number | null;
}

interface TopIssue {
  category?: string | null;
  count: number;
}

interface FrustratedCustomer {
  customerEmail: string;
  customerName?: string | null;
  lowestCsat?: number | string | null;
  subjects?: string | null;
}

export default function DashboardPage() {
  const { selectedDate, setSelectedDate, dateMode, setDateMode } = useDateStore();
  const { currentAuditor } = useAuditorStore();
  const qc = useQueryClient();

  const { data: datesData, isLoading: datesLoading } = useQuery({
    queryKey: ['dates'],
    queryFn: () => agentsApi.getDates(),
    staleTime: 1000 * 60 * 60,
  });

  const latestDate = datesData?.data?.dates?.[0];
  const effectiveDate = selectedDate || latestDate || '';
  const pickerDate = effectiveDate || new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!latestDate) return;
    const available: string[] = datesData?.data?.dates || [];
    if (!selectedDate || (available.length > 0 && !available.includes(selectedDate))) {
      setSelectedDate(latestDate);
    }
  }, [latestDate, selectedDate, datesData, setSelectedDate]);

  const { data: insightsData, isLoading: insightsLoading } = useQuery({
    queryKey: ['insights', effectiveDate, dateMode],
    queryFn: () => ticketsApi.getInsights(effectiveDate, dateMode),
    enabled: !!effectiveDate,
    staleTime: 1000 * 60 * 30,
  });

  const { data: auditSummaryData } = useQuery({
    queryKey: ['audit-summary', effectiveDate, dateMode],
    queryFn: () => agentsApi.getAuditSummary(effectiveDate, dateMode),
    enabled: !!effectiveDate,
    staleTime: 1000 * 60 * 5,
  });

  const { data: assignmentsData } = useQuery({
    queryKey: ['assignments', effectiveDate, dateMode],
    queryFn: () => auditorsApi.getAssignments(effectiveDate, dateMode),
    enabled: !!effectiveDate,
    staleTime: 1000 * 30,
  });

  const { data: pushedData } = useQuery({
    queryKey: ['pushed-scores', effectiveDate, dateMode],
    queryFn: () => auditorsApi.getPushedScores(effectiveDate, dateMode),
    enabled: !!effectiveDate,
    staleTime: 1000 * 30,
  });

  const { data: teamProgressData } = useQuery({
    queryKey: ['team-progress', effectiveDate, dateMode],
    queryFn: () => auditorsApi.getTeamProgress(effectiveDate, dateMode),
    enabled: !!effectiveDate,
    staleTime: 1000 * 30,
  });

  const { data: myStatsData } = useQuery({
    queryKey: ['my-stats', effectiveDate, dateMode, currentAuditor],
    queryFn: () => auditorsApi.getMyStats(effectiveDate, dateMode, currentAuditor),
    enabled: !!effectiveDate && !!currentAuditor,
    staleTime: 1000 * 30,
  });

  const { data: reevalsData } = useQuery({
    queryKey: ['reevals-open'],
    queryFn: () => reevaluationsApi.list('open'),
    staleTime: 1000 * 30,
  });

  const insights = insightsData?.data || {};
  const summary = insights.summary || {};
  const topIssues = insights.topIssues || [];
  const frustratedCustomers = insights.frustratedCustomers || [];

  const auditSummary = auditSummaryData?.data || { agents: [], overall: {} };
  const auditAgents: AuditAgentSummary[] = auditSummary.agents || [];
  const auditOverall: AuditOverall = auditSummary.overall || {};

  const assignments: Array<{ agentEmail: string; auditor: string }> = assignmentsData?.data?.assignments || [];
  const assignmentMap = new Map(assignments.map((a) => [a.agentEmail, a.auditor]));
  const pushed: Array<{ agentEmail: string; pushedBy: string; pushedAt: string }> = pushedData?.data?.pushed || [];
  const pushedSet = new Set(pushed.map((p) => p.agentEmail));

  const teamProgress: Array<{ auditor: string; agentsClaimed: number; agentsPushed: number; ticketsReviewed: number }> =
    teamProgressData?.data?.progress || [];

  const my = myStatsData?.data || { ticketsReviewed: 0, agentsClaimed: 0, agentsPushed: 0, openReevals: 0 };
  const openReevalsCount: number = reevalsData?.data?.requests?.length ?? 0;

  const claimMutation = useMutation({
    mutationFn: ({ agentEmail }: { agentEmail: string }) =>
      auditorsApi.claim(effectiveDate, dateMode, agentEmail, currentAuditor),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['assignments', effectiveDate, dateMode] });
      qc.invalidateQueries({ queryKey: ['team-progress', effectiveDate, dateMode] });
      qc.invalidateQueries({ queryKey: ['my-stats', effectiveDate, dateMode, currentAuditor] });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: ({ agentEmail }: { agentEmail: string }) =>
      auditorsApi.release(effectiveDate, dateMode, agentEmail, currentAuditor),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['assignments', effectiveDate, dateMode] });
      qc.invalidateQueries({ queryKey: ['team-progress', effectiveDate, dateMode] });
      qc.invalidateQueries({ queryKey: ['my-stats', effectiveDate, dateMode, currentAuditor] });
    },
  });

  const pushMutation = useMutation({
    mutationFn: ({ agentEmail }: { agentEmail: string }) =>
      auditorsApi.pushScores(effectiveDate, dateMode, agentEmail, currentAuditor),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['pushed-scores', effectiveDate, dateMode] });
      qc.invalidateQueries({ queryKey: ['team-progress', effectiveDate, dateMode] });
      qc.invalidateQueries({ queryKey: ['my-stats', effectiveDate, dateMode, currentAuditor] });
    },
  });

  const isLoading = datesLoading || insightsLoading;
  const totalAuditors = teamProgress.length;
  const totalAuditedToday = teamProgress.reduce((s, t) => s + t.ticketsReviewed, 0);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-slate-500 mt-1">
            {currentAuditor
              ? <>Welcome back, <span className="font-medium text-slate-700">{currentAuditor}</span> · QA auditor console</>
              : 'QA auditor console'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => setDateMode('initialized')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                dateMode === 'initialized' ? 'bg-uh-purple text-white' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Calendar size={14} /><span>Created</span>
            </button>
            <button
              onClick={() => setDateMode('activity')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all ${
                dateMode === 'activity' ? 'bg-uh-purple text-white' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <CalendarCheck size={14} /><span>Activity</span>
            </button>
          </div>
          <DatePicker selectedDate={pickerDate} onDateChange={setSelectedDate} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner text="Loading dashboard..." />
        </div>
      ) : (
        <>
          {/* MY DAY — auditor-personal stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <MyStatCard
              label="My audits today"
              value={my.ticketsReviewed}
              icon={<ClipboardCheck size={18} />}
              tone="purple"
            />
            <MyStatCard
              label="Scores pushed"
              value={`${my.agentsPushed}${my.agentsClaimed > 0 ? ` / ${my.agentsClaimed}` : ''}`}
              icon={<Send size={18} />}
              tone="cyan"
              hint="of agents I've claimed"
            />
            <MyStatCard
              label="My agents"
              value={my.agentsClaimed}
              icon={<Users size={18} />}
              tone="success"
              hint="claimed for today"
            />
            <Link
              to="/re-evaluations"
              className="card flex items-center gap-3 hover:shadow-elevation-2 transition-all group"
            >
              <div className={`p-2.5 rounded-xl ${openReevalsCount > 0 ? 'bg-uh-warning/20 text-uh-warning' : 'bg-slate-100 text-slate-400'}`}>
                <RotateCcw size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-slate-500 text-xs">Re-eval queue</p>
                <p className="text-2xl font-bold">{openReevalsCount}</p>
              </div>
              <ChevronRight size={16} className="text-slate-300 group-hover:text-uh-purple group-hover:translate-x-0.5 transition-all" />
            </Link>
          </div>

          {/* DAILY AUDIT QUEUE — claim, audit, push */}
          {auditAgents.length > 0 && (
            <div className="card mb-5 border border-uh-purple/10">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ClipboardCheck size={18} className="text-uh-purple" />
                  <h2 className="text-lg font-semibold">Daily Audit Queue</h2>
                  <span className="text-xs text-slate-400">({auditOverall.agentCount || 0} agents audited)</span>
                </div>
                <div className="flex items-center gap-3">
                  {auditOverall.avgQaScore != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Overall avg</span>
                      <ScoreChip score={auditOverall.avgQaScore} />
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {auditAgents.map((agent) => (
                  <AuditQueueRow
                    key={agent.agentEmail}
                    agent={agent}
                    effectiveDate={effectiveDate}
                    dateMode={dateMode}
                    claimedBy={assignmentMap.get(agent.agentEmail) || null}
                    pushed={pushedSet.has(agent.agentEmail)}
                    currentAuditor={currentAuditor}
                    onClaim={() => claimMutation.mutate({ agentEmail: agent.agentEmail })}
                    onRelease={() => releaseMutation.mutate({ agentEmail: agent.agentEmail })}
                    onPush={() => pushMutation.mutate({ agentEmail: agent.agentEmail })}
                    busyClaim={claimMutation.isPending && claimMutation.variables?.agentEmail === agent.agentEmail}
                    busyPush={pushMutation.isPending && pushMutation.variables?.agentEmail === agent.agentEmail}
                  />
                ))}
              </div>
            </div>
          )}

          {/* OPS ROW — three columns */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
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
                  {topIssues.slice(0, 5).map((issue: TopIssue) => (
                    <div key={issue.category || issue.count} className="flex items-center justify-between p-2 rounded-lg bg-slate-100">
                      <span className="text-sm truncate flex-1 mr-2">{issue.category || 'Unknown'}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-uh-purple/20 text-uh-purple">{issue.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Frustrated Customers */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Frown size={18} className="text-uh-error" />
                <h2 className="text-lg font-semibold">Frustrated Customers</h2>
              </div>
              {frustratedCustomers.length === 0 ? (
                <p className="text-slate-400 text-center py-4">No low CSAT today</p>
              ) : (
                <div className="space-y-2">
                  {frustratedCustomers.map((customer: FrustratedCustomer) => (
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
                      <p className="text-xs text-slate-500 truncate">{customer.subjects?.split(' | ')[0] || 'No subject'}</p>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Team Progress */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Users size={18} className="text-uh-cyan" />
                <h2 className="text-lg font-semibold">Team Progress</h2>
                <span className="ml-auto text-xs text-slate-400">{totalAuditedToday} reviews · {totalAuditors} auditors</span>
              </div>
              {teamProgress.length === 0 ? (
                <p className="text-slate-400 text-center py-4">No auditor activity yet today</p>
              ) : (
                <div className="space-y-2">
                  {teamProgress.slice(0, 6).map((t) => {
                    const max = Math.max(1, ...teamProgress.map((x) => x.ticketsReviewed + x.agentsPushed));
                    const total = t.ticketsReviewed + t.agentsPushed;
                    const pct = Math.max(6, Math.round((total / max) * 100));
                    const isMe = t.auditor === currentAuditor;
                    return (
                      <div key={t.auditor} className={`p-2 rounded-lg ${isMe ? 'bg-uh-purple/5 border border-uh-purple/20' : 'bg-slate-50'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-sm truncate ${isMe ? 'font-semibold text-uh-purple' : 'font-medium'}`}>
                            {t.auditor}{isMe && ' (you)'}
                          </span>
                          <span className="text-[11px] text-slate-500 shrink-0 ml-2">
                            {t.ticketsReviewed} reviews · {t.agentsPushed}/{t.agentsClaimed} pushed
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${isMe ? 'bg-uh-purple' : 'bg-uh-cyan'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* QUICK STATS strip — context numbers, smaller */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <SmallStat icon={<Ticket size={16} />} label="Tickets" value={summary.totalTickets || 0} tone="purple" />
            <SmallStat icon={<Users size={16} />} label="Active Agents" value={summary.activeAgents || 0} tone="cyan" />
            <SmallStat icon={<CheckCircle size={16} />} label="Resolved" value={summary.resolvedCount || 0} tone="success" />
            <SmallStat icon={<Star size={16} />} label="Avg CSAT" value={summary.avgCsat || '—'} tone="warning" />
          </div>

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
        </>
      )}
    </div>
  );
}

function MyStatCard({
  label, value, icon, tone, hint,
}: { label: string; value: number | string; icon: React.ReactNode; tone: 'purple' | 'cyan' | 'success' | 'warning'; hint?: string }) {
  const toneMap = {
    purple: 'bg-uh-purple/15 text-uh-purple',
    cyan: 'bg-uh-cyan/15 text-uh-cyan',
    success: 'bg-uh-success/15 text-uh-success',
    warning: 'bg-uh-warning/15 text-uh-warning',
  };
  return (
    <div className="card flex items-center gap-3">
      <div className={`p-2.5 rounded-xl ${toneMap[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-slate-500 text-xs">{label}</p>
        <p className="text-2xl font-bold leading-tight">{value}</p>
        {hint && <p className="text-[10px] text-slate-400 truncate">{hint}</p>}
      </div>
    </div>
  );
}

function SmallStat({
  icon, label, value, tone,
}: { icon: React.ReactNode; label: string; value: number | string; tone: 'purple' | 'cyan' | 'success' | 'warning' }) {
  const toneMap = {
    purple: 'text-uh-purple',
    cyan: 'text-uh-cyan',
    success: 'text-uh-success',
    warning: 'text-uh-warning',
  };
  return (
    <div className="px-4 py-3 rounded-xl bg-white shadow-elevation-1 flex items-center gap-3">
      <span className={toneMap[tone]}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
      </div>
    </div>
  );
}

function AuditQueueRow({
  agent, effectiveDate, dateMode, claimedBy, pushed, currentAuditor,
  onClaim, onRelease, onPush, busyClaim, busyPush,
}: {
  agent: AuditAgentSummary;
  effectiveDate: string;
  dateMode: string;
  claimedBy: string | null;
  pushed: boolean;
  currentAuditor: string;
  onClaim: () => void;
  onRelease: () => void;
  onPush: () => void;
  busyClaim: boolean;
  busyPush: boolean;
}) {
  const isMine = claimedBy === currentAuditor;
  const isLocked = !!claimedBy && !isMine;
  const canPush = isMine && agent.auditedCount > 0 && !pushed;

  return (
    <div className={`flex items-center justify-between p-3 rounded-xl transition-all ${
      pushed ? 'bg-uh-success/5 border border-uh-success/20'
        : isLocked ? 'bg-slate-50 border border-slate-200'
        : isMine ? 'bg-uh-purple/5 border border-uh-purple/20'
        : 'bg-slate-50 hover:bg-slate-100'
    }`}>
      <Link
        to={`/agent/${encodeURIComponent(agent.agentEmail)}?date=${effectiveDate}&dateMode=${dateMode}`}
        className="flex items-center gap-2 min-w-0 flex-1 mr-3"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium truncate flex items-center gap-1.5">
            {formatAgentName(agent.agentEmail)}
            {isLocked && <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500"><Lock size={10} /> {claimedBy}</span>}
            {pushed && <span className="inline-flex items-center gap-0.5 text-[10px] text-uh-success"><CheckCheck size={10} /> pushed</span>}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {agent.auditedCount}/{agent.sampleSize} audited
            {agent.lowScoreCount > 0 && (
              <span className="ml-1.5 text-uh-error">· {agent.lowScoreCount} low</span>
            )}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-2 shrink-0">
        {agent.lowScoreCount > 0 && <ShieldAlert size={13} className="text-uh-error/60" />}
        <ScoreChip score={agent.avgQaScore} />
        {currentAuditor && !pushed && (
          isLocked ? null
            : isMine ? (
              <>
                <button
                  onClick={(e) => { e.preventDefault(); onPush(); }}
                  disabled={!canPush || busyPush}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                    canPush && !busyPush
                      ? 'bg-uh-purple text-white hover:bg-uh-purple/90'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                  title={canPush ? 'Push these scores to the agent' : 'Audit at least one ticket first'}
                >
                  {busyPush ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Push
                </button>
                <button
                  onClick={(e) => { e.preventDefault(); onRelease(); }}
                  className="px-2 py-1 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-200"
                  title="Release this agent so someone else can claim"
                >
                  Release
                </button>
              </>
            ) : (
              <button
                onClick={(e) => { e.preventDefault(); onClaim(); }}
                disabled={busyClaim}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-uh-purple/10 text-uh-purple hover:bg-uh-purple/20 disabled:opacity-50"
                title="Claim this agent so other auditors don't audit them"
              >
                {busyClaim ? <Loader2 size={12} className="animate-spin" /> : 'Claim'}
              </button>
            )
        )}
      </div>
    </div>
  );
}
