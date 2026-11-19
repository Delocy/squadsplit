import { fixupLabel, type TotalCheck } from '../receipt/fixup'

/**
 * The one line saying the items don't add up to the bill's total, and (when they're short) the button that adds the
 * rest as Other, shared by everyone, on its own line. In the group expense form and Quick split's bill.
 */
export function TotalFixup({ check, money, onAdd }: { check: TotalCheck; money: (cents: number) => string; onAdd: () => void }) {
  return (
    <div className="fixup" role="status">
      <p className="left">{check.message}</p>
      {check.other && (
        <>
          <button type="button" className="btn small" onClick={onAdd}>
            {fixupLabel(check.other, money)}
          </button>
          <span className="field-hint">It's added as Other, shared by all.</span>
        </>
      )}
    </div>
  )
}
