# SquadSplit v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a multi-user, auth-based, fun Tricount clone (groups, expenses, two-sided settle-up, live badges, a weighted "who pays?" wheel) deployed free on Cloudflare.

**Architecture:** npm-workspaces monorepo. `packages/shared` holds every money rule as pure, unit-tested functions plus the zod API contract. `apps/api` is a Hono Worker over D1 (Drizzle) that loads a group's ledger, calls the shared functions and enforces membership-based authorization. `apps/web` is a React SPA on Pages that talks to the API with a Clerk session token.

**Tech Stack:** TypeScript (strict, ESM), Hono, Drizzle ORM + drizzle-kit, Cloudflare D1/Workers/Pages, wrangler, `@clerk/backend`, `@clerk/clerk-react`, React 18 + Vite, React Router, TanStack Query, zod, Vitest, `@cloudflare/vitest-pool-workers`, Testing Library.

**Spec:** `docs/spec.md`

## Global Constraints

- Node 22 and npm workspaces. **Do not use pnpm** (corepack is broken on the dev machine).
- Install the current stable version of each dependency and commit `package-lock.json`.
- All money is integer cents (`number`, always `Number.isInteger`). No floats in any money calculation; `formatMoney` is the only place cents become a display string.
- Currencies are limited to two-decimal ones: `SGD` (default), `USD`, `EUR`, `GBP`, `MYR`, `AUD`, `NZD`, `HKD`, `THB`.
- Categories: `🍕 🍻 🚕 🏨 🛒 🎟️ ✈️ 💡 🎁 💸` (💸 = other).
- Expense amount must be between 1 and 100_000_000 cents. Description: 1–100 chars. Group name: 1–50 chars.
- HTTP errors: 401 unauthenticated · **404 when the caller is not a member** · 403 member without permission · 409 blocked by state · 422 validation. JSON body: `{ "error": { "code": string, "message": string } }`.
- No auth backdoors in production code. Tests inject fake auth through `createApp(deps)`.
- Secrets never go in the repo. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Equal split smaller than the head count** (e.g. 2¢ across 3 people) would produce 0¢ shares. Expect 422 "amount too small to split". Test: Task 1.
2. **Former members** stay in balances and history but must not win badges, appear on the leaderboard, be picked by the wheel, or be chosen as a payer, participant or settlement creditor. Tests: Tasks 3, 7, 8.
3. **Settling with yourself, with a non-member, or over-settling through several pending settlements.** Expect 422, 422 and 409 respectively. Test: Task 8.
4. **Invite lifecycle:** an old code stops working after a reset (404); joining twice does nothing; a member who left can rejoin with the current code and their membership is reactivated. Test: Task 6.
5. **Changing the currency after the first expense** → 409. **Owner tries to leave** → 409. Test: Task 6.

---

## File structure

```
package.json                    workspaces: apps/*, packages/*; scripts: typecheck, test, build
tsconfig.base.json              strict, ES2022, moduleResolution bundler
packages/shared/src/
  money.ts      Cents, splitEqual, formatMoney, CURRENCIES, CATEGORIES
  ledger.ts     Ledger types, computeBalances, simplifyDebts, maxSettlementAmount, isExpenseLocked
  fun.ts        computeBadges, computeLeaderboard, spinWeights, pickWeighted
  schemas.ts    zod inputs + DTO types (the API contract)
  index.ts      re-exports
apps/api/
  wrangler.toml, drizzle.config.ts, migrations/, vitest.config.ts
  src/index.ts        default export: createApp(realDeps)
  src/app.ts          createApp(deps), cors, error handler, route mounting
  src/deps.ts         AuthDeps type + clerkDeps(env)
  src/env.ts          Bindings type
  src/errors.ts       HttpError + helpers
  src/db/schema.ts    Drizzle tables
  src/db/ledger.ts    loadLedger(db, groupId)
  src/access.ts       requireMember, requireOwner
  src/routes/{me,groups,invites,expenses,settlements,fun}.ts
  test/helpers.ts     testApp(), as(userId), seed helpers
apps/web/src/
  main.tsx, api.ts, routes.tsx
  pages/{Landing,Groups,CreateGroup,Join,GroupHome,ExpenseForm,Wheel,GroupSettings}.tsx
  components/{BalanceCard,Leaderboard,PendingActions,SuggestedTransfers,Feed,Money}.tsx
.github/workflows/ci.yml
docs/deploy.md
```

---

### Task 1: Monorepo scaffold + money primitives

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore` (node_modules, dist, .wrangler, .env*, .dev.vars), `packages/shared/{package.json,tsconfig.json,src/money.ts,src/index.ts}`
- Test: `packages/shared/test/money.test.ts`

**Interfaces:**
- Produces: `type Cents = number`; `CURRENCIES` (readonly tuple, see Global Constraints); `CATEGORIES` (readonly tuple); `splitEqual(amountCents: Cents, participantIds: string[], payerId: string): Record<string, Cents>` (throws `SplitError` with code `"AMOUNT_TOO_SMALL"` when `amountCents < participantIds.length`); `formatMoney(cents: Cents, currency: string): string`. The package name is `@squadsplit/shared`.

- [ ] **Step 1: Scaffold the workspace.** Root scripts: `"typecheck": "npm run typecheck --workspaces --if-present"`, `"test": "npm run test --workspaces --if-present"`. Shared package scripts: `vitest run` and `tsc --noEmit`.
- [ ] **Step 2: Write the failing tests**

```ts
test('splits evenly', () => expect(splitEqual(900, ['a','b','c'], 'a')).toEqual({a:300,b:300,c:300}))
test('remainder goes to payer', () => expect(splitEqual(1000, ['a','b','c'], 'b')).toEqual({a:333,b:334,c:333}))
test('payer not in split: remainder 1¢ each in id order', () =>
  expect(splitEqual(1001, ['c','a','b'], 'z')).toEqual({a:334,b:334,c:333}))
test('rejects amount smaller than head count', () =>
  expect(() => splitEqual(2, ['a','b','c'], 'a')).toThrow(/AMOUNT_TOO_SMALL/))
test('formats', () => expect(formatMoney(123456, 'SGD')).toBe('$1,234.56'))  // en-SG renders SGD as $, USD as US$
```

- [ ] **Step 3: Run** `npm test -w @squadsplit/shared`. Expect FAIL (module missing).
- [ ] **Step 4: Implement `money.ts`.** `formatMoney` uses `Intl.NumberFormat('en-SG', { style: 'currency', currency })`.
- [ ] **Step 5: Run the tests.** Expect PASS. Run `npm run typecheck` and expect no errors.
- [ ] **Step 6: Commit** with the message `chore: scaffold monorepo; feat(shared): money primitives`

### Task 2: Ledger: balances, simplified debts, settlement cap, lock rule

**Files:** Create `packages/shared/src/ledger.ts`. Test: `packages/shared/test/ledger.test.ts`.

**Interfaces:**
- Produces:
```ts
type SettlementStatus = 'pending'|'confirmed'|'rejected'|'cancelled'
interface LedgerShare { userId: string; amountCents: Cents }
interface LedgerExpense { id: string; paidBy: string; amountCents: Cents; category: string; createdAt: string; shares: LedgerShare[] }
interface LedgerSettlement { id: string; fromUserId: string; toUserId: string; amountCents: Cents; status: SettlementStatus; createdAt: string; resolvedAt: string | null }
interface LedgerSpin { winnerId: string; createdAt: string }
interface Ledger { currentMemberIds: string[]; expenses: LedgerExpense[]; settlements: LedgerSettlement[]; spins: LedgerSpin[] }
interface Transfer { fromUserId: string; toUserId: string; amountCents: Cents }
computeBalances(l: Ledger): Record<string, Cents>   // every current member plus anyone in history; values sum to 0
simplifyDebts(balances: Record<string, Cents>): Transfer[]
maxSettlementAmount(l: Ledger, fromUserId: string, toUserId: string): Cents  // 0 if not allowed
isExpenseLocked(e: LedgerExpense, settlements: LedgerSettlement[]): boolean
```
Timestamps are ISO strings and are compared as strings.

- [ ] **Step 1: Write the failing tests:**
  - `computeBalances`: A pays 900 split equally among A, B, C → `{A:600, B:-300, C:-300}`.
  - A confirmed settlement B→A of 300 → `B:0, A:300`.
  - Pending, rejected and cancelled settlements change nothing.
  - The sum of all balances is always 0.
  - `simplifyDebts({A:600,B:-300,C:-300})` → two transfers, B→A 300 and C→A 300.
  - `simplifyDebts({A:500,B:-200,C:-300})` → C→A 300, then B→A 200 (largest debtor first).
  - `simplifyDebts` of all zeros → `[]`.
  - `maxSettlementAmount`: B owes 300, A is owed 600 → 300.
  - With a pending B→A of 100 already → 200.
  - From a creditor → 0.
  - To someone who is not a creditor → 0.
  - `isExpenseLocked`: a confirmed settlement with `resolvedAt` after the expense's `createdAt`, involving its payer or a participant → true.
  - The same settlement pending, or resolved before the expense, or between two outsiders → false.
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.** `simplifyDebts` is greedy: repeatedly pair the most negative balance with the most positive one and transfer `min(|debt|, credit)`. Break ties by user id so the output is deterministic.
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** with the message `feat(shared): ledger balances, simplify, settlement cap, lock rule`

### Task 3: Fun: badges, leaderboard, wheel

**Files:** Create `packages/shared/src/fun.ts`. Test: `packages/shared/test/fun.test.ts`.

**Interfaces:**
- Consumes: `Ledger`, `computeBalances` (Task 2).
- Produces:
```ts
type BadgeKey = 'debt_goblin'|'biggest_spender'|'ghost'|'bar_tab'|'good_egg'|'wheel_victim'
interface Badge { key: BadgeKey; emoji: string; title: string; userId: string }
computeBadges(l: Ledger): Badge[]                    // only current members can hold one
computeLeaderboard(l: Ledger): { userId: string; netCents: Cents; rank: number }[]  // current members, net desc, ties share a rank
spinWeights(l: Ledger): Record<string, number>       // current members only
pickWeighted(weights: Record<string, number>, r: number): string  // r in [0,1); walks sorted user ids
```
Badge table (emoji and title are exact copy): 👺 Debt Goblin, 💸 Biggest Spender, 👻 Ghost, 🍻 Bar Tab Champion, 🤝 Good Egg, 🎰 Wheel Victim. The rules are in spec §1.

- [ ] **Step 1: Write the failing tests:**
  - Each badge is awarded to its single clear holder.
  - A tie for the top spot → no badge.
  - Top value of 0 → no badge.
  - Ghost goes to *every* member who has shares and has never paid. It is the one badge that can have several holders.
  - A former member with the worst balance → no Debt Goblin, and absent from the leaderboard.
  - `spinWeights`: debts {B:300, C:150}, A owes nothing → `{A:1, B:4, C:2.5}`. Nobody owes anything → all 1.
  - `pickWeighted({a:1,b:3}, 0.2)` → `'a'`; `pickWeighted({a:1,b:3}, 0.3)` → `'b'`.
- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement** `fun.ts` and re-export it from `index.ts`.
- [ ] **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** with the message `feat(shared): badges, leaderboard, wheel weights`

### Task 4: API contract (zod schemas + DTOs)

**Files:** Create `packages/shared/src/schemas.ts`. Test: `packages/shared/test/schemas.test.ts`.

**Interfaces:**
- Produces zod schemas and inferred types:
  - `CreateGroupInput {name, emoji, currency}`
  - `UpdateGroupInput` (partial of the above)
  - `CreateExpenseInput {description, amountCents, paidBy, category, spentOn /* YYYY-MM-DD */, split: {type:'equal', participantIds: string[]} | {type:'exact', shares: {userId, amountCents}[]}}`
  - `UpdateExpenseInput` = `CreateExpenseInput`, sent in full
  - `CreateSettlementInput {toUserId, amountCents}`
- DTOs:
  - `MeDTO`
  - `MemberDTO {userId, displayName, avatarUrl, role, active}`
  - `GroupDTO {id, name, emoji, currency, inviteCode /* owner only, else null */, ownerId, members: MemberDTO[]}`
  - `ExpenseDTO` (ExpenseDTO also includes `locked: boolean`, `createdBy`)
  - `SettlementDTO`
  - `BalancesDTO {balances: Record<string,Cents>, suggestions: Transfer[]}`
  - `FunDTO {badges: Badge[], leaderboard}`
  - `SpinDTO {id, winnerId, weights, spunBy, createdAt}`
  - `FeedItem` (a discriminated union on `type: 'expense'|'settlement'|'spin'|'join'`, each with `at`)

- [ ] **Step 1: Write the failing tests:**
  - Exact shares must add up to `amountCents` (refine error on `split`).
  - Duplicate participant ids are rejected.
  - Empty participants are rejected.
  - Currency `JPY` is rejected.
  - Category `🐉` is rejected.
  - `amountCents` of 0, 1.5 or 100_000_001 is rejected.
  - `spentOn` must be a valid YYYY-MM-DD date.
- [ ] **Step 2: Run the tests.** Expect FAIL. **Step 3: Implement.** **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** with the message `feat(shared): zod API contract`

### Task 5: API skeleton: Worker, D1 schema, auth, `/me`

**Files:**
- Create: `apps/api/{package.json,wrangler.toml,drizzle.config.ts,vitest.config.ts,tsconfig.json}`, `src/{index,app,deps,env,errors}.ts`, `src/db/schema.ts`, `src/routes/me.ts`, `migrations/0000_init.sql` (generated), `test/helpers.ts`
- Test: `apps/api/test/me.test.ts`

**Interfaces:**
- Produces:
```ts
interface AuthDeps { verifyToken(token: string): Promise<string /* userId */ | null>;
                     fetchProfile(userId: string): Promise<{ displayName: string; avatarUrl: string | null }> }
createApp(deps: AuthDeps): Hono<{ Bindings: Bindings; Variables: { userId: string } }>
clerkDeps(env: Bindings): AuthDeps            // verifyToken from @clerk/backend with authorizedParties [env.WEB_ORIGIN]
type Bindings = { DB: D1Database; CLERK_SECRET_KEY: string; CLERK_PUBLISHABLE_KEY: string; WEB_ORIGIN: string }
class HttpError(status: 401|403|404|409|422, code: string, message: string)
// test/helpers.ts
testApp(): { as(userId: string): (path: string, init?: RequestInit) => Promise<Response>; anon(path): Promise<Response> }
```
- The Drizzle tables match spec §2 exactly. `wrangler.toml` binds D1 as `DB`, with database name `squadsplit` and `database_id = "REPLACE_ME"` (filled in during Task 13).
- In the Vitest config, `readD1Migrations('migrations')` supplies the migrations to a setup file that runs `applyD1Migrations`.
- Fake deps: the token is the user id, and the display name is `"User <id>"`.
- Auth middleware runs on every route except `/health` and upserts the `users` row on first sight. CORS allows only `WEB_ORIGIN`.

- [ ] **Step 1: Write the failing tests:**
  - `GET /health` → 200 `{ok:true}` with no token.
  - `GET /me` with no token → 401 `{error:{code:'unauthenticated'}}`.
  - `GET /me` as `alice` → 200 `{id:'alice', displayName:'User alice'}`, and the `users` row exists.
  - A second call does not create a second row.
- [ ] **Step 2: Run** `npm test -w apps/api`. Expect FAIL.
- [ ] **Step 3: Implement.** Generate the migration with `npx drizzle-kit generate`.
- [ ] **Step 4: Run the tests.** Expect PASS. Also run `npx wrangler dev` and `curl localhost:8787/health` to confirm it boots.
- [ ] **Step 5: Commit** with the message `feat(api): worker skeleton, D1 schema, Clerk auth, /me`

### Task 6: Groups, invites, membership

**Files:**
- Create: `src/access.ts`, `src/db/ledger.ts`, `src/routes/groups.ts`, `src/routes/invites.ts`
- Test: `test/groups.test.ts`, `test/invites.test.ts`

**Interfaces:**
- Consumes: `computeBalances` (Task 2), `CreateGroupInput` / `UpdateGroupInput` / `GroupDTO` (Task 4), `testApp` (Task 5).
- Produces:
  - `requireMember(db, groupId, userId): Promise<{ role: 'owner'|'member' }>`. Throws a 404 for non-members and former members.
  - `requireOwner(...)`. Throws a 404 for non-members and a 403 for plain members.
  - `loadLedger(db, groupId): Promise<Ledger>`
  - `newInviteCode(): string`. 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, generated with `crypto.getRandomValues`.
- Routes: as in spec §3 (groups, invite reset, invite preview and join, member delete).

- [ ] **Step 1: Write the failing tests** (a permission matrix):
  - Create → the caller is the owner and `GET /groups` lists it.
  - A non-member gets 404 on `GET` and `PATCH`.
  - A member who sends `PATCH` → 403.
  - `inviteCode` is null for members and present for the owner.
  - After a reset, the old code gives 404 on preview and join, and the new code works.
  - Joining twice → 200, with still a single membership.
  - A member leaves with a 0 balance → 204, then gets 404 on the group. They rejoin → active again.
  - Leaving or being removed with a balance that isn't zero → 409 `balance_not_zero`. Seed one expense directly in the DB for this.
  - The owner leaving → 409 `owner_cannot_leave`.
  - A member removing someone else → 403.
  - `PATCH` currency after an expense exists → 409 `currency_locked`.
- [ ] **Step 2: Run the tests.** Expect FAIL. **Step 3: Implement.** **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** with the message `feat(api): groups, invites, membership rules`

### Task 7: Expenses + balances endpoint

**Files:** Create `src/routes/expenses.ts`. Test: `test/expenses.test.ts`.

**Interfaces:**
- Consumes: `splitEqual`, `isExpenseLocked`, `computeBalances`, `simplifyDebts`, `CreateExpenseInput`, `ExpenseDTO`, `BalancesDTO`, `requireMember`, `loadLedger`.
- Produces: the routes `GET|POST /groups/:id/expenses`, `PATCH|DELETE /expenses/:id` and `GET /groups/:id/balances`.
- `GET /expenses` returns newest `spentOn` first, then newest `createdAt`.
- Writes go through `db.batch` so the expense and its shares are stored together.
- A `SplitError` maps to 422 `amount_too_small`.

- [ ] **Step 1: Write the failing tests:**
  - A member logs an expense with Bob as the payer → 201, with `createdBy` = Alice and `paidBy` = Bob.
  - The balances endpoint reflects it, and its suggestions match `simplifyDebts`.
  - Equal split of 2¢ across 3 people → 422.
  - A payer or participant who is not an active member → 422 `not_a_member`.
  - A third member who is neither creator nor owner tries `PATCH` → 403. The creator → 200. The owner → 200.
  - Once a confirmed settlement involves a participant (seed it in the DB), `PATCH` and `DELETE` → 409 `expense_locked`, and the list shows `locked: true`.
  - A non-member → 404 on every route.
- [ ] **Step 2: Run the tests.** Expect FAIL. **Step 3: Implement.** **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** with the message `feat(api): expenses with splits, lock rule, balances`

### Task 8: Settlements (two-sided confirmation)

**Files:** Create `src/routes/settlements.ts`. Test: `test/settlements.test.ts`.

**Interfaces:**
- Consumes: `maxSettlementAmount`, `CreateSettlementInput`, `SettlementDTO`.
- Produces: `POST /groups/:id/settlements`, `POST /settlements/:id/{confirm,reject,cancel}`, `GET /groups/:id/settlements?status=pending`.
- A status change is a conditional `UPDATE ... WHERE status='pending'`. If 0 rows change → 409 `not_pending`. This makes double-confirming safe.

- [ ] **Step 1: Write the failing tests.** Setup: Alice pays 900, split equally between Alice, Bob and Carol.
  - Bob → Alice 300 → 201 pending, and balances are unchanged.
  - Alice confirms → Bob's balance becomes 0.
  - Bob tries to confirm his own settlement → 403. Carol tries → 403.
  - Bob cancels his pending settlement → 200. Alice then confirms it → 409.
  - Reject → balances unchanged.
  - Bob → Alice 301 → 409 `exceeds_debt`.
  - Two pending settlements of 200 each → the second gets 409.
  - Bob → Bob → 422 `self_settlement`.
  - Bob → a former member or a stranger → 422 `not_a_member`.
  - Alice (a creditor) → Bob → 409 `exceeds_debt`.
- [ ] **Step 2: Run the tests.** Expect FAIL. **Step 3: Implement.** **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** with the message `feat(api): two-sided settle-up`

### Task 9: Badges, spins, feed

**Files:** Create `src/routes/fun.ts`. Test: `test/fun.test.ts`.

**Interfaces:**
- Consumes: `computeBadges`, `computeLeaderboard`, `spinWeights`, `pickWeighted`, `FunDTO`, `SpinDTO`, `FeedItem`.
- Produces: `GET /groups/:id/badges`, `POST /groups/:id/spins`, `GET /groups/:id/feed` (newest first, limit 50).
- The random number `r` is `crypto.getRandomValues(new Uint32Array(1))[0] / 2**32`.
- Spins store `weights_json`.

- [ ] **Step 1: Write the failing tests:**
  - `badges` returns 👺 for the biggest debtor.
  - A spin → 201. The winner is an active member, `weights` equals `spinWeights(ledger)`, and the spin appears in the feed.
  - A former member never wins. Stub `crypto.getRandomValues` with `vi.spyOn` to sweep r values 0, 0.5 and 0.99.
  - The feed interleaves an expense, a confirmed settlement, a spin and a join in time order. Pending settlements are excluded.
  - Non-member → 404.
- [ ] **Step 2: Run the tests.** Expect FAIL. **Step 3: Implement.** **Step 4: Run the tests.** Expect PASS.
- [ ] **Step 5: Commit** with the message `feat(api): badges, wheel spins, feed`

### Task 10: Web shell: auth, API client, groups, create, join

**Files:**
- Create: `apps/web/{package.json,vite.config.ts,index.html,tsconfig.json}`, `src/{main.tsx,api.ts,routes.tsx}`, `pages/{Landing,Groups,CreateGroup,Join}.tsx`, `components/Money.tsx`
- Test: `apps/web/test/api.test.ts`

**Interfaces:**
- Consumes: the DTOs and inputs from `@squadsplit/shared`.
- Produces:
  - `useApi(): { get<T>(path): Promise<T>; post<T>(path, body?): Promise<T>; patch<T>(path, body): Promise<T>; del(path): Promise<void> }`. It adds `Authorization: Bearer ${await getToken()}` and throws `ApiError {status, code, message}`.
  - Env: `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_API_URL`.
  - Routes: `/`, `/groups`, `/groups/new`, `/join/:code`, `/groups/:id`, `/groups/:id/expenses/new`, `/groups/:id/expenses/:expenseId`, `/groups/:id/wheel`, `/groups/:id/settings`. Group routes sit behind `<SignedIn>`.
- `/join/:code` sends a signed-out user to sign-in, then returns them to the link.

- [ ] **Step 1: Write the failing test.** `createApiClient(fetchFn, getToken)` sends the bearer header, parses JSON, and on a `{error}` body throws an `ApiError` with that code. `useApi` wraps it.
- [ ] **Step 2: Run the test.** Expect FAIL. **Step 3: Implement** the client, then the pages. Use mobile-first CSS: a single CSS file with tokens and a dark mode.
- [ ] **Step 4: Run** `npm test -w apps/web` and expect PASS. Run `npm run build -w apps/web` and expect it to succeed.
- [ ] **Step 5:** Run `wrangler dev` for the API and `vite` for the web app, and check by hand: sign in, create a group, then open the join link in a second browser profile and join.
- [ ] **Step 6: Commit** with the message `feat(web): shell, auth, groups, join`

### Task 11: Web group home, expenses, settle-up

**Files:**
- Create: `pages/{GroupHome,ExpenseForm}.tsx`, `components/{BalanceCard,Leaderboard,PendingActions,SuggestedTransfers,Feed}.tsx`
- Test: `apps/web/test/ExpenseForm.test.tsx`, `apps/web/test/BalanceCard.test.tsx`

**Interfaces:**
- Consumes: `useApi`, `formatMoney`, `splitEqual`, and all the group, expense, settlement and fun endpoints.
- Query keys: `['group',id]`, `['balances',id]`, `['expenses',id]`, `['settlements',id,'pending']`, `['fun',id]`, `['feed',id]`. Every mutation invalidates all keys for that group.

- [ ] **Step 1: Write the failing tests:**
  - BalanceCard: +500 → "You're owed $5.00". −500 → "You owe $5.00". 0 → "All square 🎉".
  - ExpenseForm in exact mode with 10.00 total, entering 4.00 and 5.00 → shows "$1.00 left to assign" with submit disabled. Entering 4.00 and 6.00 → submit enabled.
  - In equal mode, the per-person preview uses `splitEqual`.
- [ ] **Step 2: Run the tests.** Expect FAIL. **Step 3: Implement.**
  - "Needs your action" shows pending settlements where I am the creditor (confirm/reject) or the debtor (cancel).
  - A suggested transfer for which I am the debtor gets a "Settle" button that pre-fills the amount.
  - Locked expenses show a 🔒 and no edit button.
- [ ] **Step 4: Run the tests** (expect PASS), then the same manual check as in Task 10 with two users through the whole flow: expense → settle → confirm → balance reaches 0.
- [ ] **Step 5: Commit** with the message `feat(web): group home, expenses, settle-up`

### Task 12: Web wheel + group settings

**Files:**
- Create: `pages/{Wheel,GroupSettings}.tsx`. Add the `qrcode` dependency.
- Test: `apps/web/test/Wheel.test.tsx`

**Interfaces:**
- Consumes: `POST /groups/:id/spins` → `SpinDTO`; member removal; invite reset.
- The wheel draws slices from `SpinDTO.weights` and animates to the winner the server chose. No randomness happens on the client.
- Settings: a copy-link button for the invite and a QR code (owner only), the member list with remove buttons (owner only), and a leave button (members only).

- [ ] **Step 1: Write the failing test.** Given a mocked spin response with winner `b`, the wheel announces "🎰 User b pays!" when the animation finishes. Use fake timers.
- [ ] **Step 2: Run the test.** Expect FAIL. **Step 3: Implement.** **Step 4: Run the test.** Expect PASS. Then check by hand that a 409 on leave shows "Settle up before leaving".
- [ ] **Step 5: Commit** with the message `feat(web): wheel and group settings`

### Task 13: CI/CD + deploy runbook

**Files:** Create `.github/workflows/ci.yml`, `docs/deploy.md`, `README.md`.

**Interfaces:**
- `ci.yml` has two jobs:
  - `test`: runs on `pull_request` and `push`. Steps: `npm ci`, `npm run typecheck`, `npm test`.
  - `deploy`: needs `test`, and runs only on `push` to `main`. Steps:
    1. `npx wrangler d1 migrations apply squadsplit --remote`
    2. `npx wrangler deploy` (in `apps/api`)
    3. `npm run build -w apps/web` with `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_URL` set
    4. `npx wrangler pages deploy apps/web/dist --project-name squadsplit`
- `deploy.md` lists the one-time steps that need a person, in order:
  1. Create the Cloudflare account and the Clerk app.
  2. Run `wrangler login` and `wrangler d1 create squadsplit`, then paste the id into `wrangler.toml`.
  3. Run `wrangler pages project create squadsplit`.
  4. Run `wrangler secret put CLERK_SECRET_KEY` and `wrangler secret put CLERK_PUBLISHABLE_KEY`. Set `WEB_ORIGIN` in `[vars]`.
  5. Add the GitHub secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `VITE_CLERK_PUBLISHABLE_KEY`, and the variable `VITE_API_URL`.
  6. Enable Google and GitHub sign-in in Clerk and add the Pages domain.

- [ ] **Step 1:** Write the workflow and run `npx action-validator .github/workflows/ci.yml`, or parse it with `node -e "require('yaml').parse(...)"`. Expect valid YAML.
- [ ] **Step 2:** Push a branch, open a PR, and confirm the `test` job is green.
- [ ] **Step 3:** The account owner follows `docs/deploy.md`. Merge to `main`, and expect `deploy` to be green and `https://<api>.workers.dev/health` to return `{ok:true}`.
- [ ] **Step 4:** Smoke test production with two real accounts: create → join → expense → settle → confirm → spin.
- [ ] **Step 5: Commit** with the message `ci: test and deploy to Cloudflare; docs: deploy runbook`
