import { formatPaise } from "../../shared/money";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

/** Compact rupee label: ₹1.2L, ₹45.3K. */
export function shortRupees(paise: number) {
  const r = paise / 100;
  const a = Math.abs(r);
  if (a >= 1e7) return `₹${(r / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `₹${(r / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${(r / 1e3).toFixed(1)}K`;
  return `₹${Math.round(r)}`;
}

export interface Series {
  name: string;
  className: string; // Tailwind fill class
  values: number[];
}

/** Grouped vertical bars, pure SVG (no chart library). Values in paise. */
export function BarChart({ labels, series, height = 200 }: { labels: string[]; series: Series[]; height?: number }) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const groupW = 100 / Math.max(labels.length, 1);
  const barW = (groupW * 0.7) / series.length;
  const chartH = height - 28;
  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-56 w-full" role="img" aria-label="Bar chart">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1="0" x2="100" y1={chartH - chartH * f} y2={chartH - chartH * f} className="stroke-slate-100" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        ))}
        {labels.map((label, i) =>
          series.map((s, j) => {
            const v = Math.max(0, s.values[i] ?? 0);
            const h = (v / max) * chartH;
            return (
              <rect key={`${label}-${s.name}`} x={i * groupW + groupW * 0.15 + j * barW} y={chartH - h} width={barW * 0.9} height={h} className={s.className}>
                <title>{`${label} · ${s.name}: ₹${formatPaise(s.values[i] ?? 0)}`}</title>
              </rect>
            );
          }),
        )}
      </svg>
      <div className="mt-1 flex text-[11px] text-slate-500">
        {labels.map((l) => <span key={l} className="flex-1 text-center">{l}</span>)}
      </div>
      {series.length > 1 && (
        <div className="mt-2 flex gap-4 text-xs text-slate-600">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5"><svg width="10" height="10"><rect width="10" height="10" className={s.className} /></svg>{s.name}</span>
          ))}
        </div>
      )}
      <p className="mt-1 text-right text-[11px] text-slate-400">Peak {shortRupees(max)}</p>
    </div>
  );
}
