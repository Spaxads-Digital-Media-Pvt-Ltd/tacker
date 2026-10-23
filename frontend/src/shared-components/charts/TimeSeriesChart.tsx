/**
 * TimeSeriesChart — the shared line / area / bar chart (hand-rolled SVG, no chart dependency).
 *
 *  - Sizes itself to its container (ResizeObserver); height is fixed.
 *  - "Nice" y ticks (1 / 2 / 2.5 / 5 × 10ⁿ steps) on a domain that always includes 0.
 *  - Lines are Catmull-Rom curves with control points clamped to each segment's y-range, so a curve
 *    never overshoots past the data (no fake dips below 0 or peaks above the max).
 *  - `null` values are gaps: the line breaks (an isolated point still shows as a dot), no bar.
 *  - Point markers only when there are ≤ 45 categories.
 *  - Hover, touch, or keyboard (focus the chart, then ← / → / Home / End; Esc hides) shows a tooltip;
 *    the same summary is announced through an aria-live region. A visually hidden data table carries
 *    every value for screen readers.
 *  - Lines draw in once on first mount; bars / areas fade in once. Nothing animates under
 *    prefers-reduced-motion.
 *
 * Colours come from tokens only (metric hues / brand). It never mixes units or currencies: every
 * series shares one y axis, so the caller passes series of one unit and the matching formatters
 * (lib/moneyFormat for money in ONE currency). Labels arrive pre-formatted in the report zone.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { StateBlock } from '../primitives/ui';
import { curvePath, niceTicks, runs } from './chartMath';

export type SeriesTone = 'brand' | 'revenue' | 'payout' | 'margin' | 'clicks' | 'conversions';
export interface ChartSeries {
  key: string;
  label: string;
  tone?: SeriesTone;
  /** One value per label; null = no data for that bucket (drawn as a gap). */
  values: (number | null)[];
}

// Full class strings (Tailwind only emits classes it can see).
const TONE: Record<SeriesTone, { stroke: string; fill: string; area: string; dot: string }> = {
  brand: { stroke: 'stroke-brand', fill: 'fill-brand', area: 'fill-brand/10', dot: 'bg-brand' },
  revenue: { stroke: 'stroke-metric-revenue', fill: 'fill-metric-revenue', area: 'fill-metric-revenue/10', dot: 'bg-metric-revenue' },
  payout: { stroke: 'stroke-metric-payout', fill: 'fill-metric-payout', area: 'fill-metric-payout/10', dot: 'bg-metric-payout' },
  margin: { stroke: 'stroke-metric-margin', fill: 'fill-metric-margin', area: 'fill-metric-margin/10', dot: 'bg-metric-margin' },
  clicks: { stroke: 'stroke-metric-clicks', fill: 'fill-metric-clicks', area: 'fill-metric-clicks/10', dot: 'bg-metric-clicks' },
  conversions: { stroke: 'stroke-metric-conversions', fill: 'fill-metric-conversions', area: 'fill-metric-conversions/10', dot: 'bg-metric-conversions' },
};

const MAX_MARKERS = 45;
const PAD = { top: 12, right: 12, bottom: 28 };
const TICK_FONT_PX = 6.6; // ≈ advance of one 12px tabular digit, for the y-axis gutter

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface TimeSeriesChartProps {
  /** X categories, already formatted in the report zone ("Oct 17", "14:00"). */
  labels: string[];
  series: ChartSeries[];
  kind?: 'line' | 'area' | 'bar';
  /** Accessible name; also the hidden data table's caption. */
  title: string;
  /** Total SVG height in px (axes included). */
  height?: number;
  /** Tooltip / data-table value. Default: en-US number. */
  formatValue?: (v: number) => string;
  /** Y-axis tick label. Default: compact en-US number. */
  formatTick?: (v: number) => string;
  /** Tooltip heading for a category. Default: the label. */
  tooltipTitle?: (index: number) => string;
  /** Shown instead of the chart when there is no non-null value. */
  emptyText?: ReactNode;
  className?: string;
}

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function TimeSeriesChart({
  labels, series, kind = 'line', title, height = 240,
  formatValue = (v) => NUM.format(v), formatTick = (v) => COMPACT.format(v),
  tooltipTitle, emptyText = 'No data for this period.', className = '',
}: TimeSeriesChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(prefersReducedMotion);

  const n = labels.length;
  const hasData = series.some((s) => s.values.some((v) => v !== null && Number.isFinite(v)));
  const showChart = hasData && n > 0;

  // The plot box only exists while there is data — re-attach when it (re)appears.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showChart]);

  const geo = useMemo(() => {
    const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
    const yMin = ticks[0]!;
    const yMax = ticks[ticks.length - 1]!;
    const tickText = ticks.map(formatTick);
    const left = Math.ceil(Math.max(...tickText.map((t) => t.length)) * TICK_FONT_PX) + 12;
    const plotW = Math.max(1, width - left - PAD.right);
    const plotH = Math.max(1, height - PAD.top - PAD.bottom);
    const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
    const band = plotW / Math.max(1, n);
    const x = kind === 'bar' || n === 1
      ? (i: number) => left + band * (i + 0.5)
      : (i: number) => left + (i * plotW) / (n - 1);
    // X labels: as many as fit (~64px each); always the last one, dropping a crowded neighbour.
    const fit = Math.max(2, Math.floor(plotW / 64));
    const step = Math.max(1, Math.ceil(n / fit));
    const shown = new Set<number>();
    for (let i = 0; i < n; i += step) shown.add(i);
    if (n > 1) {
      const lastShown = Math.max(...shown);
      if (lastShown !== n - 1) {
        if (n - 1 - lastShown < step * 0.6) shown.delete(lastShown);
        shown.add(n - 1);
      }
    }
    return { ticks, tickText, left, plotW, plotH, y, x, band, shown, yMin };
  }, [series, width, height, n, kind, formatTick]);

  const markers = n <= MAX_MARKERS;
  const baseY = geo.y(Math.max(geo.yMin, 0));

  const indexAt = (clientX: number, rectLeft: number) => {
    const px = clientX - rectLeft - geo.left;
    const i = kind === 'bar' || n === 1 ? Math.floor(px / geo.band) : Math.round((px * (n - 1)) / geo.plotW);
    return Math.min(n - 1, Math.max(0, i));
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!n) return;
    setActive(indexAt(e.clientX, e.currentTarget.getBoundingClientRect().left));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    const cur = active ?? -1;
    const next = e.key === 'ArrowRight' ? Math.min(n - 1, cur + 1)
      : e.key === 'ArrowLeft' ? (cur < 0 ? n - 1 : Math.max(0, cur - 1))
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (e.key === 'Escape') { setActive(null); return; }
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  const heading = (i: number) => tooltipTitle?.(i) ?? labels[i] ?? '';
  const valueText = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? 'No data' : formatValue(v));
  const summary = active === null ? '' : `${heading(active)}: ${series.map((s) => `${s.label} ${valueText(s.values[active])}`).join(', ')}`;

  if (!showChart) {
    return <div className={className}><StateBlock variant="empty" title={emptyText} /></div>;
  }

  const ax = active === null ? 0 : geo.x(active);
  const tipOnLeft = active !== null && ax > width / 2;
  const animLine = !drawn ? 'animate-draw-line' : '';
  const animFade = !drawn ? 'animate-fade-in' : '';
  const groupW = geo.band * 0.7;
  const barW = Math.max(1, groupW / series.length - (series.length > 1 ? 2 : 0));

  return (
    <div className={className}>
      {series.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-tiny text-fg-secondary" aria-hidden>
          {series.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${TONE[s.tone ?? 'brand'].dot}`} />{s.label}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={boxRef}
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={`${title}. Use the left and right arrow keys to read values.`}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className="relative w-full touch-pan-y rounded-[var(--radius)]"
        style={{ height }}
      >
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible" aria-hidden
            onPointerMove={onPointerMove} onPointerLeave={() => setActive(null)}
            onAnimationEnd={(e) => { if (kind === 'bar' || e.animationName === 'draw-line') setDrawn(true); }}>
            {/* Grid + y ticks */}
            {geo.ticks.map((t, i) => (
              <g key={t}>
                <line x1={geo.left} x2={geo.left + geo.plotW} y1={geo.y(t)} y2={geo.y(t)}
                  className="stroke-border" strokeDasharray={t === 0 ? undefined : '3 3'} />
                <text x={geo.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-fg-muted text-tiny tabular-nums">{geo.tickText[i]}</text>
              </g>
            ))}
            {/* X labels */}
            {labels.map((l, i) => geo.shown.has(i) && (
              <text key={i} x={geo.x(i)} y={height - 8}
                textAnchor={kind !== 'bar' && n > 1 && i === 0 ? 'start' : kind !== 'bar' && n > 1 && i === n - 1 ? 'end' : 'middle'}
                className="fill-fg-muted text-tiny">{l}</text>
            ))}
            {/* Active band (bars) / crosshair (lines) */}
            {active !== null && (kind === 'bar'
              ? <rect x={geo.left + geo.band * active} y={PAD.top} width={geo.band} height={geo.plotH} className="fill-fg/5" />
              : <line x1={ax} x2={ax} y1={PAD.top} y2={PAD.top + geo.plotH} className="stroke-border-strong" />)}

            {kind === 'bar' ? series.map((s, si) => (
              <g key={s.key} className={`${TONE[s.tone ?? 'brand'].fill} ${animFade}`}>
                {s.values.map((v, i) => {
                  if (v === null || !Number.isFinite(v)) return null;
                  const top = Math.min(geo.y(v), baseY);
                  const h = Math.max(v === 0 ? 0 : 1, Math.abs(baseY - geo.y(v)));
                  const bx = geo.left + geo.band * i + (geo.band - groupW) / 2 + si * (barW + (series.length > 1 ? 2 : 0));
                  return <rect key={i} x={bx} y={top} width={barW} height={h} rx={Math.min(3, barW / 2)}
                    className={active !== null && active !== i ? 'opacity-60' : undefined} />;
                })}
              </g>
            )) : series.map((s) => {
              const tone = TONE[s.tone ?? 'brand'];
              const segs = runs(s.values, (i, v) => ({ x: geo.x(i), y: geo.y(v) }));
              return (
                <g key={s.key}>
                  {/* Area: one flat tint of the series hue (no gradients). */}
                  {kind === 'area' && segs.filter((r) => r.length > 1).map((r, ri) => (
                    <path key={`a${ri}`} className={`${tone.area} ${animFade}`}
                      d={`${curvePath(r)} L${r[r.length - 1]!.x},${baseY} L${r[0]!.x},${baseY} Z`} />
                  ))}
                  {segs.filter((r) => r.length > 1).map((r, ri) => (
                    <path key={`l${ri}`} d={curvePath(r)} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                      pathLength={drawn ? undefined : 1}
                      style={drawn ? undefined : { strokeDasharray: 1, strokeDashoffset: 1, animationDuration: 'calc(var(--dur-slow) * 2)' }}
                      className={`${tone.stroke} ${animLine}`} />
                  ))}
                  {/* Markers (≤ 45 points), and always for an isolated point between gaps. */}
                  {segs.flatMap((r, ri) => (markers || r.length === 1 ? r : []).map((p, pi) => (
                    <circle key={`m${ri}-${pi}`} cx={p.x} cy={p.y} r={3} strokeWidth={2} className={`fill-surface ${tone.stroke} ${animFade}`} />
                  )))}
                  {active !== null && s.values[active] !== null && Number.isFinite(s.values[active]!) && (
                    <circle cx={ax} cy={geo.y(s.values[active]!)} r={4.5} strokeWidth={2} className={`fill-surface ${tone.stroke}`} />
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {active !== null && (
          <div
            className="pointer-events-none absolute z-10 min-w-[10rem] rounded-[var(--radius)] border border-border bg-elevated px-3 py-2 text-small shadow-elevated"
            style={{ top: PAD.top, left: tipOnLeft ? ax - 12 : ax + 12, transform: tipOnLeft ? 'translateX(-100%)' : undefined }}
          >
            <p className="mb-1 font-semibold text-fg">{heading(active)}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center gap-2 whitespace-nowrap text-fg-secondary">
                <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[s.tone ?? 'brand'].dot}`} />
                <span className="flex-1">{s.label}</span>
                <span className="font-semibold tabular-nums text-fg">{valueText(s.values[active])}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">{summary}</p>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr><th scope="col">Period</th>{series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={i}><th scope="row">{heading(i) || l}</th>{series.map((s) => <td key={s.key}>{valueText(s.values[i])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
