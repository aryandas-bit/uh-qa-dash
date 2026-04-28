import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserCircle, ChevronDown, Plus, Check } from 'lucide-react';
import { auditorsApi } from '../../api/client';
import { useAuditorStore } from '../../store/auditorStore';

export default function AuditorSwitcher() {
  const { currentAuditor, setCurrentAuditor } = useAuditorStore();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['auditors-list'],
    queryFn: () => auditorsApi.list(),
    staleTime: 1000 * 60 * 5,
  });
  const auditors: string[] = data?.data?.auditors || [];

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const display = currentAuditor || 'Auditor';

  function commit(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCurrentAuditor(trimmed);
    setOpen(false);
    setAdding(false);
    setDraft('');
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all bg-slate-100 text-slate-700 hover:bg-slate-200"
        title="Switch auditor"
      >
        <UserCircle size={16} />
        <span className="font-medium max-w-[140px] truncate">{display}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 bottom-full mb-2 bg-white rounded-xl shadow-elevation-2 border border-slate-100 z-50 p-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-400 px-2 py-1">
            Auditors
          </div>
          <div className="max-h-60 overflow-y-auto">
            {auditors.length === 0 && (
              <div className="text-sm text-slate-400 px-2 py-2">No auditors yet — add yours.</div>
            )}
            {auditors.map((name) => (
              <button
                key={name}
                onClick={() => commit(name)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-slate-100 text-sm text-left"
              >
                <span className="truncate">{name}</span>
                {name === currentAuditor && <Check size={14} className="text-uh-purple shrink-0" />}
              </button>
            ))}
          </div>
          <div className="border-t border-slate-100 mt-2 pt-2">
            {adding ? (
              <div className="flex items-center gap-1.5 px-1">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(draft);
                    if (e.key === 'Escape') { setAdding(false); setDraft(''); }
                  }}
                  placeholder="Your name"
                  className="flex-1 text-sm px-2 py-1.5 rounded-lg border border-slate-200 focus:border-uh-purple focus:outline-none"
                />
                <button
                  onClick={() => commit(draft)}
                  className="px-2 py-1.5 rounded-lg bg-uh-purple text-white text-xs font-semibold"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 text-sm text-uh-purple"
              >
                <Plus size={14} /> Add me
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
