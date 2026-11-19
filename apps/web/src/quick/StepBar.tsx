export const STEPS = ['Bill', 'People', 'Assign', 'Share'] as const
/** The steps you can go back to; Share is where saving lands. */
export type Step = 0 | 1 | 2

/** Bill · People · Assign · Share, with the steps already done as buttons back to them. */
export function StepBar({ now, onPick }: { now: number; onPick?: (step: Step) => void }) {
  return (
    <ol className="qs-steps" aria-label="Steps">
      {STEPS.map((label, i) => (
        <li key={label} className={i < now ? 'done' : i === now ? 'now' : undefined} aria-current={i === now ? 'step' : undefined}>
          {i < now && onPick && i < 3 ? (
            <button type="button" onClick={() => onPick(i as Step)}>
              {label}
            </button>
          ) : (
            label
          )}
        </li>
      ))}
    </ol>
  )
}
