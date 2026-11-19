# Deploy runbook

SquadSplit runs on Cloudflare: the API is a Worker with a D1 database, the web app is on Pages, and sign-in is Clerk. Pushes to `main` deploy automatically through `.github/workflows/ci.yml` once the one-time setup below is done. Never commit keys or tokens.

## One-time setup

1. DONE: Create the Cloudflare account and run `wrangler login` locally.
2. DONE: Create the hosted D1 database (APAC, id already in `apps/api/wrangler.toml`).
3. DONE: Apply both migrations to the remote database.
4. DONE: Create the Clerk app "SquadSplit" (development instance).
5. TODO: Create the Pages project. Run from `apps/api`:

   ```bash
   npx wrangler pages project create squadsplit --production-branch main
   ```

6. TODO: Set the Worker secrets. Run each command from `apps/api` and type the value when prompted (Clerk dashboard, API keys; the publishable key starts with `pk_`, the secret key with `sk_`):

   ```bash
   npx wrangler secret put CLERK_SECRET_KEY
   ```

   ```bash
   npx wrangler secret put CLERK_PUBLISHABLE_KEY
   ```

   If the Worker does not exist yet, wrangler offers to create it; accept.

7. TODO: Create a Cloudflare API token. Dashboard, My Profile, API Tokens, Create Token. Start from the "Edit Cloudflare Workers" template and add Account, D1, Edit and Account, Cloudflare Pages, Edit. Also copy your Account ID (dashboard sidebar or the Workers & Pages overview).
8. TODO: Add GitHub config at `Delocy/squadsplit`, Settings, Secrets and variables, Actions.
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_CLERK_PUBLISHABLE_KEY`
   - Variables: `WEB_ORIGIN` is the Pages URL, for example `https://squadsplit.pages.dev` (use whatever Pages assigns, with no trailing slash). `VITE_API_URL` is the Worker URL, `https://squadsplit-api.<your-subdomain>.workers.dev`. Step 6 already created the Worker, so read its workers.dev URL from the Cloudflare dashboard (Workers & Pages, squadsplit-api). The deploy fails early if any of these three values is empty or if `WEB_ORIGIN` ends with a slash.
9. TODO: In the Clerk dashboard, confirm the sign-in methods you want (for example Google and GitHub) and add the Pages URL if Clerk asks for allowed origins.
10. TODO: Merge to `main` and watch the Actions tab. The `test` job runs first, then `deploy` migrates D1, deploys the Worker, builds the web app and publishes it to Pages.
11. TODO: Smoke test. Open the health endpoint and expect `{"ok":true}`:

    ```bash
    curl https://squadsplit-api.<your-subdomain>.workers.dev/health
    ```

    Then, with two accounts: create a group, join with the invite code, add an expense, settle up, confirm, and spin the wheel.

## How CI maps to this

- `WEB_ORIGIN` is passed to `wrangler deploy` as `--var`, so it overrides the localhost value in `wrangler.toml`. The Worker only accepts Clerk tokens and CORS requests from that origin.
- `VITE_*` values are baked into the web build, so changing them needs a new deploy.
- Pages serves `apps/web/public/_redirects` so deep links such as `/join/:code` fall back to the SPA.

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
