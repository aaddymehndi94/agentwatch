---
name: AgentWatch
description: A pager for your coding agents. Blocked work hangs on a rail; everything else stays quiet.
colors:
  ground: "#dfe2e1"
  ground-2: "#d2d6d5"
  rail: "#b9bfbe"
  paper: "#fbfbf8"
  paper-2: "#f0f1ed"
  ink: "#141517"
  ink-2: "#464a4f"
  ink-3: "#676c72"
  rule: "#c3c8c7"
  rule-paper: "#e2e3de"
  printer-red: "#c0112d"
  printer-red-ink: "#a50e26"
  amber-ink: "#8a5200"
  ok-ink: "#1b6542"
  heat-cold: "#9aa0a4"
  heat-warm: "#d89512"
  heat-hot: "#c0112d"
  focus: "#1f5fd1"
  kds-ground: "#0d0e0f"
  kds-ground-2: "#141618"
  kds-paper: "#1b1e21"
  kds-paper-2: "#24282c"
  kds-ink: "#ecebe6"
  kds-ink-2: "#b4b8bb"
  kds-ink-3: "#91969a"
  kds-red: "#ff4d5e"
  kds-amber-ink: "#f2ab48"
  kds-ok-ink: "#5fcf95"
  kds-focus: "#79a6ff"
typography:
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  hero:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  session-title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  question:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.35
  state-word:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "11.5px"
    fontWeight: 700
    letterSpacing: "0.04em"
  literal:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, Menlo, Consolas, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  timer:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, Menlo, Consolas, monospace"
    fontSize: "15px"
    fontWeight: 600
rounded:
  ticket: "0 0 4px 4px"
  control: "6px"
  pill: "18px"
spacing:
  gutter: "16px"
  tap: "48px"
  rail-gap: "12px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "48px"
    padding: "0 18px"
  button-outline:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "48px"
    padding: "0 18px"
  button-disabled:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.control}"
    height: "48px"
  ticket:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ticket}"
    padding: "14px"
  literal-block:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    typography: "{typography.literal}"
    padding: "10px 12px"
---

# Design System: AgentWatch

## Overview

**Agents waiting on you are tickets on a kitchen pass, and the ticket's timer is the product.** The category default
is a grey dashboard of equal session cards with coloured dots. AgentWatch refuses it: whatever is blocked on you hangs
on a rail above everything else, and you can see it aging. The rest of the list stays quiet.

The app is used in three moments (see `PRODUCT.md`): outside with the laptop at home, a glance after a buzz, and
overnight checks in the dark. Mode: **Operate**. Phone first (390×844), one hand. Light and dark are both first-class,
and the system setting picks between them.

- **Light: thermal ticket stock on a steel pass.** A cool grey-green ground, warm-white paper tickets, carbon-black
  print, and the two-ply printer's red as the only loud colour.
- **Dark: a kitchen display at night.** A near-black ground, charcoal tickets, paper-coloured ink. Ticket headers heat
  from neutral to amber to red as the wait grows.

## Colors

The tokens live in `packages/app/src/styles.css` as CSS custom properties. The dark set (`kds-*` above) replaces the
light one under `prefers-color-scheme: dark`, or when Settings → Appearance says Dark.

### Primary
- **Ink** (`--ink`) is print: text, the primary button's fill, the outline of an active button.
- **Paper** (`--paper`, `--paper-2`) is a ticket and the literal block inside it.

### Heat (the only colour with meaning)
- **Printer red** (`--red`, `--red-ink`) means one thing: an agent has been waiting on you. It's used for the "Needs
  you" state word, the waiting count, and the hot end of the timer.
- **Heat** (`--heat-0` → `--heat-1` → `--heat-2`): the timer bar's fill and the timer digits, mixed in OKLab along a
  log scale of time waited. Under a minute is neutral, a few minutes is amber, and half an hour or more is red.
- **OK ink** (`--ok-ink`) marks "online" and "working", and the check in "Nothing waiting on you".

### Neutral
- `--ground` / `--ground-2` sit behind everything; the rail's band is `--ground-2`, with a 3px `--rail` edge on top.
- `--ink-2` is secondary text and `--ink-3` is tertiary. Both pass 4.5:1 on ground and on paper in both themes.
- `--rule` separates rows on the ground, and `--rule-paper` separates rows on paper.

### Named rules
- **Red is earned.** Nothing decorative is red. If everything is calm, the screen has no red at all.
- **Never colour alone.** Every state has a word (NEEDS YOU, WORKING, IDLE, ENDED) and every decision has an icon and a
  label (✓ Approve, ✕ Deny). Online and offline show as a filled dot versus a ring.

## Typography

There is one workhorse sans: the platform's own (`system-ui`). It loads instantly offline, reads natively on iOS and
Android, and the app has no display voice to carry. Monospace is reserved for real data: commands and paths in the
literal block, ticket timers, ticket numbers and clock times, and `user@host` names. All numerals are tabular.

### Hierarchy
- Hero (26/750) appears on the pairing screens only.
- Session title (22/700) and question (17/600) wrap with `text-wrap: balance`.
- Body is 15/400. Row titles are 15/650, and snippets are 14 in `--ink-2`, clamped to two lines.
- State words are 11.5/700, uppercase, tracked 0.04em, in a fixed 76px column so rows scan down one edge.

## Layout

- A single column, at most 560px wide, centred on desktop with rules on both sides. The gutter is 16px.
- **Inbox.** At the top, a sticky bar: the product name, an online summary pill and settings. Below it, the rail: one
  full-width ticket at a time, snapping, with the next one peeking in from the right and dots under it. Then sessions
  grouped by `user@host`, each a plain row: state word | project + snippet | agent + age.
- **Empty rail.** A single line, "✓ Nothing waiting on you", and the list moves up.
- **Session.** The title, then a meta line (state word, *for 4m*, agent, `user@host`). Then the tickets for this
  session, the last message, a short timeline, and the reply composer pinned to the end.

## Elevation & Depth

There are two plies, and ply is the only rank: the rail and its tickets sit one layer above the list, and nothing else
floats. Tickets and the "last message" slip carry `--shadow`, a soft offset shadow, never a halo. Rows separate by
rules and ground, never by card-in-card chrome.

## Shapes

- **Tickets** have a perforated top edge (a CSS mask of half-circles every 12px) and 4px corners at the bottom only.
- **Controls** (buttons, inputs, options) have 6px corners. The online summary is an 18px pill.
- **Icons** are one authored set (`src/ui/icons.tsx`): a 24px grid, 1.75 stroke, round caps and joins.

## Components

### Buttons
- **Primary:** an ink fill with paper text. It's the one per ticket that moves the work forward (Approve, Send answer
  once complete, Pair).
- **Outline:** a 1.5px ink outline, used for the counter-action (Deny).
- **Quiet:** a `--rule` outline, for secondary actions (Copy, Skip for now).
- **Disabled:** text in `--ink-3`, and an outline of `--ink-3` at 50% so it still reads as a button on ground and on
  paper. It's never borderless.
- Every target is at least 44px; buttons are 48px. The online pill looks 36px but its hit area is 44px.

### Ticket (signature component)
- The header holds the kind ("Claude needs approval", "Codex has a question") and the timer in mono, coloured by heat.
- Under it, a 4px timer track whose fill is proportional to log(time waited).
- Then where it is (project, `user@host`, #seq, clock time).
- Then the proof: the literal command or path in a mono block, wrapping only between tokens so `--env` never splits.
  A question shows its options.
- Then the decision, at thumb height.
- When its computer is offline, a note says an answer reaches it only if it reconnects within 5 minutes.
- After you act, the footer becomes the command's status: Sending…, Waiting for your computer…, the result, or why it
  was not applied.

### Rows
A full-width button with a 76px state column, project title and a two-line snippet, and agent plus age on the right.
Rows from an offline computer are muted, with the note "Showing what it last reported."

### Inputs
Inputs are 48px, with a `--rule` outline that turns into the focus colour. The reply composer's quick replies only fill
the box; nothing is sent until you press Send.

### Banners
A `--ground-2` strip under the top bar, with an icon in full ink, one sentence and one action: Can't reach your relay
(Retry), Muted until 08:00 (Unmute), This phone was unpaired.

## Do's and Don'ts

### Do:
- Put the literal proof (the exact command, path or question) on every request, before the decision.
- Keep the calm path silent: no colour, no motion, no badges when nothing needs you.
- Say what is true now. An offline computer's sessions are labelled as last reported, and a reply that can't arrive
  says so before you type it.
- Check every change at 390×844 in light and dark (`pnpm --filter @agentwatch/app screenshots`).

### Don't:
- Don't add cards around rows, eyebrow labels over headings, or coloured left borders.
- Don't use red for anything but waiting on you.
- Don't animate entrances. The one moving thing is the timer bar's fill. It and the spinner are stilled under
  `prefers-reduced-motion`.
- Don't use monospace as a "technical" costume. It is for literals and numbers.
