// Secrets and optional vars (not in wrangler.jsonc). Set with `wrangler secret put CLAIM_SECRET`.
interface __BaseEnv_Env {
  ASSETS: Fetcher
  CLAIM_SECRET?: string
  VAPID_SUBJECT?: string
  /** Tests only: push "offline" after this many seconds instead of 10 minutes. */
  OFFLINE_AFTER_SECONDS?: string
  /** Tests only: accept http://127.0.0.1 push endpoints (a fake push service). */
  ALLOW_INSECURE_PUSH?: string
}
