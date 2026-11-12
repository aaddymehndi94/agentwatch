---
name: AgentWatch
description: A pager for your coding agents. One sentence says whether anything needs you; everything else reads like a modern chat.
colors:
  ground: "#f2f3f7"
  surface: "#ffffff"
  surface-2: "#f4f5f9"
  surface-3: "#e9ebf2"
  code-ground: "#f6f7fa"
  user-bubble: "#e2e6f3"
  text: "#0a0c14"
  text-2: "#4b5266"
  text-3: "#646b7f"
  live: "#0874b3"
  idle: "#5b4ee6"
  ok: "#067a52"
  warm: "#b4410f"
  bad: "#c4153b"
  focus: "#2563eb"
  night-ground: "#05060a"
  night-surface: "#0d0f16"
  night-surface-2: "#141722"
  night-surface-3: "#1c202d"
  night-code-ground: "#08090e"
  night-user-bubble: "#1b2031"
  night-text: "#f2f4f9"
  night-text-2: "#a9b0c2"
  night-text-3: "#7f879b"
  night-live: "#5ad1ff"
  night-idle: "#ab9fff"
  night-ok: "#3fdc9a"
  night-warm: "#ffa45c"
  night-bad: "#ff6b81"
  night-focus: "#7cc4ff"
  brand-cyan: "#5ee7ff"
  brand-violet: "#9b87ff"
  heat-fresh: "#ffc23d"
  heat-waiting: "#ff8a3d"
  heat-overdue: "#ff4a6b"
typography:
  status:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 650
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.18
    letterSpacing: "-0.03em"
  question:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17.5px"
    fontWeight: 620
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  bar-title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 620
    lineHeight: 1.25
  row-title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 600
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  message:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: 1.62
  meta:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  code:
    fontFamily: "Geist Mono Variable, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  timer:
    fontFamily: "Geist Mono Variable, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 600
rounded:
  pill: "999px"
  request: "26px"
  list: "24px"
  bubble: "22px"
  field: "18px"
  block: "16px"
  tile: "12px"
  code-inline: "6px"
spacing:
  gutter: "16px"
  status-pad: "20px"
  stack-gap: "14px"
  thread-gap: "22px"
  tap: "44px"
  button: "52px"
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    height: "52px"
    padding: "0 20px"
  button-primary-night:
    backgroundColor: "{colors.night-text}"
    textColor: "{colors.night-ground}"
    rounded: "{rounded.pill}"
    height: "52px"
  button-ghost:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    height: "52px"
    padding: "0 20px"
  button-small:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    height: "36px"
    padding: "0 14px"
  request-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.request}"
    padding: "16px"
  session-list:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.list}"
  user-bubble:
    backgroundColor: "{colors.user-bubble}"
    textColor: "{colors.text}"
    rounded: "{rounded.bubble}"
    padding: "11px 16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    height: "54px"
    padding: "0 18px"
  code-block:
    backgroundColor: "{colors.code-ground}"
    textColor: "{colors.text}"
    typography: "{typography.code}"
    rounded: "{rounded.block}"
    padding: "12px 14px"
---

# Design System: AgentWatch

## Overview

**Creative North Star: "Night-sky glass"**

AgentWatch is checked in three moments (see `PRODUCT.md`): outside, a glance after a buzz, and overnight in the dark.
The app answers one question first, "does anything need me?", in a single sentence at the top of the inbox. Blocked
work sits directly under it, each request carrying its exact proof and its decision at thumb height. Everything else
is a quiet, grouped list. A session reads like a modern chat: your prompts as bubbles, the agent's replies as rendered
Markdown.

The craft bar is current premium software: Linear, Raycast, iOS system apps. The look is dark-first, a near-black
blue ground under a soft light at the top of the screen, with frosted chrome, generous radii, Geist type and an
inverted pill as the one primary action. Light mode is a full twin, not an afterthought. Mode: **Operate**, phone
first (390×844), one hand.

**Key Characteristics:**
- One status sentence answers the glance; the sky behind it changes temperature with it.
- Waiting requests have a live edge that heats from amber to red as the wait grows.
- State is carried by a word, an orb shape and a colour, never colour alone.
- Agent text is rendered Markdown with highlighted code, never raw text.
- Every control is a standard one: buttons, lists, segmented controls, a text field.

## Colors

Tokens live in `packages/app/src/styles.css` as custom properties that use `light-dark()`, so one declaration covers
both themes and Settings → Appearance can force either one. The `night-*` tokens above are the dark halves.

### Primary
- **Text** (`--text`) and its inverse make the primary button: ink on light, near-white on dark. The primary action
  is an inverted pill, not a brand colour.
- **Brand cyan → violet** (`--brand-a`, `--brand-b`) appears only in the mark, the agent avatar and the calm sky. It
  is never used for text and never for state.

### State
- **Warm** (`--warm`, plus the heat ramp `--heat-0/1/2`) means one thing: something is waiting on you. It's used on
  the "Needs you" state word, the request icon tile, the timer pill, the live edge and the warm sky. Its text tones
  (`--warm-0/1/2`) pass 4.5:1 in both themes.
- **Live** (`--live`) is working. **Idle** (`--idle`) is finished and waiting for your next prompt. **OK** (`--ok`)
  is online, applied and approved. **Bad** (`--bad`) is an error, a rejection, or a destructive action such as
  Unpair.

### Neutral
- `--bg` sits behind everything. `--surface` is lists, cards and the composer. `--surface-2/3` are option rows,
  pressed states and the segmented thumb. `--code-bg` is behind every code or proof block.
- `--text-2` is secondary and `--text-3` tertiary; both pass 4.5:1 on ground and surface in both themes.
- `--line` and `--line-2` are hairlines. `--line-2` is for anything interactive (outlined buttons, inputs, option
  rows).

### Named Rules
**The Warm-Is-Earned Rule.** Nothing decorative is warm. When nothing waits on you, the screen has no orange or red,
and the sky is cool.

**The Never-Colour-Alone Rule.** Every state has a word (Needs you, Working, Idle, Ended) and an orb behaviour:
ping, orbiting arc, still, hollow. Every decision has an icon and a label (✓ Approve, ✕ Deny). Online and offline are
a filled dot versus a ring.

## Typography

**Sans:** Geist (variable, self-hosted through `@fontsource-variable/geist`; the CSP allows no font hosts).
**Mono:** Geist Mono, reserved for real data: commands, paths, code, timers, ages and `user@host`.

### Hierarchy
- **Status** (36/650, -0.04em) is the inbox sentence, and the only display size.
- **Title** (25/650) is a session's first prompt. **Onboarding titles** are 31/650.
- **Question** (17.5/620) appears in request cards. **Bar title** is 17/620.
- **Row title** (15.5/600) sits over a 13.5 preview in `--text-2`, clamped to two lines, with the state word leading
  in its colour.
- **Message** (15.5/1.62) is agent Markdown. Headings inside it stay small (1.28em, 1.14em, 1em) so a reply never
  shouts over the app.
- Numerals are tabular wherever they count (timers, ages, tables).

### Named Rules
**The Mono-Means-Data Rule.** Monospace marks something you could paste into a terminal or that measures time. It
never decorates.

## Layout

- A single column, at most 600px, centred. The gutter is 16px.
- **Inbox:** the frosted bar, the status sentence, the request stack (full-width cards, 14px apart, longest wait
  first), then groups by `user@host`, each an inset list.
- **Session:** the bar carries the project and a state line. Then the first-prompt title, the thread (22px rhythm),
  a "working" line while it runs, any open requests, and a sticky composer whose top fades into the ground.
- **Settings:** groups with a small heading over an inset list, or a segmented control.
- **Onboarding:** centred, with the 72px mark, a 31px title, a lede and full-width fields and buttons.

## Elevation & Depth

There are three layers. The ground carries the sky. Surfaces (lists, cards, the composer) sit on soft two-part
shadows (`--shadow`: a 1px contact plus a long, low-opacity drop). Chrome (the bar) is frosted glass that solidifies
as content scrolls under it, using a scroll-driven animation. A request card adds a heat-tinted glow under itself.
That glow is the only coloured shadow, and it means "waiting".

### Named Rules
**The Glass-Is-Chrome Rule.** Blur appears only where content really scrolls under something: the top bar and the
banners. Cards are never glass.

## Shapes

- **Pills** (999px) are buttons, the online pill, quick replies and timers.
- **Large radii** step down with nesting: request 26, list 24, bubble 22, field 18, block 16, icon tile 12, inline
  code 6.
- A user bubble has a 6px tail corner at the bottom right.
- **Icons** are one authored set in `src/ui/icons.tsx`: 24px grid, 1.75 stroke, round caps.
- **The mark** is a watch ring with a live core and one amber dot in the ring's gap. It is the same drawing in the
  app and in the home-screen icon.

## Components

### Buttons
- **Primary** is the inverted pill, 52px. There is one per card: Approve, Send answer, Pair.
- **Ghost** is a `--line-2` outline on a translucent surface, for the counter-action (Deny, Go to inbox).
- **Quiet/small** is a 36px pill with a 44px hit area, for row actions (Turn on, Send test, Retry). **Danger** is
  quiet with `--bad` text.
- **Disabled** keeps its outline, in `--text-3`. Its label says what's missing ("Pick an answer").

### Request card (signature)
- **Header:** an icon tile (terminal, file or question) on a heat tint; the kind ("Claude needs approval"); project
  · `user@host`; and a heat-coloured mono timer pill.
- **Proof:** the literal command in a code block captioned with the tool. It wraps only between tokens, and an
  edit's `-`/`+` lines are tinted.
- **Question options:** 56px rows with a radio or checkbox tick.
- **Decision:** Deny | Approve in a 1 : 1.55 grid. Once you act, the footer becomes the command's status.
- **The live edge:** a conic light around the border that turns once every 5.5 s, coloured by the heat ramp. It is
  static under reduced motion.

### Session rows
An orb, the project, agent · age on the right, and the state word plus a plain-text preview, clamped to two lines.
Separators are inset, and rows from an offline computer show grey orbs.

### Conversation
- **You:** right-aligned bubbles, with the time below (plus "From your phone" for replies).
- **Agent:** a gradient monogram avatar, then Markdown at full width with no bubble.
- **System events:** a compact row with an icon tile, a label, one line of mono detail, and the time.

### Markdown
- Paragraphs keep the agent's line breaks.
- Lists nest. Task lists show ticks. Tables scroll inside a rounded frame.
- Code blocks have a language caption and a Copy button, with light syntax colouring.
- Quotes have a 2px neutral rule.
- Links show as accent text with their host in brackets. They are never clickable, because an agent can print
  anything. No HTML is ever interpreted.

### Inputs and composer
- Fields are 54px with an 18px radius. Focus shows a cyan ring of 4px at 15%.
- The composer is a 28px-radius capsule with a 44px round Send. Quick-reply pills only fill the box; nothing is sent
  until you press Send.

## Do's and Don'ts

### Do:
- **Do** lead every screen with the answer: the status sentence, or the session's state in the bar.
- **Do** show the exact command or file before any decision.
- **Do** keep warm colours for waiting, and let the sky cool when nothing is.
- **Do** render agent text as Markdown, and flatten it to plain text for previews.

### Don't:
- **Don't** use gradient text, glass on cards, or coloured side borders.
- **Don't** add brand colour to state, or state colour to decoration.
- **Don't** make agent-provided links clickable, or render agent HTML.
- **Don't** add equal-weight dashboard cards. The inbox is a sentence, a stack and lists.
