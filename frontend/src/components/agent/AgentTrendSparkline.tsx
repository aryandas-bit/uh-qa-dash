import { Area, AreaChart, ResponsiveContainer, YAxis, Tooltip } from 'recharts';

interface TrendPoint {
  date: string;
  avgScore: number;
}

interface AgentTrendSparklineProps {
  data: TrendPoint[];
  width?: number | string;
  height?: number;
  showTooltip?: boolean;
}

export default function AgentTrendSparkline({ 
  data, 
  width = '100%', 
  height = 40,
  showTooltip = false 
}: AgentTrendSparklineProps) {
  if (!data || data.length === 0) {
    return <div style={{ width, height }} className="flex items-center justify-center bg-slate-50 rounded text-[10px] text-slate-300">No trend</div>;
  }

  // Pre-process data for stable rendering
  const formattedData = data.map(point => ({
    ...point,
    displayDate: point.date.split('-').slice(1).join('/') // MM/DD
  }));

  const latestScore = data[data.length - 1].avgScore;
  const color = 
    latestScore >= 80 ? '#10b981' : // Success (green)
    latestScore >= 60 ? '#f59e0b' : // Warning (amber)
    '#ef4444'; // Error (red)

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formattedData}>
          <defs>
            <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={color} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <YAxis domain={[0, 100]} hide />
          {showTooltip && (
            <Tooltip 
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-white px-2 py-1 border border-slate-200 rounded shadow-sm text-[10px]">
                      <p className="font-bold">{payload[0].payload.displayDate}</p>
                      <p style={{ color }}>{Math.round(Number(payload[0].value))}</p>
                    </div>
                  );
                }
                return null;
              }}
            />
          )}
          <Area 
            type="monotone" 
            dataKey="avgScore" 
            stroke={color} 
            fillOpacity={1} 
            fill="url(#colorScore)" 
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
