import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DateMode } from '../api/client';

interface DateState {
  selectedDate: string;
  dateMode: DateMode;
  setSelectedDate: (date: string) => void;
  setDateMode: (mode: DateMode) => void;
}

export const useDateStore = create<DateState>()(
  persist(
    (set) => ({
      selectedDate: '', // Empty initially, components will fall back to latest date
      dateMode: 'activity', // Matches Yellow.ai default
      setSelectedDate: (date) => set({ selectedDate: date }),
      setDateMode: (mode) => set({ dateMode: mode }),
    }),
    {
      name: 'qa-dash-date-settings',
    }
  )
);
