'use client';
import { useEffect, useRef, useState } from 'react';
import { inrCompact, inr, monthLabel } from '@/lib/format';

// Single-series line + area. One series, so no legend box: the card title names it.
export default function TrendChart({ data }) {
  const boxRef = useRef(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!boxRef.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, e.contentRect.width)));
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  if (!data?.length) return <div className="empty">No history yet.</div>;

  const h = 260;
  const m = { top: 18, right: 58, bottom: 28, left: 8 };
  const iw = w - m.left - m.right;
  const ih = h - m.top - m.bottom;

  const vals = data.map((d) => Number(d.total_value));
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.18 || hi * 0.05;
  const y0 = lo - pad;
  const y1 = hi + pad;

  const px = (i) => m.left + (data.length === 1 ? iw / 2 : (i * iw) / (data.length - 1));
  const py = (v) => m.top + ih - ((v - y0) / (y1 - y0)) * ih;

  const line = data.map((d, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(Number(d.total_value)).toFixed(1)}`).join(' ');
  const area = `${line} L${px(data.length - 1).toFixed(1)},${(m.top + ih).toFixed(1)} L${px(0).toFixed(1)},${(m.top + ih).toFixed(1)} Z`;

  // recessive gridlines
  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => y0 + ((y1 - y0) * i) / ticks);

  const last = data[data.length - 1];
  const lastX = px(data.length - 1);
  const lastY = py(Number(last.total_value));

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const i = Math.round(((x - m.left) / iw) * (data.length - 1));
    const idx = Math.min(data.length - 1, Math.max(0, i));
    setHover(idx);
  };

  // label every other month so ticks never collide on narrow screens
  const step = w < 560 ? 3 : w < 780 ? 2 : 1;

  return (
    <div className="chartbox" ref={boxRef}>
      <svg width={w} height={h} role="img" aria-label="Portfolio value by month">
        {gridVals.map((v, i) => (
          <line key={i} x1={m.left} x2={m.left + iw} y1={py(v)} y2={py(v)} stroke="var(--grid)" strokeWidth="1" />
        ))}
        {gridVals.map((v, i) => (
          <text key={`t${i}`} x={m.left + iw + 8} y={py(v) + 4} fontSize="11" fill="var(--text-muted)">
            {inrCompact(v)}
          </text>
        ))}

        <path d={area} fill="var(--series-1-soft)" />
        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* direct label on the latest point only — never a number on every point */}
        <circle cx={lastX} cy={lastY} r="4.5" fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth="2" />

        {data.map((d, i) =>
          i % step === 0 || i === data.length - 1 ? (
            <text key={d.month_end} x={px(i)} y={h - 8} fontSize="11" fill="var(--text-muted)" textAnchor="middle">
              {monthLabel(d.month_end)}
            </text>
          ) : null
        )}

        {hover !== null && (
          <>
            <line x1={px(hover)} x2={px(hover)} y1={m.top} y2={m.top + ih} stroke="var(--border-strong)" strokeWidth="1" />
            <circle
              cx={px(hover)}
              cy={py(Number(data[hover].total_value))}
              r="5"
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth="2"
            />
          </>
        )}

        <rect
          x={m.left}
          y={m.top}
          width={iw}
          height={ih}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>

      {hover !== null && (
        <div
          className="tooltip"
          style={{
            left: Math.min(Math.max(px(hover), 70), w - 70),
            top: py(Number(data[hover].total_value)) - 12,
          }}
        >
          <span className="sub">{monthLabel(data[hover].month_end)}</span>
          <span className="tt-v">{inr(data[hover].total_value, { decimals: 0 })}</span>
          {data[hover].change_pct !== null && data[hover].change_pct !== undefined && (
            <span className={Number(data[hover].change_pct) >= 0 ? 'pos' : 'neg'}>
              {Number(data[hover].change_pct) >= 0 ? '▲' : '▼'} {Math.abs(Number(data[hover].change_pct)).toFixed(2)}%
            </span>
          )}
        </div>
      )}

      <details className="datatable">
        <summary>Show as a table</summary>
        <div className="tablewrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr><th>Month</th><th className="num">Value</th><th className="num">Change</th><th className="num">Change %</th></tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month_end}>
                  <td>{monthLabel(d.month_end)}</td>
                  <td className="num">{inr(d.total_value)}</td>
                  <td className="num">{d.change_amount == null ? '—' : inr(d.change_amount)}</td>
                  <td className="num">{d.change_pct == null ? '—' : `${Number(d.change_pct).toFixed(2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
