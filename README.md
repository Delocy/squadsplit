# SquadSplit

SquadSplit is a fun, multi-user take on Tricount. Friends share expenses inside a group, see who owes whom, settle up with two-sided confirmation, earn silly titles, and spin a wheel to decide who pays next.

## Features

- Groups with invite codes and links, and an owner who can reset the code
- Expenses split equally, by exact amounts, or itemized, with every amount in integer cents
- Itemized Singapore bills with service charge and GST applied the way the receipt does
- Balances and suggested simplified transfers
- Two-sided settle-up: the debtor says they paid, the creditor confirms or rejects
- Badges, a leaderboard and a "who pays" wheel

## Stack

- Web: React and Vite single-page app on Cloudflare Pages
- API: Hono on Cloudflare Workers with D1 (SQLite) and Drizzle
- Shared: zod schemas and pure money logic
- Auth: Clerk
- Tests: Vitest

## Layout

```
apps/web         React + Vite SPA
apps/api         Hono Worker, Drizzle, D1 migrations
packages/shared  schemas, types, balances, splits, badges
docs/            spec, deploy runbook, design notes
```

## Local development

Requires Node 22.

```bash
npm ci
```

Auth needs a Clerk app. Link the repo with `npx -y clerk@latest link`, then use `npx -y clerk@latest env pull` to write the keys into two gitignored files: `apps/api/.dev.vars` (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`) and `apps/web/.env.local` (`VITE_CLERK_PUBLISHABLE_KEY`, `VITE_API_URL`). Never commit these.

Create the local database from `apps/api`:

```bash
npx wrangler d1 migrations apply squadsplit --local
```

Run the API and the web app in two terminals:

```bash
npm run dev -w @squadsplit/api
```

```bash
npm run dev -w @squadsplit/web
```

## Tests

```bash
npm run typecheck
```

```bash
npm test
```

Tap targets (every control at least 44×44px) are measured in a real browser at 375px and 320px. The check starts the real API on a throwaway local D1 with a fake sign-in, the web app with a fake Clerk, and made-up people, so it needs no keys and touches no other database. It isn't part of `npm test`. Install Chromium for Playwright once:

```bash
npx playwright install chromium
npm run e2e:tap-targets -w @squadsplit/web
```

It uses ports 5296 to 5298 (set `E2E_WEB_PORT` and `E2E_API_PORT` to move them) and exits 1, listing each control that's too small.

## Docs

- [Design spec](docs/spec.md)
- [Deploy runbook](docs/deploy.md)
- [Design notes](docs/design/README.md)
