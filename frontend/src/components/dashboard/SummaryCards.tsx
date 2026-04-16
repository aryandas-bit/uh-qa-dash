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
  const bgColors = {
    purple: 'bg-uh-purple/8',
    cyan: 'bg-uh-cyan/8',
    green: 'bg-uh-success/8',
    red: 'bg-uh-error/8',
    yellow: 'bg-uh-warning/8',
  };

  const iconColors = {
    purple: 'text-uh-purple bg-uh-purple/10',
    cyan: 'text-uh-cyan bg-uh-cyan/10',
    green: 'text-uh-success bg-uh-success/10',
    red: 'text-uh-error bg-uh-error/10',
    yellow: 'text-uh-warning bg-uh-warning/10',
  };

  return (
    <div
      className={`${bgColors[color]} rounded-2xl p-6 shadow-elevation-1 hover:shadow-elevation-2 transition-shadow duration-md3 ease-md3`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-slate-500 text-sm font-medium">{title}</p>
          <p className="text-3xl font-bold mt-2">{value}</p>
          {subtitle && (
            <p className="text-slate-400 text-sm mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`p-3 rounded-xl ${iconColors[color]}`}>
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
            className="bg-white/60 rounded-2xl p-6 animate-pulse h-32 shadow-elevation-1"
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
        value={summary?.avgCsat ? Number(summary.avgCsat).toFixed(1) : 'N/A'}
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
