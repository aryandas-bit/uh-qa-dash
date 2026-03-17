const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function formatDate(date: Date, pattern: 'yyyy-MM-dd' | 'MMM dd, yyyy'): string {
  if (pattern === 'yyyy-MM-dd') {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  return `${MONTH_LABELS[date.getMonth()]} ${pad(date.getDate())}, ${date.getFullYear()}`;
}

export function subDays(date: Date, amount: number): Date {
  const next = cloneDate(date);
  next.setDate(next.getDate() - amount);
  return next;
}

export function addDays(date: Date, amount: number): Date {
  const next = cloneDate(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function startOfDay(date: Date): Date {
  const next = cloneDate(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function isAfter(left: Date, right: Date): boolean {
  return left.getTime() > right.getTime();
}
