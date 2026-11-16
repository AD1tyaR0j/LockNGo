export const formatInr = (minor: number) => `₹${(minor / 100).toFixed(2)}`;

export const formatTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
};

export const SIZE_LABEL: Record<string, string> = {
  S: 'Small · backpack',
  M: 'Medium · cabin bag',
  L: 'Large · check-in bag',
  XL: 'Extra large · 2 bags',
};

export const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Paid · ready to store',
  ACCESS_READY: 'Paid · ready to store',
  ACTIVE: 'Items stored',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  DISPUTED: 'Under review',
};
