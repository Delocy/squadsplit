import { fixupLabel, type TotalCheck } from '../receipt/fixup'

/**
 * The one line saying the items don't add up to the bill's total, and (when they're short) the button that adds the
 * rest as Other on its own line: shared by all `sharers`, or on the payer's share when it's too small to split. In
 * the group expense form and Quick split's bill. Screen readers hear when it starts or turns around, not each
 * keystroke's new amounts.
 */
export function TotalFixup({
  check,
  sharers,
  money,
  onAdd,
}: {
  check: TotalCheck
  sharers: number
  money: (cents: number) => string
  onAdd: () => void
}) {
  return (
    <div className="fixup">
      <span className="sr-only" role="status">
        {check.diff > 0 ? 'The items come to less than the total.' : 'The items come to more than the total.'}
      </span>
      <p className="left">{check.message}</p>
      {check.other && (
        <>
          <button type="button" className="btn small" onClick={onAdd}>
            {fixupLabel(check.other, money)}
          </button>
          <span className="field-hint">
            {check.other.priceCents < sharers ? "It's too small to split, so it goes on the payer's share." : "It's added as Other, shared by all."}
          </span>
        </>
      )}
    </div>
  )
}
