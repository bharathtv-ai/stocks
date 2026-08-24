export const inr = (n, opts = {}) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: opts.decimals ?? 2,
    maximumFractionDigits: opts.decimals ?? 2,
  }).format(Number(n));
};

export const inrCompact = (n) => {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return inr(v, { decimals: 0 });
};

export const num = (n, d = 2) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n));
};

export const qty = (n) => {
  const v = Number(n);
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(v) ? 0 : 3,
  }).format(v);
};

export const shortDate = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const monthLabel = (d) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
