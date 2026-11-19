# SquadSplit — Design Spec

A fun, multi-user take on Tricount: friends share expenses inside a group, see who owes whom, settle up with two-sided confirmation, earn silly titles, and spin a wheel to decide who pays next.

Status: agreed design (2026-11-19). Anything marked **v2** is explicitly out of scope for the first release.

---

## 1. Product rules

### Groups and membership
- A **Group** ("squad") is the authorization boundary. Every read and write of group data requires the caller to be a current member.
- Roles: **owner** (the creator) and **member**. No ownership transfer in v1.
- People join only with the group's **invite code**, either typed in or opened as a link (`/join/:code`). The owner can reset the code, which stops the old link working.
- Every participant has an account. There are no guest placeholders.
- A group has at most **12 active members**. Joining a full group (including a former member rejoining) is 409 `group_full`; former members don't count towards the cap.
- A member can **leave**, or the owner can **remove** them, only when that member's group balance is exactly 0. The owner cannot leave in v1 (that would need ownership transfer).
- Leaving is a soft delete (`membership.left_at`), so past expenses still show their names.
- **You in a group** (added 2026-11-19 at the user's request): each membership has its own **animal + colour** avatar and an optional **nickname**.
  - The avatar is one of the 8 member animals (bunny, bear, panda, kitty, fox, hamster, penguin, koala) on one of 6 pastel colours, so 48 combinations. Among a group's **active** members every avatar is unique; former members don't hold theirs.
  - Joining (and creating a group) lets you pick from the combinations that are left. Without a pick you get your default look (a stable hash of your user id), moved on to the first free combination if it's taken. A former member who rejoins keeps their old look if it's still free. Picking a taken one is 409 `avatar_taken`.
  - The nickname is 1–24 characters after trimming, with no control characters and no emoji. Empty clears it. Nicknames don't need to be unique.
  - Inside the group your name is your nickname if you set one, otherwise your profile name. Outside a group (your groups list) the profile name and default look are used.
  - You can change both later in the group's settings.

### Expenses
- Fields: description, amount, payer, date, category emoji, and the participants it's split between (any non-empty subset of current members).
- **Any member can log an expense paid by any member.** `created_by` is recorded separately from `paid_by`.
- Split types:
  - **equal**: `floor(amount / n)` each. Leftover cents go to the payer if the payer is a participant, otherwise one cent each to participants in a stable order (by user id).
  - **exact**: the client sends cents per participant. They must be > 0 and add up exactly to the amount.
  - **itemized** (added 2026-11-19 to fix a real Tricount pain point): the bill is entered as line items. Each item has a name, a price in cents, and the members who shared it.
    - Each item is split equally between its members, using the same remainder rule as **equal** with the payer as the tie-breaker.
    - **Service charge** and **GST** are optional percentages in basis points, each 0–3000. The Singapore preset is 1000 (10%) and 900 (9%).
    - `total = round(subtotal × (1 + sc) × (1 + gst))`. GST is charged on top of the service charge, as Singapore bills do. Use BigInt for the multiplication.
    - Each person's share of the total is allocated in proportion to their item subtotal, using the largest-remainder method. Ties go to the lower user id. This keeps every share a whole number of cents and makes the shares add up to the total exactly.
    - The expense's `amount_cents` must equal that total.
    - If anyone would end up with a 0-cent share, the request is rejected with 422 `amount_too_small`.
    - The participants are everyone who appears on at least one item.
- Only the **creator** or the **group owner** can edit or delete an expense.
- **Lock rule:** an expense is locked (no edit or delete) once a *confirmed* settlement exists whose debtor or creditor is among the expense's people (payer ∪ participants) and whose `resolved_at` is later than the expense's `created_at`.

### Money
- One currency per group, chosen when the group is created (ISO code, default `SGD`). It cannot be changed after the first expense.
- All amounts are **integer cents**. No floating point anywhere in money code.
- **Ready for multiple currencies later:**
  - Every expense stores `currency` and `fx_rate_ppm`, an integer exchange rate in parts per million.
  - In v1, `currency` must equal the group's currency (otherwise 422 `currency_mismatch`) and `fx_rate_ppm` is always 1000000.
  - Adding real multiple-currency support later then needs no schema change.

### Settle-up (the shared, two-party action)
- Only the **debtor** starts a settlement: "I paid Bob $40".
- The amount can be anything from 1 cent up to `min(debtor's debt, creditor's credit)`, after subtracting the debtor's other pending outgoing settlements.
- Lifecycle: `pending → confirmed | rejected | cancelled`
  - The **creditor** confirms or rejects it.
  - The **debtor** can cancel while it is pending.
  - Every transition is final.
- Only **confirmed** settlements change balances.
- The app shows **suggested transfers** (simplified debts), and a suggestion pre-fills the form.

### Balances
For each member: `net = Σ paid − Σ shares + Σ confirmed settlements sent − Σ confirmed settlements received`.
`net > 0` means the group owes you; `net < 0` means you owe. The nets of a group always add up to 0.

**Simplified debts:** a greedy match that repeatedly pairs the largest debtor with the largest creditor and transfers `min(|debt|, credit)`.

### Fun: badges and leaderboard (worked out live; there is no badge table)
One pure function, `computeBadges(groupData)`. A badge needs a single clear holder: ties mean nobody gets it, and it is never given out for a value of 0. The exception is 👻 Ghost, which goes to every member who matches. Only current members can hold badges.

| Badge | Rule |
|---|---|
| 👺 Debt Goblin | most negative net balance |
| 💸 Biggest Spender | highest total paid |
| 👻 Ghost | has shares but has never paid an expense |
| 🍻 Bar Tab Champion | highest total paid in the 🍻 category |
| 🤝 Good Egg | most confirmed settlements sent |
| 🎰 Wheel Victim | most times picked by the wheel |

The **leaderboard** ranks members by net balance, most owed first.

### Fun: "Who pays?" wheel
- The draw is weighted towards debtors: `weight_i = 1 + 3 · debt_i / maxDebt`, where `debt_i = max(0, −net_i)`. If nobody owes anything, every weight is 1.
- The pick happens **on the server** with `crypto.getRandomValues`, so the client can't fiddle the result. The client only animates to the winner the server returns.
- Every spin is saved (who spun, the winner, a snapshot of the weights) and appears in the group feed. It **does not change any money.**

### Feed
Expenses, confirmed settlements, spins and joins, all in one list, newest first.

### Freshness
No live connection. TanStack Query refetches when the tab regains focus and after the user's own changes. (v2: WebSockets through Durable Objects.)

---

## 2. Data model (D1 / SQLite with Drizzle)

```
users          id (pk, text: Clerk user id), display_name, avatar_url, created_at
groups         id (pk, uuid), name, emoji, currency, invite_code (unique), owner_id → users, created_at
memberships    group_id → groups, user_id → users, role ('owner'|'member'), joined_at, left_at (nullable),
               avatar_animal (nullable), avatar_color (nullable), nickname (nullable)
               pk(group_id, user_id)
               avatar_* null (rows from before migration 0002) means the user's default look; nickname null means the profile name
expenses       id (pk), group_id, description, amount_cents (int > 0), paid_by → users, created_by → users,
               category (emoji text), spent_on (date), split_type ('equal'|'exact'|'itemized'),
               currency, fx_rate_ppm (int, default 1000000), service_charge_bps (int, nullable), gst_bps (int, nullable),
               created_at, updated_at
expense_shares expense_id → expenses (cascade), user_id → users, amount_cents (int > 0)
               pk(expense_id, user_id)
expense_items  id (pk), expense_id → expenses (cascade), position (int), name, amount_cents (int > 0)
expense_item_users item_id → expense_items (cascade), user_id → users      pk(item_id, user_id)
settlements    id (pk), group_id, from_user_id (debtor), to_user_id (creditor), amount_cents,
               status ('pending'|'confirmed'|'rejected'|'cancelled'), created_at, resolved_at
spins          id (pk), group_id, spun_by → users, winner_id → users, weights_json, created_at
```

The rule "shares add up to the amount" is enforced in the service layer, inside a single D1 `batch` (transaction).

**Users:** the Worker checks the Clerk session JWT. The first time a user id is seen, it fetches the profile from Clerk's Backend API and creates the `users` row. That row is refreshed on `GET /me`.

---

## 3. API (Hono on Cloudflare Workers)

Every route needs a valid Clerk session (`Authorization: Bearer <token>`), except `GET /health`.

Error responses:
- `401` not signed in
- **`404` not a member.** We don't reveal whether the group exists.
- `403` a member without permission
- `409` the current state blocks the action (balance not zero, expense locked, settlement no longer pending)
- `422` validation failed (zod)

| Method & path | Who may call |
|---|---|
| `GET /me` | any user |
| `GET /groups` | any user (returns their own groups) |
| `POST /groups` (optional `nickname` for the owner) | any user (they become the owner) |
| `GET /groups/:id` | member |
| `PATCH /groups/:id` (name, emoji; currency only before the first expense) | owner |
| `POST /groups/:id/invite/reset` | owner |
| `GET /invites/:code` (preview: group name, emoji, member count, the avatars already taken) | any user |
| `POST /invites/:code/join` (optional body `{ avatar?, nickname? }`) | any user (does nothing if already a member) |
| `PATCH /groups/:id/members/me` (`{ avatar?, nickname? }`, at least one; `nickname: null` or `""` clears) | member |
| `DELETE /groups/:id/members/:userId` | that user (leaving) or the owner (removing); balance must be 0 |
| `GET /groups/:id/balances` (nets + suggested transfers) | member |
| `GET /groups/:id/expenses`, `POST /groups/:id/expenses` | member |
| `PATCH /expenses/:id`, `DELETE /expenses/:id` | creator or owner, and not locked |
| `POST /groups/:id/settlements` | member (the caller is the debtor) |
| `POST /settlements/:id/confirm`, `/reject` | creditor |
| `POST /settlements/:id/cancel` | debtor |
| `GET /groups/:id/badges` (badges + leaderboard) | member |
| `POST /groups/:id/spins` | member |
| `GET /groups/:id/feed` | member |

Request and response schemas are zod objects in `packages/shared`, used by both the API (validation) and the web app (types).

---

## 4. Frontend (React + Vite + TS on Cloudflare Pages)

- Clerk React components handle sign-in (Google, GitHub, email).
- TanStack Query for server state; React Router for pages.
- Screens:
  - Landing / sign-in
  - My groups
  - Create group
  - Join (`/join/:code`)
  - **Group home:** my balance card, the leaderboard with badges, "needs your action" (settlements waiting for me to confirm), suggested settle-ups, and the feed
  - Add/edit expense
  - Wheel (an animated spin)
  - Group settings (invite link and QR code, members)
- Works on a phone first, since people use it at the dinner table.

---

## 5. Repo, tooling and deploy

```
squadsplit/                  (npm workspaces)
  apps/web                   React + Vite  → Cloudflare Pages
  apps/api                   Hono Worker + Drizzle + D1 migrations → Cloudflare Workers
  packages/shared            zod schemas, types, pure money logic (balances, splits, simplify, badges, weights)
  .github/workflows/ci.yml   typecheck + test on PRs; on push to main: test → D1 migrate → deploy api → deploy web
```

- GitHub: `Delocy/squadsplit`, public.
- Tests:
  - **Vitest** unit tests for all the pure money logic in `packages/shared`
  - **API tests** using `@cloudflare/vitest-pool-workers` against a local D1, covering the permission matrix above with Clerk mocked
  - No browser end-to-end tests in v1
- URLs: the free `*.pages.dev` and `*.workers.dev` addresses. The API allows requests (CORS) only from the web app's origin.
- Secrets:
  - **GitHub:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_CLERK_PUBLISHABLE_KEY`
  - **Worker** (set with `wrangler secret put`): `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`
  - The person who owns the accounts sets these; they are never put in the repo.

## 6. Roadmap after v1

**v1.1** (agreed 2026-11-19; these address Tricount and Splitwise pain points):
- **Settle up with a PayNow QR.** It's pre-filled with the creditor's opted-in PayNow phone number and the amount. The app never handles money.
- **"Poke" nudges** on a debt, and an optional weekly email summary.
- **Export to CSV.**
- **Install as a phone app (PWA)** with an offline queue for new expenses.
- **Scan a receipt** using Cloudflare Workers AI (`@cf/meta/llama-3.2-11b-vision-instruct` through the Worker's AI binding). This is free within the shared 10,000-neurons/day allowance, about 40 neurons per receipt.
  - The client downsizes the photo to about 1024px and strips EXIF.
  - `POST /groups/:id/receipts/scan` is for members only.
  - The model is prompted for strict JSON: `{items:[{name, amountCents}], serviceChargeBps?, gstBps?, totalCents?}`. The response is validated with zod and cross-checked with `itemizedTotal`, with a warning if they don't match.
  - The result pre-fills the itemized form, where the user assigns people.
  - The image is never stored.
  - Each user can scan up to 20 receipts a day.
  - Meta's licence may need a one-time acceptance on the Cloudflare account.

**Later:** repeating expenses (such as rent) and real support for multiple currencies (the columns already exist).

**Out of scope (v2):**
Percentage or share splits, guest participants, ownership transfer, deleting a group, live updates, a preview deploy per PR, a custom domain, permanent achievements, comments and reactions.
