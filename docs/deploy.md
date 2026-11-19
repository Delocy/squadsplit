# Deploy runbook

SquadSplit runs on Cloudflare: the API is a Worker with a D1 database, the web app is on Pages, and sign-in is Clerk. Pushes to `main` deploy automatically through `.github/workflows/ci.yml` once the one-time setup below is done. Never commit keys or tokens.

## One-time setup

1. DONE: Create the Cloudflare account and run `wrangler login` locally.
2. DONE: Create the hosted D1 database (APAC, id already in `apps/api/wrangler.toml`).
3. DONE: Apply the initial migrations to the remote database. From then on CI applies any new migrations on every deploy (`wrangler d1 migrations apply --remote`), before the Worker goes out.
4. DONE: Create the Clerk app "SquadSplit" (development instance).
5. DONE: Create the Pages project `squadsplit` (https://squadsplit.pages.dev). For reference, it was created from `apps/api` with:

   ```bash
   npx wrangler pages project create squadsplit --production-branch main
   ```

6. DONE: Set the Worker secrets `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` on `squadsplit-api`. To rotate one, run from `apps/api` and type the value when prompted (Clerk dashboard, API keys; the publishable key starts with `pk_`, the secret key with `sk_`):

   ```bash
   npx wrangler secret put CLERK_SECRET_KEY
   ```

   ```bash
   npx wrangler secret put CLERK_PUBLISHABLE_KEY
   ```

7. DONE: Create a Cloudflare API token ("Edit Cloudflare Workers" template plus Account, D1, Edit and Account, Cloudflare Pages, Edit) and note the Account ID.
8. DONE: Add GitHub config at `Delocy/squadsplit`, Settings, Secrets and variables, Actions.
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_CLERK_PUBLISHABLE_KEY`
   - Variables: `WEB_ORIGIN` = `https://squadsplit.pages.dev`, `VITE_API_URL` = `https://squadsplit-api.tngzhexuan.workers.dev`. The deploy fails early if any of these three values is empty or if `WEB_ORIGIN` ends with a slash.
9. DONE: In the Clerk dashboard, confirm the sign-in methods you want (for example Google and GitHub) and add the Pages URL if Clerk asks for allowed origins.
   Also consider making "First name" a required sign-up field (User & authentication, then the name settings), so friends show up by name instead of an email address.
10. DONE (v1 live, then PR #2): Merge to `main` and watch the Actions tab. The `test` job runs first, then `deploy` migrates D1, deploys the Worker, builds the web app and publishes it to Pages.
11. DONE (v1 and PR #2): Smoke test. Open the health endpoint and expect `{"ok":true}`:

    ```bash
    curl https://squadsplit-api.tngzhexuan.workers.dev/health
    ```

    Then, with two accounts: create a group, join with the invite code, add an expense, settle up, confirm, and spin the wheel.

## How CI maps to this

- `WEB_ORIGIN` is passed to `wrangler deploy` as `--var`, so it overrides the localhost value in `wrangler.toml`. The Worker only accepts Clerk tokens and CORS requests from that origin.
- `VITE_*` values are baked into the web build, so changing them needs a new deploy.
- `apps/web/public/_headers` sets the caching on Pages: HTML (`/*`, which includes `/`, `/index.html` and the SPA fallback for deep links) gets `Cache-Control: no-cache`, so browsers revalidate it and pick up a new deploy on the next load; the content-hashed `/assets/*` files get `public, max-age=31536000, immutable`. Pages applies every matching rule and joins repeated headers with a comma, so the `/assets/*` rule first drops the inherited value with `! Cache-Control`.
- Deep links such as `/join/:code` fall back to the SPA through Pages' default single-page-app behaviour (the build has no `404.html`). Don't add a `_redirects` rule like `/* /index.html 200`: Pages flags it as an infinite loop and ignores it.

> **Warning:** any manual `wrangler deploy` must pass the origin too, or the Worker falls back to the localhost value in `wrangler.toml` and rejects every request from the live site, locking everyone out. From `apps/api`:
>
> ```bash
> npx wrangler deploy --var WEB_ORIGIN:https://squadsplit.pages.dev
> ```

## Going to production later

The free `*.pages.dev` and `*.workers.dev` URLs work with Clerk's development instance. A Clerk production instance needs a custom domain you own. When you have one, point it at Pages, then run the Clerk CLI deploy flow:

```bash
npx -y clerk@latest deploy
```

Afterwards, swap in the production keys (Worker secrets and the GitHub secret `VITE_CLERK_PUBLISHABLE_KEY`) and update `WEB_ORIGIN` to the new domain.

## Rollback

Roll the Worker back to its previous version, from `apps/api`:

```bash
npx wrangler rollback
```

For Pages, open the project's Deployments tab and roll back to an earlier deployment.

D1 supports Time Travel, which restores the database to an earlier point in time; see Cloudflare's D1 Time Travel docs for the retention window:

```bash
npx wrangler d1 time-travel info squadsplit
```

```bash
npx wrangler d1 time-travel restore squadsplit --timestamp=<unix-timestamp-or-ISO>
```

Migrations are forward-only, so ship a new migration to undo a schema change.

## Cost

Everything here fits the Cloudflare free tier (Workers, D1, Pages) and Clerk's free tier for a small group of friends.
