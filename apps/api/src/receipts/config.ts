// Receipt scanning settings, all in one place.
//
// Budget: Workers AI on the Free plan gives the whole account 10,000 neurons a day (reset 00:00 UTC). The daily cap
// times the worst case for one scan must stay well under that. Cloudflare prices this model per token
// (31,876 neurons per million input tokens, 50,488 per million output tokens) but doesn't publish what an image
// costs in tokens, so the worst case below is an estimate on the generous side:
//   - image: Mistral Small 3.1 turns each 28x28-pixel block into one token (14px patches merged 2x2), plus one
//     break token per row. An image at the 1600px edge limit is at most 58 x 58 + 58 = 3,422 tokens.
//   - prompt: the system prompt and chat template, about 400 tokens; budgeted at 600.
//   - answer: at most RECEIPT_MAX_TOKENS.
// So one scan costs at most about (3,422 + 600) x 0.031876 + 1,024 x 0.050488 ≈ 128 + 52 = 180 neurons, and
// 40 scans a day at most about 7,200 (72% of the allowance). A normal scan (1024px JPEG, short answer) is nearer 70.

/** The Workers AI vision model that reads receipts. */
export const RECEIPT_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct'

/** The longest answer we let the model write: about 50 items. (Its default of 256 tokens cuts off a long receipt.) */
export const RECEIPT_MAX_TOKENS = 1024

/** The largest image we send to the model, in pixels on either side. The web app sends at most 1024. */
export const RECEIPT_MAX_IMAGE_EDGE = 1600

/** The largest scan request body. A 1.5 MB image is about 2 MB as base64. Every other route takes 64 KB. */
export const RECEIPT_SCAN_BODY_LIMIT = 2 * 1024 * 1024

/** Scans each user may make per UTC day. */
export const RECEIPT_SCANS_PER_USER_PER_DAY = 20

/** Scans the whole app may make per UTC day, summed over all users. */
export const RECEIPT_SCAN_DAILY_CAP = 40

/** How long scan counts are kept. Only today's count matters; a week is plenty for a look back. */
export const RECEIPT_SCAN_DAYS_KEPT = 7

const IMAGE_TOKENS_AT_MAX_EDGE = Math.ceil(RECEIPT_MAX_IMAGE_EDGE / 28) ** 2 + Math.ceil(RECEIPT_MAX_IMAGE_EDGE / 28)
const PROMPT_TOKENS = 600

/** The most one scan can cost, by the estimate above. */
export const RECEIPT_WORST_CASE_NEURONS = Math.ceil(
  ((IMAGE_TOKENS_AT_MAX_EDGE + PROMPT_TOKENS) * 31_876) / 1e6 + (RECEIPT_MAX_TOKENS * 50_488) / 1e6,
)

/** Workers AI's free daily allowance for the account. */
export const WORKERS_AI_FREE_NEURONS_PER_DAY = 10_000
