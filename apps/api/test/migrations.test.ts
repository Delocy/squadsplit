import { applyD1Migrations, env } from 'cloudflare:test'
import { expect, it } from 'vitest'

const TABLES = ['expense_item_users', 'expense_items', 'expense_shares', 'spins', 'settlements', 'expenses', 'memberships', 'groups', 'users', 'd1_migrations']

it('0001_itemized_currency keeps existing expenses and their shares, taking the currency from the group', async () => {
  for (const table of TABLES) await env.DB.exec(`DROP TABLE IF EXISTS ${table}`)
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 1))
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users VALUES ('alice', 'Alice', NULL, '2026-11-01T00:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO groups VALUES ('g1', 'Paris', '🥐', 'EUR', 'ABCDEFGH', 'alice', '2026-11-01T00:00:00.000Z')`),
    env.DB.prepare(
      `INSERT INTO expenses VALUES ('e1', 'g1', 'Dinner', 100, 'alice', 'alice', '🍕', '2026-11-19', 'exact', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z')`,
    ),
    env.DB.prepare(`INSERT INTO expense_shares VALUES ('e1', 'alice', 100)`),
  ])

  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

  expect(await env.DB.prepare('SELECT id, currency, fx_rate_ppm, service_charge_bps, gst_bps FROM expenses').all().then((r) => r.results)).toEqual([
    { id: 'e1', currency: 'EUR', fx_rate_ppm: 1_000_000, service_charge_bps: null, gst_bps: null },
  ])
  expect(await env.DB.prepare('SELECT * FROM expense_shares').all().then((r) => r.results)).toEqual([
    { expense_id: 'e1', user_id: 'alice', amount_cents: 100 },
  ])
})

it('0002_member_avatar_nickname adds empty avatar and nickname columns to memberships without touching existing rows', async () => {
  for (const table of TABLES) await env.DB.exec(`DROP TABLE IF EXISTS ${table}`)
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 2))
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users VALUES ('alice', 'Alice', NULL, '2026-11-01T00:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO users VALUES ('bob', 'Bob', NULL, '2026-11-01T00:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO groups VALUES ('g1', 'Paris', '🥐', 'EUR', 'ABCDEFGH', 'alice', '2026-11-01T00:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO memberships VALUES ('g1', 'alice', 'owner', '2026-11-01T00:00:00.000Z', NULL)`),
    env.DB.prepare(`INSERT INTO memberships VALUES ('g1', 'bob', 'member', '2026-11-02T00:00:00.000Z', '2026-11-03T00:00:00.000Z')`),
    env.DB.prepare(
      `INSERT INTO expenses VALUES ('e1', 'g1', 'Dinner', 100, 'alice', 'alice', '🍕', '2026-11-19', 'exact', 'EUR', 1000000, NULL, NULL, '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z')`,
    ),
    env.DB.prepare(`INSERT INTO expense_shares VALUES ('e1', 'alice', 100)`),
  ])

  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

  expect(await env.DB.prepare('SELECT * FROM memberships ORDER BY user_id').all().then((r) => r.results)).toEqual([
    { group_id: 'g1', user_id: 'alice', role: 'owner', joined_at: '2026-11-01T00:00:00.000Z', left_at: null, avatar_animal: null, avatar_color: null, nickname: null },
    { group_id: 'g1', user_id: 'bob', role: 'member', joined_at: '2026-11-02T00:00:00.000Z', left_at: '2026-11-03T00:00:00.000Z', avatar_animal: null, avatar_color: null, nickname: null },
  ])
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM expenses').first('n')).toBe(1)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM expense_shares').first('n')).toBe(1)
})
