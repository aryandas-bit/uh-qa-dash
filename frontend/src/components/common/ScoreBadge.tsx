interface ScoreBadgeProps {
  score: number | null;
  size?: 'sm' | 'md' | 'lg';
}

export default function ScoreBadge({ score, size = 'md' }: ScoreBadgeProps) {
  if (score === null || score === undefined) {
    return (
      <span className="px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-400">
        N/A
      </span>
    );
  }

  const getScoreColor = (s: number) => {
    if (s >= 80) return 'bg-uh-success/20 text-uh-success';
    if (s >= 60) return 'bg-uh-warning/20 text-uh-warning';
    return 'bg-uh-error/20 text-uh-error';
  };

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-2 text-base',
  };

  return (
    <span
      className={`rounded-full font-semibold ${getScoreColor(score)} ${sizeClasses[size]}`}
    >
      {Math.round(score)}
    </span>
  );
}
