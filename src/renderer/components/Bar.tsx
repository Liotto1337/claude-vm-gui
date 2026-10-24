export const pct = (used: number, total: number) => (total > 0 ? Math.round((used / total) * 100) : 0);
/** От 80 % — глина, от 90 % — красный */
export const level = (p: number) => (p >= 90 ? 'bar-danger' : p >= 80 ? 'bar-warn' : '');

/** Полоска заполнения (диски, память, лимиты Claude). */
export function Bar({ label, used, total, thin = false }: { label: string; used: number; total: number; thin?: boolean }) {
  const p = pct(used, total);
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} className={`bar${thin ? ' bar-thin' : ''} ${level(p)}`}>
      <div className="bar-fill" style={{ width: `${p}%` }} />
    </div>
  );
}
