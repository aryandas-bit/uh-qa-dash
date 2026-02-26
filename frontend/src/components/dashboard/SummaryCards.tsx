import { Ticket, Users, Star, AlertCircle } from 'lucide-react';
import type { DailySummary } from '../../types';

interface SummaryCardsProps {
  summary: DailySummary | null;
  isLoading: boolean;
}

interface CardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: 'purple' | 'cyan' | 'green' | 'red' | 'yellow';
}

function Card({ title, value, subtitle, icon, color }: CardProps) {
  const colorClasses = {
    purple: 'from-uh-purple/20 to-uh-purple/5 border-uh-purple/30',
    cyan: 'from-uh-cyan/20 to-uh-cyan/5 border-uh-cyan/30',
    green: 'from-uh-success/20 to-uh-success/5 border-uh-success/30',
    red: 'from-uh-error/20 to-uh-error/5 border-uh-error/30',
    yellow: 'from-uh-warning/20 to-uh-warning/5 border-uh-warning/30',
  };

  const iconColors = {
    purple: 'text-uh-purple',
    cyan: 'text-uh-cyan',
    green: 'text-uh-success',
    red: 'text-uh-error',
    yellow: 'text-uh-warning',
  };

  return (
    <div
      className={`bg-gradient-to-br ${colorClasses[color]} border rounded-2xl p-6 transition-all hover:scale-[1.02]`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-slate-500 text-sm font-medium">{title}</p>
          <p className="text-3xl font-bold mt-2">{value}</p>
          {subtitle && (
            <p className="text-slate-400 text-sm mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`p-3 rounded-xl bg-slate-50 ${iconColors[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function SummaryCards({ summary, isLoading }: SummaryCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="bg-slate-50 border border-slate-200 rounded-2xl p-6 animate-pulse h-32"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card
        title="Total Tickets"
        value={summary?.totalTickets ?? 0}
        subtitle={`${summary?.activeAgents ?? 0} active agents`}
        icon={<Ticket size={24} />}
        color="purple"
      />
      <Card
        title="Average CSAT"
        value={summary?.avgCsat?.toFixed(1) ?? 'N/A'}
        subtitle="out of 5.0"
        icon={<Star size={24} />}
        color="cyan"
      />
      <Card
        title="Resolved"
        value={summary?.resolvedCount ?? 0}
        subtitle={`${summary?.totalTickets ? Math.round((summary.resolvedCount / summary.totalTickets) * 100) : 0}% resolution rate`}
        icon={<Users size={24} />}
        color="green"
      />
      <Card
        title="Low CSAT"
        value={summary?.lowCsatCount ?? 0}
        subtitle="tickets need attention"
        icon={<AlertCircle size={24} />}
        color="red"
      />
    </div>
  );
}
