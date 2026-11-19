// Receipt scanning settings, all in one place. Workers AI on the Free plan allows 10,000 neurons a day for the whole
// account; one scan costs very roughly 50-100 neurons, so the app-wide cap keeps us well inside it.

/** The Workers AI vision model that reads receipts. */
export const RECEIPT_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct'

/** The longest answer we let the model write (its default of 256 tokens cuts off a long receipt). */
export const RECEIPT_MAX_TOKENS = 2048

/** Scans each user may make per UTC day. */
export const RECEIPT_SCANS_PER_USER_PER_DAY = 20

/** Scans the whole app may make per UTC day, summed over all users. */
export const RECEIPT_SCAN_DAILY_CAP = 80
