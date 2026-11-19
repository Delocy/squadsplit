# SquadSplit visual reference

`playground/` holds the approved look for the web app. It's a throwaway Vite page that renders the real `@squadsplit/shared` money logic with fake data. The web app (`apps/web`) must reproduce it:

- **Tokens:** warm off-white background `#f8f4f2`, white cards, plum ink `#3d2c42`, accent pink `#f0609a`, and pastel per-person colours. Includes a dark-mode set.
- **Type:** Fredoka for headings and numbers, Nunito for body text.
- **Shapes:** 2px plum outlines with a 2px hard offset shadow, an 18px card radius, and calm, plain wording.
- **Logo:** the SquadSplit pup (`mascot('dog', …)`): an original light-tan puppy with darker brown floppy ears and a small cream muzzle with a button nose. It's the top-bar logo mark, the landing hero logo, and the mascot on the loading and "can't reach sign-in" screens. It's never an avatar.
- **Art:** original SVG animal mascots (bunny, bear, panda, kitten) whose mood changes with the balance, plus SVG category, badge and UI icons. These four are the avatars; the pup is only the logo. All of it is in `playground/icons.ts`. **No emoji anywhere in the visible UI.** Stored category values are emoji, but they're mapped to SVG art for display. Never use real Sanrio or other third-party characters (the pup must not look like Pochacco or Pompompurin: no white body with black ears, no golden body with a beret).
- **Layout:**
  - a top bar with the group name and a "viewing as" switcher (in the app: the signed-in user's avatar)
  - a summary strip with the balance card and its mood mascot, a stats card, and quick actions
  - a main column with Settle up (and its needs-action count) and a tabbed Activity feed
  - a side column with the leaderboard and its badge grid, and the wheel
  - Add expense as a modal dialog, opened from a floating button on mobile
- **Motion (the user specifically likes it, so keep it):**
  - The balance mascot bobs gently, and shivers when you owe money. The logo bobs too.
  - Badge art floats, with staggered delays. Avatars, category tiles and badge art tilt or bounce on hover.
  - Rows that need your action have a bobbing avatar, and the wheel pointer ticks.
  - The wheel spins for 3 seconds, and the winner pops in with a shivering avatar.
  - SVG heart and star confetti bursts when you add an expense, confirm a payment, or the wheel picks someone.
  - All of it is switched off under `prefers-reduced-motion`.
