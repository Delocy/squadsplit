import { applyD1Migrations, env } from 'cloudflare:test'
import { expect, it } from 'vitest'

const TABLES = ['guest_joins', 'guest_sessions', 'quick_split_ticks', 'quick_split_item_people', 'quick_split_items', 'quick_split_people', 'quick_splits', 'receipt_scans', 'expense_item_users', 'expense_items', 'expense_shares', 'spins', 'settlements', 'expenses', 'memberships', 'groups', 'users', 'd1_migrations']

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

it('0003_active_member_look clears duplicate stored looks among active members, keeping the earliest joiner’s, then makes them unique', async () => {
  for (const table of TABLES) await env.DB.exec(`DROP TABLE IF EXISTS ${table}`)
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 3))
  const users = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank']
  const member = (group: string, user: string, joinedAt: string, leftAt: string | null, animal: string | null, color: string | null) =>
    env.DB.prepare(`INSERT INTO memberships VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`).bind(
      group, user, user === 'alice' ? 'owner' : 'member', `2026-11-${joinedAt}T00:00:00.000Z`, leftAt, animal, color,
    )
  await env.DB.batch([
    ...users.map((u) => env.DB.prepare(`INSERT INTO users VALUES (?, ?, NULL, '2026-11-01T00:00:00.000Z')`).bind(u, u)),
    env.DB.prepare(`INSERT INTO groups VALUES ('g1', 'Paris', '🥐', 'EUR', 'ABCDEFGH', 'alice', '2026-11-01T00:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO groups VALUES ('g2', 'Tokyo', '🍣', 'SGD', 'HGFEDCBA', 'alice', '2026-11-01T00:00:00.000Z')`),
    member('g1', 'alice', '01', null, 'fox', 'peach'),
    member('g1', 'bob', '02', null, 'fox', 'peach'), // clashes with alice: cleared
    member('g1', 'carol', '02', null, 'koala', 'mint'),
    member('g1', 'dave', '02', null, 'koala', 'mint'), // same join time as carol: the lower user id keeps it
    member('g1', 'erin', '03', '2026-11-04T00:00:00.000Z', 'fox', 'peach'), // former member: untouched
    member('g1', 'frank', '05', null, null, null),
    member('g2', 'alice', '01', null, 'fox', 'peach'), // another group: untouched
    member('g2', 'bob', '01', null, 'bear', 'sky'),
  ])

  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

  const looks = await env.DB.prepare('SELECT group_id, user_id, avatar_animal, avatar_color FROM memberships ORDER BY group_id, user_id').all()
  expect(looks.results).toEqual([
    { group_id: 'g1', user_id: 'alice', avatar_animal: 'fox', avatar_color: 'peach' },
    { group_id: 'g1', user_id: 'bob', avatar_animal: null, avatar_color: null },
    { group_id: 'g1', user_id: 'carol', avatar_animal: 'koala', avatar_color: 'mint' },
    { group_id: 'g1', user_id: 'dave', avatar_animal: null, avatar_color: null },
    { group_id: 'g1', user_id: 'erin', avatar_animal: 'fox', avatar_color: 'peach' },
    { group_id: 'g1', user_id: 'frank', avatar_animal: null, avatar_color: null },
    { group_id: 'g2', user_id: 'alice', avatar_animal: 'fox', avatar_color: 'peach' },
    { group_id: 'g2', user_id: 'bob', avatar_animal: 'bear', avatar_color: 'sky' },
  ])
  await expect(
    env.DB.prepare(`UPDATE memberships SET avatar_animal = 'fox', avatar_color = 'peach' WHERE group_id = 'g1' AND user_id = 'frank'`).run(),
  ).rejects.toThrow(/UNIQUE constraint failed/)
})

it('0004_receipt_scans adds an empty per-user, per-day scan counter without touching existing rows', async () => {
  for (const table of TABLES) await env.DB.exec(`DROP TABLE IF EXISTS ${table}`)
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 4))
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users VALUES ('alice', 'Alice', NULL, '2026-11-01T00:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO groups VALUES ('g1', 'Paris', '🥐', 'EUR', 'ABCDEFGH', 'alice', '2026-11-01T00:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO memberships VALUES ('g1', 'alice', 'owner', '2026-11-01T00:00:00.000Z', NULL, 'fox', 'peach', NULL)`),
  ])

  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM receipt_scans').first('n')).toBe(0)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships').first('n')).toBe(1)
  const bump = () =>
    env.DB.prepare(
      `INSERT INTO receipt_scans (user_id, day, count) VALUES ('alice', '2026-11-19', 1)
       ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 RETURNING count`,
    ).first('count')
  expect(await bump()).toBe(1)
  expect(await bump()).toBe(2)
  await expect(env.DB.prepare(`INSERT INTO receipt_scans VALUES ('alice', '2026-11-19', 1)`).run()).rejects.toThrow(/UNIQUE constraint failed/)
})

it('0005_named_members_profile_look makes every existing user a person with no profile look, keeping their rows', async () => {
  for (const table of TABLES) await env.DB.exec(`DROP TABLE IF EXISTS ${table}`)
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 5))
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users VALUES ('alice', 'Alice', 'https://img/a', '2026-11-01T00:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO users VALUES ('bob', 'Bob', NULL, '2026-11-02T00:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO groups VALUES ('g1', 'Paris', '🥐', 'EUR', 'ABCDEFGH', 'alice', '2026-11-01T00:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO memberships VALUES ('g1', 'alice', 'owner', '2026-11-01T00:00:00.000Z', NULL, 'fox', 'peach', NULL)`),
    env.DB.prepare(`INSERT INTO memberships VALUES ('g1', 'bob', 'member', '2026-11-02T00:00:00.000Z', NULL, NULL, NULL, 'Bobby')`),
    env.DB.prepare(
      `INSERT INTO expenses VALUES ('e1', 'g1', 'Dinner', 100, 'bob', 'alice', '🍕', '2026-11-19', 'exact', 'EUR', 1000000, NULL, NULL, '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z')`,
    ),
    env.DB.prepare(`INSERT INTO expense_shares VALUES ('e1', 'alice', 100)`),
  ])

  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

  expect(await env.DB.prepare('SELECT * FROM users ORDER BY id').all().then((r) => r.results)).toEqual([
    { id: 'alice', display_name: 'Alice', avatar_url: 'https://img/a', created_at: '2026-11-01T00:00:00.000Z', kind: 'person', profile_animal: null, profile_color: null },
    { id: 'bob', display_name: 'Bob', avatar_url: null, created_at: '2026-11-02T00:00:00.000Z', kind: 'person', profile_animal: null, profile_color: null },
  ])
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships').first('n')).toBe(2)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM expense_shares').first('n')).toBe(1)
  await env.DB.prepare(`INSERT INTO users (id, display_name, created_at, kind) VALUES ('ph_1', 'Dave', '2026-11-19T00:00:00.000Z', 'placeholder')`).run()
  expect(await env.DB.prepare(`SELECT kind FROM users WHERE id = 'ph_1'`).first('kind')).toBe('placeholder')
})

it('0006_quick_splits adds empty quick-split tables without touching existing rows, with one payer per split', async () => {
  for (const table of TABLES) await env.DB.exec(`DROP TABLE IF EXISTS ${table}`)
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 6))
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users VALUES ('alice', 'Alice', NULL, '2026-11-01T00:00:00.000Z', 'person', 'fox', 'peach')`),
    env.DB.prepare(`INSERT INTO groups VALUES ('g1', 'Paris', '🥐', 'EUR', 'ABCDEFGH', 'alice', '2026-11-01T00:00:00.000Z')`),
  ])

  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(1)
  for (const table of ['quick_splits', 'quick_split_people', 'quick_split_items', 'quick_split_item_people', 'quick_split_ticks']) {
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n')).toBe(0)
  }
  const now = '2026-11-19T00:00:00.000Z'
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO quick_splits (id, owner_id, title, spent_on, service_charge_bps, gst_bps, share_token, created_at, updated_at) VALUES ('q1', 'alice', 'Lunch', '2026-11-19', 1000, 900, 'tok', ?, ?)`).bind(now, now),
    env.DB.prepare(`INSERT INTO quick_split_people (id, split_id, name, animal, color, position, is_payer) VALUES ('p1', 'q1', 'Dan', 'fox', 'peach', 0, 1)`),
    env.DB.prepare(`INSERT INTO quick_split_people (id, split_id, name, animal, color, position) VALUES ('p2', 'q1', 'Wei Ling', 'koala', 'lilac', 1)`),
  ])
  expect(await env.DB.prepare(`SELECT currency FROM quick_splits WHERE id = 'q1'`).first('currency')).toBe('SGD')
  expect(await env.DB.prepare(`SELECT is_payer FROM quick_split_people WHERE id = 'p2'`).first('is_payer')).toBe(0)
  await expect(env.DB.prepare(`UPDATE quick_split_people SET is_payer = 1 WHERE id = 'p2'`).run()).rejects.toThrow(/UNIQUE constraint failed/)
  await expect(
    env.DB.prepare(`INSERT INTO quick_splits (id, owner_id, title, spent_on, share_token, created_at, updated_at) VALUES ('q2', 'alice', 'Again', '2026-11-19', 'tok', ?, ?)`).bind(now, now).run(),
  ).rejects.toThrow(/UNIQUE constraint failed/)
  await env.DB.prepare(`DELETE FROM quick_splits WHERE id = 'q1'`).run()
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM quick_split_people').first('n')).toBe(0)
})

it('0007_guest_access adds empty guest session and join-count tables without touching existing rows', async () => {
  for (const table of TABLES) await env.DB.exec(`DROP TABLE IF EXISTS ${table}`)
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 7))
  const now = '2026-11-19T00:00:00.000Z'
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users VALUES ('alice', 'Alice', NULL, ?, 'person', NULL, NULL)`).bind(now),
    env.DB.prepare(`INSERT INTO users VALUES ('ph_1', 'Dave', NULL, ?, 'placeholder', NULL, NULL)`).bind(now),
    env.DB.prepare(`INSERT INTO groups VALUES ('g1', 'Paris', '🥐', 'EUR', 'ABCDEFGH', 'alice', ?)`).bind(now),
    env.DB.prepare(`INSERT INTO memberships VALUES ('g1', 'ph_1', 'member', ?, NULL, 'fox', 'peach', NULL)`).bind(now),
  ])

  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(2)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM guest_sessions').first('n')).toBe(0)
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM guest_joins').first('n')).toBe(0)
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET kind = 'guest' WHERE id = 'ph_1'`),
    env.DB.prepare(`INSERT INTO guest_sessions VALUES ('hash1', 'ph_1', 'g1', ?, ?)`).bind(now, now),
    env.DB.prepare(`INSERT INTO guest_joins VALUES ('g1', '2026-11-19T00', 1)`),
  ])
  expect(await env.DB.prepare(`SELECT kind FROM users WHERE id = 'ph_1'`).first('kind')).toBe('guest')
  // A session is for a real user in a real group, and each token is stored once.
  await expect(env.DB.prepare(`INSERT INTO guest_sessions VALUES ('hash1', 'ph_1', 'g1', ?, ?)`).bind(now, now).run()).rejects.toThrow(/UNIQUE constraint failed/)
  await expect(env.DB.prepare(`INSERT INTO guest_sessions VALUES ('hash2', 'nobody', 'g1', ?, ?)`).bind(now, now).run()).rejects.toThrow(/FOREIGN KEY/)
  await expect(env.DB.prepare(`INSERT INTO guest_joins VALUES ('g1', '2026-11-19T00', 1)`).run()).rejects.toThrow(/UNIQUE constraint failed/)
})
