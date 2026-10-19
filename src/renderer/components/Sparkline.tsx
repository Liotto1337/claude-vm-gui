const W = 360;

/**
 * График за последние минуты: первая линия — с заливкой цветом --chart, вторая — пунктиром.
 * max — верх шкалы (для процентов 100), иначе по максимуму значений.
 */
export function Sparkline({ series, max, label, height = 56 }: { series: number[][]; max?: number; label: string; height?: number }) {
  const n = Math.max(...series.map((s) => s.length), 0);
  const top = max ?? Math.max(1, ...series.flat());
  const pad = 4;
  const x = (i: number, len: number) => (len <= 1 ? W : (i / (len - 1)) * W);
  const y = (v: number) => height - pad - (Math.min(v, top) / top) * (height - pad * 2);
  const path = (s: number[]) => s.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, s.length).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const [first, second] = series;
  return (
    <svg
      className="spark"
      width="100%"
      height={height}
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      data-points={n}
    >
      {first && first.length > 1 ? (
        <>
          <path d={`${path(first)} L${W} ${height} L0 ${height} Z`} fill="var(--chart)" opacity="0.16" />
          <path d={path(first)} fill="none" stroke="var(--chart)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </>
      ) : null}
      {second && second.length > 1 ? (
        <path d={path(second)} fill="none" stroke="var(--text-3)" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}
