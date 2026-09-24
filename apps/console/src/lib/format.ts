export const usd = (n: number, maxFrac = 2) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: maxFrac }).format(n);

export const int = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));

export const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const shortHash = (h: string) => (h && h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);
