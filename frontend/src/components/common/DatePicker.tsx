import { useRef } from 'react';
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
  const inputRef = useRef<HTMLInputElement>(null);
  const today = startOfDay(new Date());
  const currentDate = new Date(selectedDate);

  const canGoForward = !isAfter(addDays(currentDate, 1), today);

  const handlePrevDay = () => {
    onDateChange(format(subDays(currentDate, 1), 'yyyy-MM-dd'));
  };

  const handleNextDay = () => {
    if (canGoForward) {
      onDateChange(format(addDays(currentDate, 1), 'yyyy-MM-dd'));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) onDateChange(e.target.value);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handlePrevDay}
        className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 transition-all"
      >
        <ChevronLeft size={20} />
      </button>

      <button
        onClick={() => inputRef.current?.showPicker()}
        className="relative flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg min-w-[180px] justify-center hover:bg-slate-50 hover:border-uh-purple/40 transition-all cursor-pointer"
      >
        <Calendar size={16} className="text-uh-purple" />
        <span className="font-medium">{format(currentDate, 'MMM dd, yyyy')}</span>
        <input
          ref={inputRef}
          type="date"
          value={selectedDate}
          max={format(today, 'yyyy-MM-dd')}
          onChange={handleInputChange}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          tabIndex={-1}
        />
      </button>

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
