import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  RotateCcw,
  Check,
  X,
  Hand,
  ExternalLink,
  Plus,
  Loader2,
} from 'lucide-react';
import { reevaluationsApi } from '../api/client';
import { useAuditorStore } from '../store/auditorStore';
import LoadingSpinner from '../components/common/LoadingSpinner';

type Status = 'open' | 'in_review' | 'resolved' | 'rejected';

interface Reeval {
  id: number;
  ticketId: string;
  agentEmail: string | null;
  reason: string | null;
  status: Status;
  requestedBy: string | null;
  requestedAt: string;
  claimedBy: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  originalScore: number | null;
  newScore: number | null;
}

function formatRel(iso: string) {
  const d = new Date(iso);
  const diffMin = (Date.now() - d.getTime()) / 60000;
  if (diffMin < 60) return `${Math.round(diffMin)}m ago`;
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}h ago`;
  return `${Math.round(diffMin / (60 * 24))}d ago`;
}

const STATUS_TABS: Array<{ key: Status | 'all'; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'in_review', label: 'In review' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

export default function ReEvaluationsPage() {
  const { currentAuditor } = useAuditorStore();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Status | 'all'>('open');
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['reevals', activeTab],
    queryFn: () => reevaluationsApi.list(activeTab === 'all' ? undefined : activeTab),
    staleTime: 1000 * 30,
  });
  const requests: Reeval[] = useMemo(() => data?.data?.requests || [], [data]);

  const { data: allData } = useQuery({
    queryKey: ['reevals', 'counts'],
    queryFn: () => reevaluationsApi.list(),
    staleTime: 1000 * 30,
  });
  const allRequests: Reeval[] = useMemo(() => allData?.data?.requests || requests, [allData, requests]);

  const counts = useMemo(() => {
    return allRequests.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      },
      { open: 0, in_review: 0, resolved: 0, rejected: 0 } as Record<Status, number>
    );
  }, [allRequests]);

  const claimMut = useMutation({
    mutationFn: (id: number) => reevaluationsApi.claim(id, currentAuditor),
    onSettled: () => qc.invalidateQueries({ queryKey: ['reevals'] }),
  });

  const resolveMut = useMutation({
    mutationFn: ({ id, status, note, newScore }: { id: number; status: 'resolved' | 'rejected'; note?: string; newScore?: number | null }) =>
      reevaluationsApi.resolve(id, currentAuditor, status, note, newScore),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['reevals'] });
      qc.invalidateQueries({ queryKey: ['reevals-open'] });
    },
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <RotateCcw size={26} className="text-uh-purple" />
            Re-evaluations
          </h1>
          <p className="text-slate-500 mt-1">Tickets agents have asked to be re-checked after their initial score</p>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-uh-purple text-white text-sm font-semibold hover:bg-uh-purple/90"
        >
          <Plus size={16} /> New request
        </button>
      </div>

      {creating && <CreateForm onClose={() => setCreating(false)} />}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 bg-slate-100 p-1 rounded-xl w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key ? 'bg-white shadow-elevation-1 text-slate-900' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span>{tab.label}</span>
            {tab.key !== 'all' && counts[tab.key as Status] !== undefined && activeTab === tab.key && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {counts[tab.key as Status]}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner text="Loading re-evaluations..." />
        </div>
      ) : requests.length === 0 ? (
        <div className="card text-center py-12">
          <RotateCcw size={36} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No requests in this view.</p>
          {activeTab === 'open' && (
            <p className="text-xs text-slate-400 mt-2">
              Agents will queue tickets here from the CX tool. You can also create one manually.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <RequestRow
              key={r.id}
              r={r}
              currentAuditor={currentAuditor}
              onClaim={() => claimMut.mutate(r.id)}
              onResolve={(status, note, newScore) =>
                resolveMut.mutate({ id: r.id, status, note, newScore })
              }
              busy={
                (claimMut.isPending && claimMut.variables === r.id) ||
                (resolveMut.isPending && resolveMut.variables?.id === r.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestRow({
  r, currentAuditor, onClaim, onResolve, busy,
}: {
  r: Reeval;
  currentAuditor: string;
  onClaim: () => void;
  onResolve: (status: 'resolved' | 'rejected', note?: string, newScore?: number | null) => void;
  busy: boolean;
}) {
  const [showResolve, setShowResolve] = useState(false);
  const [note, setNote] = useState('');
  const [newScore, setNewScore] = useState<string>('');

  const isOpen = r.status === 'open';
  const isInReview = r.status === 'in_review';
  const closed = r.status === 'resolved' || r.status === 'rejected';

  return (
    <div className={`card transition-all ${
      r.status === 'open' ? 'border border-uh-warning/30'
        : r.status === 'in_review' ? 'border border-uh-cyan/30'
        : r.status === 'resolved' ? 'opacity-80'
        : 'opacity-70'
    }`}>
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Link
              to={`/ticket/${r.ticketId}`}
              className="text-sm font-semibold text-uh-purple hover:underline flex items-center gap-1"
            >
              Ticket {r.ticketId}
              <ExternalLink size={12} />
            </Link>
            <StatusBadge status={r.status} />
            {r.originalScore != null && (
              <span className="text-[11px] text-slate-500">orig score {r.originalScore}</span>
            )}
            {r.newScore != null && (
              <span className="text-[11px] text-uh-success">→ new {r.newScore}</span>
            )}
          </div>
          <div className="text-xs text-slate-500 mb-2">
            {r.agentEmail && <>Agent <span className="text-slate-700">{r.agentEmail}</span> · </>}
            Requested {r.requestedBy ? `by ${r.requestedBy} ` : ''}
            {formatRel(r.requestedAt)}
            {r.claimedBy && <> · Claimed by {r.claimedBy}</>}
            {closed && r.resolvedBy && <> · Closed by {r.resolvedBy}</>}
          </div>
          {r.reason && (
            <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 mb-2">
              {r.reason}
            </div>
          )}
          {r.resolvedNote && (
            <div className="text-sm text-slate-600 bg-uh-success/5 border border-uh-success/20 rounded-lg px-3 py-2">
              <span className="text-[10px] uppercase tracking-wide text-uh-success font-semibold">Decision</span>
              <p className="mt-1">{r.resolvedNote}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          {isOpen && currentAuditor && (
            <button
              onClick={onClaim}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-uh-cyan/15 text-uh-cyan text-xs font-semibold hover:bg-uh-cyan/25 flex items-center gap-1 disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Hand size={12} />}
              Claim
            </button>
          )}
          {(isInReview || isOpen) && currentAuditor && (
            <button
              onClick={() => setShowResolve((v) => !v)}
              className="px-3 py-1.5 rounded-lg bg-uh-purple text-white text-xs font-semibold hover:bg-uh-purple/90"
            >
              Resolve
            </button>
          )}
        </div>
      </div>

      {showResolve && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you decide and why?"
            rows={2}
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-uh-purple focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={newScore}
              onChange={(e) => setNewScore(e.target.value)}
              placeholder="New score (optional)"
              className="w-40 text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-uh-purple focus:outline-none"
            />
            <button
              onClick={() => {
                onResolve('resolved', note, newScore ? Number(newScore) : null);
                setShowResolve(false);
              }}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-uh-success text-white text-sm font-semibold flex items-center gap-1 disabled:opacity-50"
            >
              <Check size={14} /> Approve change
            </button>
            <button
              onClick={() => {
                onResolve('rejected', note);
                setShowResolve(false);
              }}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm font-semibold flex items-center gap-1 disabled:opacity-50"
            >
              <X size={14} /> Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    open: 'bg-uh-warning/15 text-uh-warning',
    in_review: 'bg-uh-cyan/15 text-uh-cyan',
    resolved: 'bg-uh-success/15 text-uh-success',
    rejected: 'bg-slate-200 text-slate-600',
  };
  const labels: Record<Status, string> = {
    open: 'Open',
    in_review: 'In review',
    resolved: 'Resolved',
    rejected: 'Rejected',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const { currentAuditor } = useAuditorStore();
  const qc = useQueryClient();
  const [ticketId, setTicketId] = useState('');
  const [agentEmail, setAgentEmail] = useState('');
  const [reason, setReason] = useState('');
  const [originalScore, setOriginalScore] = useState('');

  const createMut = useMutation({
    mutationFn: () =>
      reevaluationsApi.create({
        ticketId: ticketId.trim(),
        agentEmail: agentEmail.trim() || undefined,
        reason: reason.trim() || undefined,
        requestedBy: currentAuditor || 'manual',
        originalScore: originalScore ? Number(originalScore) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reevals'] });
      qc.invalidateQueries({ queryKey: ['reevals-open'] });
      onClose();
    },
  });

  return (
    <div className="card mb-5">
      <h3 className="text-sm font-semibold mb-3">Create re-evaluation request</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
        <input
          value={ticketId}
          onChange={(e) => setTicketId(e.target.value)}
          placeholder="Ticket ID"
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-uh-purple focus:outline-none"
        />
        <input
          value={agentEmail}
          onChange={(e) => setAgentEmail(e.target.value)}
          placeholder="Agent email (optional)"
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-uh-purple focus:outline-none"
        />
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason agent is asking for re-evaluation"
        rows={2}
        className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-uh-purple focus:outline-none mb-2"
      />
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={100}
          value={originalScore}
          onChange={(e) => setOriginalScore(e.target.value)}
          placeholder="Original score"
          className="w-40 text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-uh-purple focus:outline-none"
        />
        <button
          onClick={() => createMut.mutate()}
          disabled={!ticketId.trim() || createMut.isPending}
          className="px-4 py-2 rounded-lg bg-uh-purple text-white text-sm font-semibold disabled:opacity-50"
        >
          {createMut.isPending ? 'Creating...' : 'Create'}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
