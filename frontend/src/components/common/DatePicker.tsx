import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { format, subDays, addDays, isAfter, startOfDay } from 'date-fns';

interface DatePickerProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  availableDates?: string[];
}

export default function DatePicker({
  selectedDate,
  onDateChange,
  availableDates: _availableDates,
}: DatePickerProps) {
  const today = startOfDay(new Date());
  const currentDate = new Date(selectedDate);

  const canGoForward = !isAfter(addDays(currentDate, 1), today);
  const canGoBackward = true; // Could add min date check here

  const handlePrevDay = () => {
    const newDate = format(subDays(currentDate, 1), 'yyyy-MM-dd');
    onDateChange(newDate);
  };

  const handleNextDay = () => {
    if (canGoForward) {
      const newDate = format(addDays(currentDate, 1), 'yyyy-MM-dd');
      onDateChange(newDate);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handlePrevDay}
        disabled={!canGoBackward}
        className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        <ChevronLeft size={20} />
      </button>

      <div className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg min-w-[180px] justify-center">
        <Calendar size={16} className="text-uh-purple" />
        <span className="font-medium">
          {format(currentDate, 'MMM dd, yyyy')}
        </span>
      </div>

      <button
        onClick={handleNextDay}
        disabled={!canGoForward}
        className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
