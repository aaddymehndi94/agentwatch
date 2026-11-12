# 10: UI design pass — impeccable shape → build → critique → polish

**What to build:** The app gets a deliberate, calm, glanceable design for the usage moments in PRODUCT.md: quick glances outside, and dark overnight checks. Work through impeccable shape (DESIGN.md), rebuild the Inbox/Session/Pair/Settings screens on it, then critique and polish at 390×844 in light and dark, including empty, offline, first-run and error states.

**Blocked by:** 04

**Status:** done

- [x] `/impeccable shape` → DESIGN.md + surface brief (Operate mode)
- [x] Screens rebuilt; icons/manifest; reduced motion; 44 px targets; not color-only
- [x] `/impeccable critique` + `/impeccable polish`; Playwright screenshots committed under docs/screenshots

## Notes

- The direction ("kitchen ticket rail": thermal ticket stock in light, a kitchen display in dark) was rolled and built
  unattended overnight, without a decision page. The owner should confirm or re-roll it
  (`packages/app/.impeccable/surfaces/index-html.md`). `DESIGN.md` now documents it as built.
- Critique → polish fixes:
  - **Misleading state:** sessions of an offline computer said IDLE/WORKING as if current. They are now muted and
    labelled "Showing what it last reported"; the session page and the composer say replies can't reach it; tickets
    say an answer only arrives if the computer reconnects within 5 minutes.
  - **Generic asks:** `ask --approve` rendered as "summary privacy" with no question. A question's `--detail` was dropped.
  - **Literal commands:** they broke mid-flag (`-`/`-env`). They now wrap only between tokens (copying still gives the
    exact text).
  - **Disabled buttons:** they lost their outline on the light ground (Send, Pair).
  - **Copy:** "since 23m ago" → "for 23m"; literal backticks on the pair screen became code; the empty rail is one line
    ("✓ Nothing waiting on you"); the privacy line in Settings is on its own line.
  - **Join links:** a `#/join/…` invite opened on a phone now explains that it is for a computer.
  - **Targets:** quick replies, segmented options, the banner action and the online pill are at least 44px.
  - **Icons:** the Offline icon was redrawn so it reads at 20px.
- Demo variants for states: `?demo=calm`, `?demo=new`, `?demo=offline`.
- Screenshots: `pnpm --filter @agentwatch/app screenshots` (headless Chrome, not Playwright: no browser download)
  writes `docs/screenshots/*-{light,dark}.png` at 390×844 @2×.
