// Secrets and optional vars (not in wrangler.jsonc). Set with `wrangler secret put CLAIM_SECRET`.
interface __BaseEnv_Env {
  ASSETS: Fetcher
  CLAIM_SECRET?: string
  VAPID_SUBJECT?: string
}
