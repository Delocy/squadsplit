import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const ROLES = ['owner', 'member'] as const
export const SPLIT_TYPES = ['equal', 'exact', 'itemized'] as const
export const SETTLEMENT_STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'] as const
/**
 * A person signs in (their id is Clerk's); a placeholder is a name in one group for someone who hasn't joined yet; a
 * guest joined one group from its invite link with no account (their phone holds a guest session).
 */
export const USER_KINDS = ['person', 'placeholder', 'guest'] as const

/** SQL `IN (...)` list for a CHECK constraint over a fixed set of string literals. */
const oneOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '))

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
  /**
   * 'placeholder' rows have ids starting with `ph_`, belong to one group, and are deleted when someone claims them.
   * 'guest' rows belong to one group too: a new guest's id starts with `gs_`; a guest who claimed a name keeps its `ph_` id.
   */
  kind: text('kind', { enum: USER_KINDS }).notNull().default('person'),
  /** The look the user picked for themselves (outside groups, and where a new group starts them). Null: their default. */
  profileAnimal: text('profile_animal'),
  profileColor: text('profile_color'),
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
    /** The member's look in this group. Null (rows from before 0002) means their default; see effectiveAvatar. */
    avatarAnimal: text('avatar_animal'),
    avatarColor: text('avatar_color'),
    /** What the member is called in this group. Null means their profile name (users.display_name). */
    nickname: text('nickname'),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index('memberships_user_id_idx').on(t.userId),
    check('memberships_role_check', sql`${t.role} IN (${oneOf(ROLES)})`),
    /** No two active members of a group store the same look. Plain column names: SQLite rejects qualified ones here. */
    uniqueIndex('memberships_active_look_uq')
      .on(t.groupId, t.avatarAnimal, t.avatarColor)
      .where(sql`left_at IS NULL AND avatar_animal IS NOT NULL AND avatar_color IS NOT NULL`),
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
    currency: text('currency').notNull(),
    /** Exchange rate to the group currency in parts per million; always 1000000 in v1. */
    fxRatePpm: integer('fx_rate_ppm').notNull().default(1_000_000),
    /** Itemized only, in basis points; null for equal and exact splits. */
    serviceChargeBps: integer('service_charge_bps'),
    gstBps: integer('gst_bps'),
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

/** The line items of an itemized expense, in bill order. */
export const expenseItems = sqliteTable(
  'expense_items',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [
    index('expense_items_expense_id_idx').on(t.expenseId),
    check('expense_items_amount_cents_check', sql`${t.amountCents} > 0`),
  ],
)

/** Who shared each item of an itemized expense. */
export const expenseItemUsers = sqliteTable(
  'expense_item_users',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => expenseItems.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.userId] })],
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

/** Receipt scans per user per UTC day (YYYY-MM-DD), for the daily limits. The app-wide count is the day's sum. */
export const receiptScans = sqliteTable(
  'receipt_scans',
  {
    userId: text('user_id').notNull(),
    day: text('day').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] }), index('receipt_scans_day_idx').on(t.day)],
)

export const PAID_MARKED_BY = ['guest', 'payer'] as const

/**
 * A quick split: one bill, outside any group, split with people who have no accounts. Only its owner sees it in the
 * app; anyone with its share link sees the names and amounts. Totals are never stored (see quickSplitBreakdown).
 */
export const quickSplits = sqliteTable(
  'quick_splits',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    place: text('place'),
    spentOn: text('spent_on').notNull(),
    currency: text('currency').notNull().default('SGD'),
    serviceChargeBps: integer('service_charge_bps'),
    gstBps: integer('gst_bps'),
    /** 22 characters of base64url (128 random bits). The link stops at share_expires_at, or once revoked. */
    shareToken: text('share_token').unique(),
    shareExpiresAt: text('share_expires_at'),
    shareRevokedAt: text('share_revoked_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('quick_splits_owner_id_idx').on(t.ownerId),
    check('quick_splits_service_charge_bps_check', sql`${t.serviceChargeBps} BETWEEN 0 AND 3000`),
    check('quick_splits_gst_bps_check', sql`${t.gstBps} BETWEEN 0 AND 3000`),
  ],
)

/** Who's in a quick split, by name, in the order entered (position 0 is the owner). Exactly one paid the bill. */
export const quickSplitPeople = sqliteTable(
  'quick_split_people',
  {
    id: text('id').primaryKey(),
    splitId: text('split_id')
      .notNull()
      .references(() => quickSplits.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    animal: text('animal').notNull(),
    color: text('color').notNull(),
    position: integer('position').notNull(),
    isPayer: integer('is_payer', { mode: 'boolean' }).notNull().default(false),
    /** When they were ticked as paid, and by whom: the guest on the share link, or the payer. Never set for the payer. */
    paidAt: text('paid_at'),
    paidMarkedBy: text('paid_marked_by', { enum: PAID_MARKED_BY }),
  },
  (t) => [
    index('quick_split_people_split_id_idx').on(t.splitId),
    /** One payer per split. Plain column names: SQLite rejects qualified ones here. */
    uniqueIndex('quick_split_people_payer_uq').on(t.splitId).where(sql`is_payer = 1`),
    check('quick_split_people_paid_marked_by_check', sql`${t.paidMarkedBy} IN (${oneOf(PAID_MARKED_BY)})`),
  ],
)

/** The dishes on a quick split's bill, in bill order. */
export const quickSplitItems = sqliteTable(
  'quick_split_items',
  {
    id: text('id').primaryKey(),
    splitId: text('split_id')
      .notNull()
      .references(() => quickSplits.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    amountCents: integer('amount_cents').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    index('quick_split_items_split_id_idx').on(t.splitId),
    check('quick_split_items_amount_cents_check', sql`${t.amountCents} > 0`),
  ],
)

/** Who had each dish. */
export const quickSplitItemPeople = sqliteTable(
  'quick_split_item_people',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => quickSplitItems.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => quickSplitPeople.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.personId] })],
)

/** Ticks and unticks on a quick split's share link per UTC hour ('YYYY-MM-DDTHH'), for the hourly limit. */
export const quickSplitTicks = sqliteTable(
  'quick_split_ticks',
  {
    splitId: text('split_id')
      .notNull()
      .references(() => quickSplits.id, { onDelete: 'cascade' }),
    hour: text('hour').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.splitId, t.hour] }), index('quick_split_ticks_hour_idx').on(t.hour)],
)

/**
 * A guest's sign-in on one phone, for one group. Only the SHA-256 (hex) of the token is stored, never the token. A
 * guest with no session (the owner reset the link, or freed up the name) is an unclaimed name again.
 */
export const guestSessions = sqliteTable(
  'guest_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    createdAt: text('created_at').notNull(),
    /** Moved on at most once an hour, so reading a group isn't a write each time. */
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (t) => [index('guest_sessions_user_id_idx').on(t.userId), index('guest_sessions_group_id_idx').on(t.groupId)],
)

/** Guest joins per group per UTC hour ('YYYY-MM-DDTHH'), for the hourly limit. No IP address is stored. */
export const guestJoins = sqliteTable(
  'guest_joins',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    hour: text('hour').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.hour] }), index('guest_joins_hour_idx').on(t.hour)],
)
