import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuditorState {
  currentAuditor: string;
  setCurrentAuditor: (name: string) => void;
}

export const useAuditorStore = create<AuditorState>()(
  persist(
    (set) => ({
      currentAuditor: '',
      setCurrentAuditor: (name) => set({ currentAuditor: name.trim() }),
    }),
    { name: 'qa-dash-auditor' }
  )
);
