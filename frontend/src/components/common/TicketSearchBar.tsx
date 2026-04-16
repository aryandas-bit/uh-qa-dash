import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

export default function TicketSearchBar() {
  const [ticketId, setTicketId] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = ticketId.trim();
    if (id) {
      navigate(`/ticket/${id}`);
      setTicketId('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        value={ticketId}
        onChange={(e) => setTicketId(e.target.value)}
        placeholder="Audit ticket by ID..."
        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 rounded-xl text-sm text-slate-700
                   placeholder:text-slate-400 focus:outline-none focus:bg-white
                   shadow-elevation-1 focus:shadow-elevation-2 transition-all duration-300 ease-md3"
      />
    </form>
  );
}
