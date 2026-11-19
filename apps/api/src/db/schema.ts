import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const ROLES = ['owner', 'member'] as const
export const SPLIT_TYPES = ['equal', 'exact'] as const
export const SETTLEMENT_STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'] as const

/** SQL `IN (...)` list for a CHECK constraint over a fixed set of string literals. */
const oneOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '))

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
})

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  emoji: text('emoji').notNull(),
  currency: text('currency').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at').notNull(),
})

export const memberships = sqliteTable(
  'memberships',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ROLES }).notNull(),
    joinedAt: text('joined_at').notNull(),
    leftAt: text('left_at'),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index('memberships_user_id_idx').on(t.userId),
    check('memberships_role_check', sql`${t.role} IN (${oneOf(ROLES)})`),
  ],
)

export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    paidBy: text('paid_by')
      .notNull()
      .references(() => users.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    category: text('category').notNull(),
    spentOn: text('spent_on').notNull(),
    splitType: text('split_type', { enum: SPLIT_TYPES }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('expenses_group_id_idx').on(t.groupId),
    check('expenses_amount_cents_check', sql`${t.amountCents} > 0`),
    check('expenses_split_type_check', sql`${t.splitType} IN (${oneOf(SPLIT_TYPES)})`),
  ],
)

export const expenseShares = sqliteTable(
  'expense_shares',
  {
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.userId] }),
    check('expense_shares_amount_cents_check', sql`${t.amountCents} > 0`),
  ],
)

export const settlements = sqliteTable(
  'settlements',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => users.id),
    toUserId: text('to_user_id')
      .notNull()
      .references(() => users.id),
    amountCents: integer('amount_cents').notNull(),
    status: text('status', { enum: SETTLEMENT_STATUSES }).notNull(),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
  },
  (t) => [
    index('settlements_group_id_idx').on(t.groupId),
    check('settlements_amount_cents_check', sql`${t.amountCents} > 0`),
    check('settlements_status_check', sql`${t.status} IN (${oneOf(SETTLEMENT_STATUSES)})`),
  ],
)

export const spins = sqliteTable(
  'spins',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    spunBy: text('spun_by')
      .notNull()
      .references(() => users.id),
    winnerId: text('winner_id')
      .notNull()
      .references(() => users.id),
    weightsJson: text('weights_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('spins_group_id_idx').on(t.groupId)],
)
