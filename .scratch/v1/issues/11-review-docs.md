# 11: Review, security review, docs and CI

**What to build:** The repo is ready to share publicly. That means a code review and a security review with their findings fixed, plus a README covering deploy, setup, pairing and screenshots (and the Deploy-to-Cloudflare button), SECURITY.md (threat model and honest limits), CONTRIBUTING.md, LICENSE (MIT), docs/architecture.md, and GitHub Actions CI (typecheck, lint, test).

**Blocked by:** 01–10

**Status:** ready-for-agent

- [ ] /code-review + /security-review on the full diff; findings fixed or recorded
- [ ] README, SECURITY.md, CONTRIBUTING.md, LICENSE, docs/architecture.md
- [ ] .github/workflows/ci.yml green locally (act-free: same commands)
- [ ] No secrets in git history (scan)
