# The Assistant: chat that builds without taking the tools away

Branch `claude/ai-ui-agent`. Decision record for goal 2A, 2026-09-30.

## The question

How should a chat interface for building UIs sit in Loom without taking
anything away from building by hand?

## What the alternatives cost

| Placement | Seen in | Cost in Loom |
|---|---|---|
| Chat replaces the canvas (chat left, preview right) | v0, Bolt, Lovable | The canvas stops being the place you work; manual building becomes an afterthought. Rejected. |
| A third side panel beside Properties | Framer, Webflow | Takes 280px+ from the canvas permanently, or takes the Properties panel's place while you chat — you lose the panel you need to adjust what the agent built. |
| A floating prompt over the canvas | Figma-style quick actions | Close to the work and costs no panel; the risk is covering the design. |

Loom already pays for two side panels (toolbox, Properties) and has one free
area where the eye already is: the bottom centre of the canvas, which the view
dock used to occupy (Shane's call, 2026-09-28).

## Decision

1. **Composer bottom-centre of the canvas**; the view dock moves top-right.
   The toolbox, Layers, Properties Panel, canvas handles, context menu and
   keyboard all stay exactly as they are. Chat is one more way in, not a mode.
2. **The canvas stays visible while the agent builds.** The conversation folds
   to one live line while a turn runs ("● Building · 212 steps · add Card",
   with Show); it opens with the reply when the turn ends. The thread used to
   grow to 46% of the viewport over the artboard and hid the build it
   narrated.
3. **The person keeps building during a turn.** An agent turn is a history
   group: its writes merge into one undo step, a person's own edit mid-turn is
   its own step, and the agent's work on either side stays undoable. Undo or
   redo during a turn stops the agent first (rewinding work it is still
   building on would leave it editing nodes that are gone). Previously a
   manual edit mid-turn absorbed the agent's pending work and nothing could
   undo it (selftest §107).
4. **The agent works through the same validated ops as the panel**, live on
   the canvas: every write is checked against the registry (unknown props,
   types, enums, colours refused with reasons), and it can render and measure
   what it built (`render`, `check_layout`) the way a person looks at it.
5. **Selection is context.** What is selected goes with the message, so "make
   this narrower" works; the agent can `select` to point at what it means.
6. **In Preview the Assistant steps aside**; Preview is for using the design.

## Parity with a person

What a person can do in the Studio and what the agent can do, and the gaps
that remain, are tracked in `docs/reviews/ai-agent-grade.md` (goal 2E).
