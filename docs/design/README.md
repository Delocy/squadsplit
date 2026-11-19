# SquadSplit visual reference

`playground/` holds the approved look for the web app. It's a throwaway Vite page that renders the real `@squadsplit/shared` money logic with fake data. The web app (`apps/web`) must reproduce it:

- **Tokens:** warm off-white background `#f8f4f2`, white cards, plum ink `#3d2c42`, accent pink `#f0609a`, and pastel per-person colours. Includes a dark-mode set.
- **Type:** Fredoka for headings and numbers, Nunito for body text.
- **Shapes:** 2px plum outlines with a 2px hard offset shadow, an 18px card radius, and calm, plain wording.
- **Art:** original SVG animal mascots (bunny, bear, panda, kitten) whose mood changes with the balance, plus SVG category, badge and UI icons. All of it is in `playground/icons.ts`. **No emoji anywhere in the visible UI.** Stored category values are emoji, but they're mapped to SVG art for display. Never use real Sanrio or other third-party characters.
- **Layout:**
  - a top bar with the group name and a "viewing as" switcher (in the app: the signed-in user's avatar)
  - a summary strip with the balance card and its mood mascot, a stats card, and quick actions
  - a main column with Settle up (and its needs-action count) and a tabbed Activity feed
  - a side column with the leaderboard and its badge grid, and the wheel
  - Add expense as a modal dialog, opened from a floating button on mobile
