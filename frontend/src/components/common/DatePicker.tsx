import { useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { addDays, formatDate, isAfter, startOfDay, subDays } from '../../utils/date';

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
  const [y, m, d] = selectedDate.split('-').map(Number);
  const currentDate = new Date(y, m - 1, d);

  const canGoForward = !isAfter(addDays(currentDate, 1), today);

  const handlePrevDay = () => {
    onDateChange(formatDate(subDays(currentDate, 1), 'yyyy-MM-dd'));
  };

  const handleNextDay = () => {
    if (canGoForward) {
      onDateChange(formatDate(addDays(currentDate, 1), 'yyyy-MM-dd'));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) onDateChange(e.target.value);
  };

  const handleOpen = () => {
    try {
      inputRef.current?.showPicker();
    } catch {
      inputRef.current?.click();
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handlePrevDay}
        className="p-2 rounded-xl bg-white shadow-elevation-1 hover:shadow-elevation-2 transition-all duration-md3 ease-md3"
      >
        <ChevronLeft size={20} />
      </button>

      <button
        onClick={handleOpen}
        className="relative flex items-center gap-2 px-4 py-2 bg-white shadow-elevation-1 hover:shadow-elevation-2 rounded-xl min-w-[180px] justify-center transition-all duration-md3 ease-md3 cursor-pointer"
      >
        <Calendar size={16} className="text-uh-purple" />
        <span className="font-medium">{formatDate(currentDate, 'MMM dd, yyyy')}</span>
        <input
          ref={inputRef}
          type="date"
          value={selectedDate}
          max={formatDate(today, 'yyyy-MM-dd')}
          onChange={handleInputChange}
          className="sr-only"
        />
      </button>

      <button
        onClick={handleNextDay}
        disabled={!canGoForward}
        className="p-2 rounded-xl bg-white shadow-elevation-1 hover:shadow-elevation-2 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-md3 ease-md3"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
