import type { UsageWindow } from '@shared/ipc';
import { formatReset, formatTokens } from '@shared/usage';
import { useAppState } from '../state';
import { Bar } from './Bar';

function Limit({ label, w, now }: { label: string; w: UsageWindow; now: number }) {
  const reset = formatReset(w.resetsAt, now);
  return (
    <div className="usage-row">
      <div className="usage-head">
        <span>{label}</span>
        <span className="caption">{w.pct} %{reset ? ` · сброс ${reset}` : ''}</span>
      </div>
      <Bar label={label} used={w.pct} total={100} thin />
    </div>
  );
}

/** Расход Claude внизу сайдбара: лимиты подписки (5 часов, неделя) и токены за сегодня по всем сессиям. */
export function UsageBox() {
  const { usage } = useAppState();
  if (!usage) return null;
  const { limits, tokens } = usage;
  const total = tokens ? tokens.input + tokens.output + tokens.cacheWrite + tokens.cacheRead : 0;
  return (
    <section className="usage" aria-label="Расход Claude">
      {limits?.fiveHour ? <Limit label="5 часов" w={limits.fiveHour} now={usage.t} /> : null}
      {limits?.week ? <Limit label="Неделя" w={limits.week} now={usage.t} /> : null}
      {tokens ? (
        <div
          className="caption usage-tokens"
          title={`Ввод ${formatTokens(tokens.input)} · вывод ${formatTokens(tokens.output)} · запись в кэш ${formatTokens(tokens.cacheWrite)} · чтение из кэша ${formatTokens(tokens.cacheRead)}`}
        >
          Сегодня: {formatTokens(total)} токенов
        </div>
      ) : null}
    </section>
  );
}
