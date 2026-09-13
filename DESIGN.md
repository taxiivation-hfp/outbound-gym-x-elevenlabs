---
name: Retention Router
description: Back-office screens for a gym's outbound retention agent — who gets called, who never does, and what the agent is allowed to say.
colors:
  canvas: "#000000"
  surface: "#09090b"
  surface-raised: "#18181b"
  hairline: "#27272a"
  hairline-quiet: "#18181b"
  ink: "#fafafa"
  ink-body: "#d4d4d8"
  ink-secondary: "#a1a1aa"
  ink-muted: "#71717a"
  control-edge: "#71717a"
  signal-lime: "#d6ff3d"
  signal-lime-hover: "#c2eb2b"
  caution-amber: "#fcd34d"
  caution-amber-edge: "#92400e"
  fault-red: "#fca5a5"
  fault-red-edge: "#b91c1c"
  info-cyan: "#67e8f9"
typography:
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 900
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  caption:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  prompt:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.signal-lime}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.signal-lime-hover}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-body}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    typography: "{typography.body}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "20px"
  prompt-block:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-body}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
    typography: "{typography.prompt}"
---

# Design System: Retention Router

## 1. Overview

**Creative North Star: "The Night-Shift Ledger"**

A ledger kept by someone careful, on a dark screen beside the booking system. Every line on it is either a fact with its source or an explicit blank. The system is dark by construction, not by toggle: a front-desk manager keeps it open for hours next to other software, under office fluorescents, and reads it in glances between check-ins. Black canvas, zinc hairlines, near-white ink, and a single acid-lime signal that means *act here* or *this worked* and nothing else.

Density is a feature. Screens show the whole decision at once — the queue and the refusals, the form and the exact prompt text it compiles to — so nobody has to trust a summary. Hierarchy comes from weight, size and spacing, not from colour or ornament. Headlines are heavy, uppercase and short; everything a person has to read carefully is sentence case at a comfortable body size.

This system rejects what PRODUCT.md rejects: a consumer product or a marketing site; hero sections, bento grids, marquees, GSAP-style choreography and picsum placeholder photography; SaaS onboarding wizards that celebrate with confetti and "You're all set!"; spinners that end in "Connected!" when nothing connected; gradient text, glass cards, identical icon-card grids and tiny tracked eyebrows over every section.

**Key Characteristics:**
- Black canvas (#000000) with zinc hairline structure (#27272a), no shadows.
- One signal colour, lime (#d6ff3d), rationed to primary actions and win states.
- Heavy uppercase headlines; sentence-case labels and prose.
- Machine-written text (compiled prompts, raw values, ids) set in Geist Mono; human-written text in Geist.
- Every state carries a word, not just a colour.
- Motion only reports state, and never on something a keystroke or a Tab changes.

## 2. Colors

A restrained, near-monochrome palette where colour is a status, never a decoration.

### Primary
- **Signal Lime** (#d6ff3d): the primary action on a screen ("Call now", "Save gym") and the win state (a renewal, a passing guard, a completed stage). Hover deepens to #c2eb2b. Text on lime is always black.

### Neutral
- **Canvas Black** (#000000): the page. Also the ground inside prompt blocks, so compiled text reads as a cut-out into the page rather than a card on it.
- **Surface** (#09090b): panels and inputs, usually at 40–60% over the canvas.
- **Surface Raised** (#18181b): selected segments, hover fills, the quiet track of a progress bar.
- **Hairline** (#27272a): every border that defines structure — panels, inputs, table frames.
- **Hairline Quiet** (#18181b): dividers inside a panel.
- **Ink** (#fafafa): headlines, values the user typed, figures.
- **Ink Body** (#d4d4d8): prose and compiled prompt text.
- **Ink Secondary** (#a1a1aa): help text, the "when blank" consequence line, captions.
- **Ink Muted** (#71717a): 4.4:1 on canvas, which passes only as WCAG large text — 24px regular or 18.67px bold. Never for labels, tags, links, placeholders or sentences.
- **Control Edge** (#71717a): the 1px border of a form control. Panels keep the 1.4:1 Hairline; a control's boundary has to reach 3:1 so an empty field can be found on a black page.

### Status
- **Caution Amber** (#fcd34d on a 30% amber-950 wash, #92400e edge): something the operator must look at — a suspect extracted value, a notice that config came from the seed, a field with no supporting quote.
- **Fault Red** (#fca5a5 on a 40% red-950 wash, #b91c1c edge): something failed or is invalid — a validation error, a stage that errored, a rejected file.
- **Info Cyan** (#67e8f9): a neutral fact with its own category (reengagement, a callback). Used sparingly.

### Named Rules
**The Rationed Signal Rule.** Lime appears on at most one action per view and on win states. It is never a heading colour, a border decoration or a background wash for emphasis.

**The Word-Beside-Colour Rule.** No state is carried by colour alone. Amber is always paired with "Check this", red with what failed, lime with what succeeded.

**The Readable Grey Rule.** Sentences, labels, tags and placeholders use Ink Body or Ink Secondary. Zinc-500 (#71717a) and zinc-600 (#52525b) are prohibited for small text on canvas: at 4.4:1 and 2.9:1 they fail WCAG AA.

**The Token Rule.** Lime is `signal` / `signal-hover` in app/globals.css (`bg-signal`, `outline-signal`), never a hex in a component.

## 3. Typography

**Display Font:** none — one family carries everything.
**Body Font:** Geist (with ui-sans-serif, system-ui, sans-serif)
**Label/Mono Font:** Geist Mono (with ui-monospace, SFMono-Regular, monospace)

**Character:** A neutral grotesque that stays legible at 12–14px on a busy screen, paired with its own monospace for anything a machine wrote. The mono is a signal of provenance: it says "this is the literal text, not a description of it".

### Hierarchy
- **Headline** (900, 1.875rem, 1.2, uppercase, -0.025em): one per page, the page's job in two to four words ("Set up a gym").
- **Title** (900, 1.125rem, 1.4, uppercase, -0.025em): section heads within a page ("What Charlie hears").
- **Label** (600, 0.875rem, 1.4, sentence case): form labels, button text, table headers.
- **Body** (400, 0.875rem, 1.625): explanations and help text, capped at 70ch.
- **Caption** (400, 0.75rem, 1.5): the consequence of a blank field, provenance quotes' attribution, secondary metadata.
- **Prompt** (Geist Mono 400, 0.8125rem, 1.65): compiled incentives blocks, raw values, ids and file names.

### Named Rules
**The Sentence-Case Work Rule.** Uppercase belongs to headlines and titles only. Labels, buttons, help text and errors are sentence case, because people read them rather than scan them.

**The Mono Means Literal Rule.** If text is shown in Geist Mono, it must be byte-for-byte what a machine produced or received. Never set explanatory copy in mono for flavour.

## 4. Elevation

Flat. Depth comes from tonal layering — canvas, then surface at partial opacity, then raised surface for selection — and from hairline borders. There are no shadows anywhere in the system, including dropdowns and focus states; focus is an outline, not a glow.

### Named Rules
**The No-Shadow Rule.** If an element seems to need a shadow to stand out, it needs a border or a tonal step instead.

## 5. Components

Every interactive component ships with default, hover, focus-visible, active, disabled, loading and error states.

### Buttons
- **Shape:** gently rounded (8px).
- **Primary:** Signal Lime ground, black label text, 8px × 14px padding, weight 600. One per view.
- **Hover / Focus:** hover deepens to #c2eb2b over 150 ms. Focus-visible draws a 2px lime outline offset 2px. Active nudges scale to 0.98. Disabled drops to 40% opacity with `cursor: not-allowed` and keeps its label.
- **Secondary:** transparent on canvas, 1px Hairline border, Ink Body label; hover lifts the border to #3f3f46 and the label to Ink.
- **Quiet (text) buttons:** Ink Secondary label, no border; hover to Ink. For "Clear", "Use this value", "Remove".

### Segmented choice
- **Style:** a single bordered row of segments (8px outer radius, zinc-600 edge) for tri-state booleans — Yes / No / Not stated — and short enums. The selected segment carries three cues, because a fill alone is 1.4:1: Surface Raised fill, a 1px inset zinc-300 ring, semibold Ink text, and a white leading dot. The blank segment reads "Not stated", never an empty pill.
- **State:** keyboard arrows move within the group (native radios underneath); focus-visible outlines the group.

### Cards / Containers
- **Corner Style:** 16px for page-level panels, 12px for nested blocks. Never a card inside a card — a nested region is a prompt block or a divided list, not another panel.
- **Background:** Surface at 40% over canvas.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px Hairline.
- **Internal Padding:** 20px.

### Inputs / Fields
- **Style:** Surface ground, 1px Control Edge border, 8px radius, 8px × 12px padding, Body type. A placeholder is an example prefixed "e.g.", in Ink Secondary, never the label, never a number (a grey "20" reads as a discount already set), and never a value a real configured gym uses.
- **Focus:** border turns Signal Lime and a 2px lime outline appears, instantly. Controls carry no colour transition: focus arrives by Tab dozens of times a form, and a transitioned outline fades in from white.
- **Error:** border Fault Red edge; the message sits directly under the field in Fault Red, starts with what is wrong and says how to fix it, and is linked via `aria-describedby`.
- **Blank consequence:** every optional field has a Caption line in Ink Secondary stating what the agent does when it is left blank. It is information, not a warning, and is never amber.
- **Disabled:** 40% opacity, value still legible.

### Navigation
- **Style:** the sticky top bar: black at 90% with a Hairline bottom border, the product name in 900 uppercase beside a lime dot, links in Label type. Active link: Surface Raised fill with lime text; inactive: Ink Secondary, hovering to Ink Body.

### Prompt block (signature component)
The literal text an agent receives. Canvas-black ground inset in its panel, 1px Hairline Quiet border, 12px radius, Prompt type in Ink Body, wrapped, never truncated. Sentences stay in their compiled order. Headed by a Label naming the variable (`{{incentives}}` in mono) and the call type. When a field change rewrites the text, the words swap instantly and are never faded or remounted, because a price or a name rewrites them on every keystroke. The block's border marks the rewrite instead: it lights to Control Edge at once, holds 250 ms and fades back over 600 ms. It is a transition, not a keyframe, so continued typing keeps it lit rather than flickering. The first render is not marked.

### Provenance quote
The sentence from an uploaded document that a prefilled value came from. Sits under its field as a Caption-sized quotation in Ink Body with a Hairline Quiet rule on the left edge drawn as a full 1px border of a padded block — not a coloured side stripe. A field whose value had no supporting sentence shows the amber "Check this" state instead and is not prefilled.

### Stage progress
Four named stages in a row — Upload, Read, Extract, Check — each with a status word (Waiting, Working, Done, Failed) and, when known, a fact ("12 pages", "3,214 characters", "7 of 11 fields found"). Only real transitions advance it; the upload stage alone may show a byte-accurate bar. A failed stage turns Fault Red with its message and stops the row.
- **Track:** every stage has a 4px track from the start, so a stage finishing never changes the row's height. Waiting is empty; done is a solid Ink Body fill. Working is a one-third sweep, 1.4 s ease-in-out on a loop; it leaves the edge slowly, so a stage that finishes in 200 ms never flashes it. The upload bar follows bytes sent with a 100 ms linear transition, because an eased one restarts on every ~50 ms progress event and pulses.
- **Reduced motion:** the sweep stops travelling. A full-width track pulses between 25% and 70% opacity, never as bright as a finished stage's fill.

## 6. Do's and Don'ts

### Do:
- **Do** use one word per state: "Not stated" for an answer left empty, "Not in {file}" for something a document doesn't say, "Check this" for a value that needs a person to look at it.
- **Do** put technical detail — environment variables, migration files — under a "For your admin" disclosure beneath the plain sentence a front-desk manager can act on.
- **Do** show the exact compiled prompt text next to the form that produces it, in Geist Mono, updating as fields change.
- **Do** write the consequence of every blank optional field beside it ("Charlie won't mention a cheaper membership").
- **Do** give every state a word as well as a colour: "Done", "Failed", "Check this", "Not stated".
- **Do** keep sentences in Ink Body (#d4d4d8) or Ink Secondary (#a1a1aa) — 4.5:1 or better on black.
- **Do** use a 2px Signal Lime focus outline, offset 2px, on every interactive control.
- **Do** keep pointer feedback (hover, press) to 150 ms ease-out on named properties, never `transition-colors` on anything with a focus outline. Under `prefers-reduced-motion`, remove travel and keep only opacity or colour changes that carry state.
- **Do** label unbuilt integrations "Not built" in plain text, with what building them would need.

### Don't:
- **Don't** build a consumer product or a marketing site: no hero sections, no bento grids, no marquees, no GSAP-style choreography, no picsum.photos placeholders.
- **Don't** celebrate: no confetti, no illustrations, no "You're all set!" states. Say what was saved.
- **Don't** show a spinner that ends in "Connected!" when nothing connected, or a timed progress animation standing in for real stages.
- **Don't** use gradient text, glassmorphism, identical icon-card grids, or tiny uppercase tracked eyebrows over every section.
- **Don't** use a coloured `border-left` or `border-right` wider than 1px as an accent stripe on callouts, quotes or list items.
- **Don't** use lime for decoration, headings or more than one action per view.
- **Don't** set text in zinc-600 (#52525b) on black.
- **Don't** add shadows; use a border or a tonal step.
- **Don't** open a modal where an inline section would do.
