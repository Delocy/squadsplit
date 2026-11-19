# SquadSplit — Design Spec

A fun, multi-user take on Tricount: friends share expenses inside a group, see who owes whom, settle up with two-sided confirmation, earn silly titles, and spin a wheel to decide who pays next.

Status: agreed design (2026-11-19). Anything marked **v2** is explicitly out of scope for the first release.

---

## 1. Product rules

### Groups and membership
- A **Group** ("squad") is the authorization boundary. Every read and write of group data requires the caller to be a current member.
- Roles: **owner** (the creator) and **member**. No ownership transfer in v1.
- People join only with the group's **invite code**, either typed in or opened as a link (`/join/:code`). **Everyone in the group can see and share the invite link and code**, members and guests alike (decided 2026-11-19: the link already lets anyone join, so sharing it adds no risk). Only the owner can reset the code, which stops the old link working.
- **Named members, Tricount-style** (added 2026-11-19 at the user's request): the creator can name everyone else when creating the group (0–11 names, same rules as a nickname: 1–24 characters, no emoji or control characters), and the owner can add more names later in the group's settings.
  - Each unclaimed name is a real member (a **placeholder**): it has its own unique look (the first free one from its default), can pay, share, be on an item and be settled with, shows on the leaderboard, badges and wheel, and counts towards the cap. The app tags it "Not joined yet". A placeholder never signs in: its `ph_` id is refused as a session.
  - Joining asks **"Which one are you?"** with the unclaimed names and **"I'm new"**. Claiming a name makes you that person everywhere (expenses paid and logged, shares, items, settlements, spins and their weights) in one batch, keeps its look unless you pick another, and makes its name your nickname unless you set one; the placeholder is then deleted. Someone who has ever been in the group can't claim (409 `already_in_group`); a name already claimed, or not one of this group's, is 409 `already_claimed`. Claiming works in a full group, since it takes the name's place. Former members rejoin as themselves and aren't asked.
  - Limitation: someone who has ever been in the group (a former member included) can never claim a name, so a name added for a former member stays a separate person; they rejoin as themselves ("You've been in this group before, so join as yourself.").
  - A write that names someone who stops existing in the meantime (an expense or settlement naming a placeholder that is claimed before it is saved) is 409 `member_changed` ("Someone just joined as this name — refresh and try again.").
  - The owner can remove an unclaimed name only while nothing in the group's history uses it (no expense, share, item, settlement or spin); otherwise 409 `name_in_use`. Removing deletes it; placeholders are never "former" members.
  - Adding names doesn't appear in the feed as joins; claiming one does (at the time of the claim).
- **Guests, Tricount-style** (added 2026-11-19 at the user's request: "Guest tricount style, but keep the auth flow for normal users to track their existing list"): a friend who opens the invite link can join **without an account**. Signed-in accounts work exactly as before (their group list, profile and so on).
  - **Why:** in Tricount anyone with the link just picks their name and is in. Making every friend at the table create an account is the biggest drop-off; guests remove it while accounts stay for people who want their groups in one list on every device.
  - **Joining:** the invite preview is public. Signed out, the Join page asks "Which one are you?" with the unclaimed names and **"I'm new"** (a name, then the usual animal and colour and nickname), and **"Join as guest"** ("No account needed. This phone remembers you."). Under it, "Sign in to keep it in your list" runs the usual signed-in join. Claiming a name turns the placeholder into the guest **in place** (`users.kind` 'placeholder' → 'guest', same `ph_` id), so no row of the group's history moves; "I'm new" creates a guest with a `gs_<uuid>` id and a membership. The 12-person cap applies (409 `group_full`); a name taken first is 409 `already_claimed`; a taken look is 409 `avatar_taken`.
  - **What a guest can do:** everything a member can — add and edit expenses, scan receipts (the same 20 a day per user, under the app-wide 40), record and confirm paybacks, spin the wheel, set their nickname and look. Only owner things stay with the owner's account: group settings, adding or removing names, resetting the link and the currency. A guest can't leave (their name stays for the owner to free up or remove). The app tags a guest who's in **"Guest"**.
  - **One group per guest:** a guest is a member of that one group only. Any other group's routes are 404 (as for a non-member), owner-only routes 403, and everything that belongs to an account — `/me`, `GET /groups`, creating groups, quick splits, signed-in joins — is 401.
  - **The token:** joining hands the phone a token, 32 random bytes from `crypto.getRandomValues`, base64url (43 characters). Only its SHA-256 (hex) is stored, in `guest_sessions` with the guest and the group, so a copy of the database signs nobody in. A token is scoped to exactly one group; a phone holds one per group, in `localStorage` under `squadsplit.guest.<groupId>` (with the guest's id, the group's name and the invite code), and the web app only ever sends it in the `X-Guest-Token` header, never in a URL. `last_seen_at` moves at most once an hour.
  - **Limits:** at most **20 guest joins per group per UTC hour** (claims and new names, refused attempts included), counted atomically in D1 like quick-split ticks, with no IP address stored; past it, 429 `slow_down`. Resetting the link starts the group's count afresh, so attempts on a leaked old link can't hold up the rejoins.
  - **Reset link** (owner) also deletes every guest session of the group, in the same batch: every guest is signed out on every phone. They rejoin with the new link and pick their name again; their expenses stay. People who saved to an account are unaffected. **"Free up name"** (owner, guests only, with a confirm) signs one guest out on every phone, for a lost phone. A guest with no live session is an unclaimed name again, claimable exactly like a placeholder (by a guest, which signs them in again as the same id and isn't a new join, or by an account). The app shows such a name as "Not joined yet".
  - **Signed out:** a request with a dead token (unknown, or signed out by a reset or "Free up name") is 401 `guest_signed_out`, and only that code means "forget this token": any other 401 (an account's sign-in failing while it saves the guest, an account-only route) leaves the guest signed in. The web app forgets the token and says "You've been signed out of <group>. Ask for the new link to rejoin.", linking to the Join page for the code they joined with ("Try the link again": after "Free up name" it still works). The card shows only on a phone nobody is signed in on, and any later join clears it.
  - **Saving to an account:** "Save with an account" in a guest's top bar signs in (or up), then moves the guest to the account with the same batch as claiming a placeholder: the membership (look, join day, and the name the group knows them by, as a nickname) and every reference move to the account, and the guest's user row and sessions are deleted. 409 `already_in_group` if the account has ever been in the group.
  - **On this phone:** the signed-out landing page lists the groups this phone is a guest in (each read with its own token; one that comes back 401 or 404 is forgotten), above the sign-in buttons.
  - **The risk, stated plainly:** anyone with the link can join as an unclaimed name. That is the honour system, as in Tricount: the group sees who joined as whom in the feed, and the owner's **Reset link** is the safety valve (it signs every guest out at once), with "Free up name" for one guest. The hourly join limit stops a leaked link from churning names quickly.
- **Profile look** (added 2026-11-19): every user has an animal + colour of their own (`PATCH /me`; any of the 48, nothing is "taken"). It shows outside groups (the top bar on your groups list) and is where new groups start you: creating a group gives you your profile look, and joining without a pick gives you it (or a former member's old look), moved on to the first free look if someone has it.
- A group has at most **12 active members**, counting unclaimed names. Joining a full group (including a former member rejoining) is 409 `group_full`; former members don't count towards the cap. The cap is checked in the same statement that writes the membership, so simultaneous joins can't pass it.
- A member can **leave**, or the owner can **remove** them, only when that member's group balance is exactly 0. The owner cannot leave in v1 (that would need ownership transfer).
- Leaving is a soft delete (`membership.left_at`), so past expenses still show their names.
- **You in a group** (added 2026-11-19 at the user's request): each membership has its own **animal + colour** avatar and an optional **nickname**.
  - The avatar is one of the 8 member animals (bunny, bear, panda, kitty, fox, hamster, penguin, koala) on one of 6 pastel colours, so 48 combinations. Among a group's **active** members every avatar is unique; former members don't hold theirs.
  - Joining lets you pick from the combinations that are left. Without a pick you get your default look (a stable hash of your user id), moved on to the first free combination if it's taken. A former member who rejoins keeps their old look if it's still free (the invite preview tells them which, so the Join page starts on it). Picking a taken one is 409 `avatar_taken`.
  - Creating a group sets only your nickname; you start with your profile look and can change it in the group's settings.
  - The database enforces unique stored looks among active members (migration 0003), so two people picking the same look at once can't both get it. Where effective looks still clash (two members without a stored look whose defaults match), the later joiner is shown the first free combination instead, so no two active members ever look the same.
  - The nickname is 1–24 characters after trimming, with no control or invisible format characters (such as bidi overrides) and no emoji: no pictographs, flags, keycaps, skin tones or U+FE0F. The plain-text symbols ™ © ® are allowed. Empty clears it. Nicknames don't need to be unique.
  - Inside the group your name is your nickname if you set one, otherwise your profile name. Outside a group (your groups list) the profile name and profile look are used.
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
- **Scan a receipt** (added in PR #3): a receipt card at the top of every new expense. "Scan receipt" opens the camera (`<input type="file" capture="environment">`) and "Pick a photo" the gallery; both accept JPEG, PNG, WebP and HEIC/HEIF. A scan only pre-fills the form in By item; it never creates an expense by itself.
  - **Privacy:** the phone redraws the photo on a canvas at most 1024px on the long edge and re-encodes it as JPEG (quality 0.8), which drops EXIF data such as GPS. The API never stores or logs the image; it logs only a reason code when a scan fails.
  - **AI scan:** `POST /groups/:id/receipts/scan` (members only) sends the image to Cloudflare Workers AI, `@cf/mistralai/mistral-small-3.1-24b-instruct`, as a `data:` URI image part in `messages`. The model is prompted for strict JSON `{items:[{name, amountCents}], serviceChargeBps, gstBps, totalCents}` (cents; quantity lines merged into one item with the line total; subtotal, payment and change lines skipped). The API takes the first JSON object in the answer, cleans it (1–50 items, names trimmed to 60 characters, amounts 1–100,000,000 cents, rates 0–3000 bps; anything else dropped or read as unknown) and checks the items against the printed total with `itemizedTotal`, allowing 2 cents for the receipt rounding its service charge and GST lines separately.
  - **Size:** the request body is at most 2 MB (every other route takes 64 KB; over → 413 `payload_too_large`), the image at most 1.5 MB decoded and 1600px on either side, read from its JPEG/PNG/WebP header (→ 422 `image_too_large`; bytes that don't match the type, or no readable header → 422 `not_an_image`). The model may write at most 1,024 tokens.
  - **Limits (Workers AI free plan, 10,000 neurons a day):** 20 scans per user and 40 for the whole app per UTC day, counted in `receipt_scans` (rows older than 7 days are dropped as new scans are counted). The worst case for one scan (a 1600px image, the prompt, 1,024 tokens out) is estimated at about 180 neurons, so a full day is at most about 7,200. One conditional upsert counts the scan before the model runs, so parallel scans can't overshoot. Over either limit, or when Workers AI reports the account's daily allocation used up (error 4006) → 429 `scan_limit`. A scan is given back only when the model never answered: 4006 (429) or another model error (503 `scan_unavailable`). An answer has used neurons, so it counts even when unreadable: no JSON object, or no usable item → 422 `receipt_unreadable`.
  - **On-phone fallback:** on 429, 5xx, 422 `receipt_unreadable` or no connection, the web app reads the photo itself with Tesseract.js (2048px copy, English LSTM model), loaded only on that path and served from our own origin (`/tesseract/`, copied from `node_modules` at build time; no CDN). A pure parser turns the text into items, reading service charge and GST rates from "10%"/"9%" or working them out from their amounts.
  - **Pre-fill:** the items replace the item rows (after asking, if the user entered amounts or items) with nobody assigned yet, and the receipt's total becomes the amount. The receipt's own service charge and GST become the bill's charges at their own rates and are switched on (the toggle reads "Restaurant bill (SG)" for 10% + 9%, otherwise "Receipt charges" with the rates, e.g. "9% GST"); with no charges the toggle is off. So the saved total is what the receipt adds up to (within the 2-cent rounding above), shared in proportion to each person's items. A banner says what happened: total matches, total differs ("check the total below"), read on the phone (double-check), or couldn't read it (add items by hand). When the items are more than 2 cents off the total, one line at the total says by how much ("Items + charges come to $67.26, $1.20 short of the $68.46 total."), saving is blocked, and when they're short "Add Other $1.00 (+ charges = $1.20)" adds an Other item, priced before the charges and shared by everyone, that lands on the total.
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
- **A guest** who is in is a real participant: a payment with them is `pending` and they confirm it like anyone else.
- **Someone who hasn't joined** (a placeholder, or a guest signed out on every phone) can't confirm anything, so a settlement with one is one-sided and counts straight away (`confirmed`, `resolved_at` now): you can record paying them, and a creditor can record that one of them paid you ("Dave paid me", `fromUserId` = the placeholder). The usual cap applies with the placeholder as debtor or creditor. Two placeholders can't settle with each other (422 `placeholder_to_placeholder`); naming any other payer is 422 `not_your_payment`.
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

### Quick split (one bill, no group, no accounts)
For a one-off restaurant meal with people who have no SquadSplit account. The payer enters or scans the bill, types the guests' names, taps who had each dish, and posts a **share card** (a screenshot, or plain text) and a **share link** in their chat. Friends open the link with no sign-in, tap their own name and press "I've paid <payer> $X". There is no PayNow and no QR code: friends pay the payer however they usually do. Turning a quick split into a group is out of scope for now.

- **Limits:** 2–20 people (you are always the first) and 1–50 dishes. Names follow the member-name rules (≤ 24 characters, no emoji) and are case-insensitively unique within a split, because a guest finds themselves by name. Exactly one person paid. Every dish has at least one person, and everyone but the payer has at least one dish. Each dish is 1¢–$1,000,000 and the bill is at most $1,000,000 in all.
- **Looks:** each person has an animal unique within the split, chosen with `firstFreeAvatar(defaultAvatar(<person id>), taken)`; your own row starts on your profile look. The web app sends the looks it shows, so they don't change on saving.
- **Charges:** service charge and GST are separate switches (both on at 10% and 9% by default; GST is added after the service charge). A charge that's off is stored as 0. After a scan each one is on only if the receipt has it, at the receipt's rate; when the prices already include the charges (`receiptChargesIncluded`), both start off.
- **The receipt total (added 2026-11-19, the same fix-up as a group expense):** after a scan that shows a total, the bill step shows it as an editable "Receipt total". When the dishes plus charges are more than 2 cents off it, one line says so ("Items + charges come to $67.26, $1.20 short of the $68.46 total.") and Next is blocked: the bill never quietly goes on with the lower total. When the dishes are short, "Add Other $1.00 (+ charges = $1.20)" adds an Other dish, priced before the charges, shared by everyone in the split (people added afterwards too, until it's changed by hand on Assign). Clearing the field goes by the dishes. The total itself is not stored.
- **Totals are never stored.** `quickSplitBreakdown` (in `packages/shared`, on top of `splitItemized`/`itemizedTotal`) works out every total from the dishes, so the API, the card and the link page agree to the cent. A shared dish is split evenly, any spare cent going to the payer if they shared it.
- **Paid:** the payer is never "unpaid"; they show as the one who paid. A guest is ticked by themselves on the link (`paid_marked_by = 'guest'`) or by the payer (`'payer'`), with the time. The payer can untick or tick anyone.
- **Share link safeguards:**
  - a 128-bit random token (16 bytes from `crypto.getRandomValues`, 22 characters of base64url), made when the split is saved
  - it expires 60 days after creation, and the payer can stop sharing at any time; a stopped or expired link answers 410 `link_off` ("This link has been turned off. Ask <payer> for the breakdown."), and there's no turning it back on in v1
  - it shows first names, looks, dishes and amounts only: no user ids, owner, email, profile data or token
  - ticks work on the honour system ("Tap your own name. <payer> can see who's ticked, and can fix a wrong tick.")
  - tick changes are limited to 60 per link per UTC hour, counted in D1 with no IP address (429 `slow_down`); reads aren't limited
  - the page is kept out of search engines (`X-Robots-Tag: noindex` from Pages and a robots meta tag)
- Only its owner sees a quick split in the app; anyone else gets 404.

### Feed
Expenses, confirmed settlements, spins and joins, all in one list, newest first. Joins include guests (when a guest first claims a name or joins as someone new), but not a guest signing in again after a reset.

### Freshness
No live connection. TanStack Query refetches when the tab regains focus and after the user's own changes. (v2: WebSockets through Durable Objects.)

---

## 2. Data model (D1 / SQLite with Drizzle)

```
users          id (pk, text: Clerk user id, ph_<uuid> for a placeholder, or gs_<uuid> for a guest who joined as someone new),
               display_name, avatar_url, created_at,
               kind ('person'|'placeholder'|'guest', default 'person'), profile_animal (nullable), profile_color (nullable)   (0005; 'guest' 0007)
               a placeholder or guest belongs to one group; a guest who claimed a name keeps its ph_ id; profile_* null means the user's default look
groups         id (pk, uuid), name, emoji, currency, invite_code (unique), owner_id → users, created_at
memberships    group_id → groups, user_id → users, role ('owner'|'member'), joined_at, left_at (nullable),
               avatar_animal (nullable), avatar_color (nullable), nickname (nullable)
               pk(group_id, user_id)
               unique(group_id, avatar_animal, avatar_color) where left_at is null and both avatar_* are set (0003)
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
receipt_scans  user_id, day ('YYYY-MM-DD', UTC), count      pk(user_id, day)   (0004; the app-wide count is the day's sum)
quick_splits   id (pk, uuid), owner_id → users, title (1–50), place (nullable, ≤ 60), spent_on (date), currency (default 'SGD'),
               service_charge_bps, gst_bps (0..3000; 0 = off), share_token (unique), share_expires_at, share_revoked_at (nullable),
               created_at, updated_at   (0006)
quick_split_people  id (pk, uuid), split_id → quick_splits (cascade), name, animal, color, position (0 = the owner),
               is_payer (exactly one per split: unique index where is_payer = 1), paid_at (nullable),
               paid_marked_by ('guest'|'payer', nullable)
quick_split_items   id (pk), split_id → quick_splits (cascade), name (1–60), amount_cents (int > 0), position
quick_split_item_people  item_id → quick_split_items (cascade), person_id → quick_split_people (cascade)   pk(item_id, person_id)
quick_split_ticks   split_id → quick_splits (cascade), hour ('YYYY-MM-DDTHH', UTC), count   pk(split_id, hour)
               (tick changes on the share link per hour; rows older than a day are dropped)
guest_sessions token_hash (pk: SHA-256 hex of the token; the token itself is never stored), user_id → users, group_id → groups,
               created_at, last_seen_at (moved at most once an hour)   (0007)
guest_joins    group_id → groups, hour ('YYYY-MM-DDTHH', UTC), count   pk(group_id, hour)   (0007; guest joins per group per hour,
               no IP address; rows older than a day are dropped)
```

The rule "shares add up to the amount" is enforced in the service layer, inside a single D1 `batch` (transaction).

**Users:** the Worker checks the Clerk session JWT. The first time a user id is seen, it fetches the profile from Clerk's Backend API and creates the `users` row. That row is refreshed on `GET /me`.

---

## 3. API (Hono on Cloudflare Workers)

Every route needs a valid Clerk session (`Authorization: Bearer <token>`) or a guest's token (`X-Guest-Token: <token>`), except `GET /health`, a quick split's share link (`/s/:token…`), an invite's preview and joining as a guest (`GET /invites/:code`, `POST /invites/:code/guest`), which are mounted before authentication. A Clerk session whose user id starts `ph_` or `gs_` is refused (401). A guest's token signs them in as a member of their one group only (other groups 404, account routes 401). A request carrying both is the guest's, except `POST /groups/:id/guest/upgrade`, which takes both. CORS allows the `X-Guest-Token` header; the origin stays `WEB_ORIGIN`.

Error responses:
- `401` not signed in (`guest_signed_out` for a guest token that signs nobody in any more)
- **`404` not a member.** We don't reveal whether the group exists.
- `403` a member without permission
- `409` the current state blocks the action (balance not zero, expense locked, settlement no longer pending)
- `410` a quick split's share link has been stopped or has expired (`link_off`)
- `422` validation failed (zod)
- `413` the request body is too large (64 KB; 2 MB for a receipt scan)
- `429` a limit was reached (receipt scanning per day; share-link ticks per hour; guest joins per group per hour)
- `503` a service we depend on is unavailable (receipt scanning)

| Method & path | Who may call |
|---|---|
| `GET /me` (includes `profileAvatar`) | any user (not a guest) |
| `PATCH /me` (`{ profileAvatar }`) | any user (not a guest) |
| `GET /groups` | any user (returns their own groups; not a guest) |
| `POST /groups` (optional `nickname` for the owner, optional `members`: up to 11 names) | any user (they become the owner; not a guest) |
| `POST /groups/:id/placeholders` (`{ name }`; 409 `group_full`) | owner |
| `GET /groups/:id` (includes the invite code, for every member and guest) | member |
| `PATCH /groups/:id` (name, emoji; currency only before the first expense) | owner |
| `POST /groups/:id/invite/reset` | owner (also signs every guest of the group out) |
| `GET /invites/:code` (preview: group name, emoji, member count, the avatars already taken, your old look if you're a former member, and the unclaimed names with their looks; signed out, `alreadyMember: false` and `myFormerAvatar: null`) | anyone with the code, no sign-in |
| `POST /invites/:code/guest` (`{ claim?, name?, avatar?, nickname? }`, exactly one of `claim` and `name`) → 201 `{ token, groupId, member }`; 409 `already_claimed`, `group_full`, `avatar_taken`; 429 `slow_down` | anyone with the code, no sign-in |
| `POST /invites/:code/join` (optional body `{ avatar?, nickname?, claim? }`; `claim` is an unclaimed name's user id, a placeholder's or a signed-out guest's) | any user, not a guest (does nothing if already a member, unless claiming) |
| `POST /groups/:id/members/:userId/release` ("Free up name": signs that guest out on every phone) → 204 | owner; guests only (else 404) |
| `POST /groups/:id/guest/upgrade` (moves the guest to the account) → 200 `GroupDTO`; 409 `already_in_group` | a Clerk session and that group's guest token, together |
| `PATCH /groups/:id/members/me` (`{ avatar?, nickname? }`, at least one; `nickname: null` or `""` clears) | member |
| `DELETE /groups/:id/members/:userId` | that user (leaving) or the owner (removing); balance must be 0. An unclaimed name or a guest: owner only, deleted (with the guest's sessions) while unused (else 409 `name_in_use`) |
| `GET /groups/:id/balances` (nets + suggested transfers) | member |
| `GET /groups/:id/expenses`, `POST /groups/:id/expenses` | member |
| `PATCH /expenses/:id`, `DELETE /expenses/:id` | creator or owner, and not locked |
| `POST /groups/:id/settlements` (`{ toUserId, amountCents, fromUserId? }`) | member (the caller is the debtor, or the creditor of a placeholder named in `fromUserId`) |
| `POST /settlements/:id/confirm`, `/reject` | creditor |
| `POST /settlements/:id/cancel` | debtor |
| `GET /groups/:id/badges` (badges + leaderboard) | member |
| `POST /groups/:id/spins` | member |
| `GET /groups/:id/feed` | member |
| `POST /groups/:id/receipts/scan` (`{ imageBase64, mimeType: image/jpeg\|png\|webp }`, ≤ 2 MB body, ≤ 1.5 MB and 1600px image; returns items, rates, total and `totalMatches`; never creates an expense) | member |
| `POST /receipts/scan` (the same scan outside any group, for a quick split's bill; same body, limits, errors and fallback, and the same daily quota) | any user, not a guest |
| `GET /quick-splits` (summaries, newest first: title, place, date, total, paid count / people count, link `on`\|`off`, names) | any user, not a guest (their own) |
| `POST /quick-splits` (`QuickSplitInput`; opens the share link) → 201 | any user, not a guest (they become the owner) |
| `GET /quick-splits/:id`, `PUT /quick-splits/:id` (full replace: people sent with their `id` keep their tick and look; people left out are deleted), `DELETE /quick-splits/:id` | owner (else 404) |
| `PATCH /quick-splits/:id/people/:personId` (`{ paid }`; 422 `payer_paid` for the payer) | owner |
| `POST /quick-splits/:id/share/stop` (turns the link off for good) | owner |
| `GET /s/:token` (names and amounts only; 404 unknown, 410 `link_off`) | anyone with the link, no sign-in |
| `POST /s/:token/people/:personId/paid` (`{ paid }`; 422 for the payer; 429 `slow_down` past 60 tick changes per link per hour) | anyone with the link, no sign-in |

Request and response schemas are zod objects in `packages/shared`, used by both the API (validation) and the web app (types).

---

## 4. Frontend (React + Vite + TS on Cloudflare Pages)

- Clerk React components handle sign-in (Google, GitHub, email).
- TanStack Query for server state; React Router for pages.
- Screens:
  - Landing / sign-in, with **"On this phone"** (the groups this phone is a guest in) above the sign-in buttons when it holds any
  - My groups
  - Your profile look (`/me`, from the menu on your top-bar avatar)
  - Create group (with "Who's in?" names)
  - Join (`/join/:code`), asking "Which one are you?" when the group has unclaimed names. It works signed out: "Join as guest", with "Sign in to keep it in your list" under it
  - **Group pages as a guest:** every page inside a group opens with this phone's guest token and no account (or for a signed-in account that isn't in the group). The top bar shows the guest's look, a "Guest" tag and "Save with an account"; owner-only controls are hidden. A 401 forgets the token and explains the sign-out
  - **Group home:** my balance card, the leaderboard with badges, "needs your action" (settlements waiting for me to confirm), suggested settle-ups, and the feed
  - Add/edit expense
  - Wheel (an animated spin)
  - Group settings (the invite card, members). The owner sees guests tagged "Guest" with "Free up name" (with a confirm)
  - **The invite card**, for every member and guest: "Share invite link" (the phone's share sheet; hidden where there is none, and Copy leads instead), Copy (a toast says "Link copied. Paste it in your chat"; if copying fails, the link text is selected), the link as text, "Code: XXXX XXXX" spaced for reading aloud, and a "Show QR code" disclosure. The owner's "⋯" menu holds Reset link, whose confirm says the old link and code stop working and guests are signed out. It is the first card on Group settings and on a group with no expenses yet, and the "Invite" button on the group home opens it in a bottom sheet
  - **Quick split** (`/quick/new`, from "Quick split" next to "New group"): Bill → People → Assign, then the share card at `/quick/:id` with Copy text, Copy link and Save image (a PNG through the phone's share sheet, or a download), and the payer's ticks, Copy link, Stop sharing, Edit and Delete. The groups page lists recent quick splits with "2 of 3 paid".
  - **Share link** (`/s/:token`): works signed out and without Clerk loading at all; "Which one are you?" (remembered on the phone), "I've paid <payer> $X" with Undo, a "2 of 3 paid" bar and a PAID stamp once everyone has paid. It refetches every 30 seconds and on focus.
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
- **"Poke" nudges** on a debt, and an optional weekly email summary.
- **Export to CSV.**
- **Install as a phone app (PWA)** with an offline queue for new expenses.

**Later:** repeating expenses (such as rent) and real support for multiple currencies (the columns already exist).

**Out of scope (v2):**
Percentage or share splits, ownership transfer, deleting a group, live updates, a preview deploy per PR, a custom domain, permanent achievements, comments and reactions.
