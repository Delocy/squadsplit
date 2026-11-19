import { formatMoney } from '@squadsplit/shared'

/** An amount of integer cents in a currency. `signed` adds +/− and colours it by sign. */
export function Money({ cents, currency, signed = false }: { cents: number; currency: string; signed?: boolean }) {
  const text = formatMoney(Math.abs(cents), currency)
  if (!signed) return <span>{text}</span>
  const tone = cents > 0 ? 'pos' : cents < 0 ? 'neg' : 'zero'
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : ''
  return <span className={tone}>{sign + text}</span>
}
