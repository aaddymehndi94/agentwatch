---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# AgentWatch app (phone PWA)

**Scope and mode:** the whole installable app: Inbox, Session, Pair, Settings. Mode: Operate. Phone first (390×844),
one hand, often outside or in the dark; desktop browsers get the same app centred.

**Job:** see in one glance which agent is blocked and for how long. Then approve, deny, answer or reply safely, and
put the phone away. Proof that it works is the exact command, file or question shown before the decision, never a
summary of it.

**Decision round:** run unattended overnight. The roll's assigned direction was taken without a decision page and is
to be confirmed or re-rolled by the owner. Challenger verdicts and raises are listed below.

## Direction contract

THESIS: Agents waiting on you are tickets on a kitchen pass, and the ticket's timer is the product. The category
default is a grey dashboard of equal session cards with a coloured status dot. This app refuses it: blocked work hangs
on a rail above everything else, aging visibly, and the rest of the list stays quiet.

OWN-WORLD: The kitchen-display/expo palette in two lights.
- Light is thermal ticket stock: warm-white paper ground, carbon-black print, and the two-ply printer's red as the only
  loud colour, reserved for "needs you".
- Dark is the KDS screen: near-black ground, paper-coloured tickets, and ticket headers that heat from neutral to amber
  to red as wait time grows.
- Type: one workhorse sans for content. Tabular mono only for real data (times, ids, commands).
- Components: ticket slips with a perforated top edge. Standard buttons, lists and tabs.

STORY: Pocket buzzes → open → the rail shows one ticket "Claude needs approval · api-server, 4m". It shows the exact
command, with Approve and Deny at thumb height. Tap Approve: the ticket is bumped off the rail, the session drops into
the quiet list as working, and the phone goes back in the pocket.

FIRST VIEWPORT: A top bar with the product name, a sources/online summary and settings. Below it, the rail: a
horizontal row of request tickets (one fills the width; more scroll sideways), each with a timer, its source, the
command or question, and Approve/Deny or option buttons. Under the rail, sessions grouped by host and user as plain
rows: state word, project, agent, age, and a one-line snippet. Empty rail state: "Nothing waiting on you", and the
list moves up.

FORM: kitchen ticket rail / KDS expo (candidate 5 of 7 on my resonance list: ATC flight strips, on-call pager, CI
checks, departure board, kitchen ticket rail, traffic signals, QSL cards). seed:7abff6d86f882161

Raises from the challengers:
- From the zoo map (declined): one object does the dividing. Tickets and rows separate by edge and ground, with no
  card-in-card chrome.
- From the Saville catalog (declined): strict numbering. Each request gets a ticket number in arrival order.
- From monochrome product marketing (competitive on clarity): every ask is paired with its proof, the literal command
  or path.
- From the acetate manual (declined): ply is the only rank. The rail sits one layer above the list, and nothing else
  floats.
- From Labanotation (declined): length is duration. The timer bar's fill is proportional to time waited, on a log scale.
- From Ikeda (declined): tabular numerals everywhere, and a still rendering under reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
