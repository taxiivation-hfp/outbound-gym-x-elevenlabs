# Product

## Register

product

## Users

The owner-operator or front-desk manager of a small gym: one or two sites, 300 to 1,500 members, one person on the desk per shift, no retention team and no CRM beyond what the gym-management platform ships with. They use Retention Router on a desktop screen next to the booking system, between check-ins, usually with interruptions. They are not technical and have no reason to trust software that calls their members.

Two jobs happen here:

- **Daily:** see who is due a call today, who is deliberately never called and why, press "Call now", and read what the call found out.
- **Once per gym (onboarding):** tell the system what the gym is allowed to offer and what it can say about itself — by filling in a questionnaire, or by uploading the price list or membership agreement they already have and checking what was read out of it — then connect member data by CSV export.

## Product Purpose

An outbound voice agent that calls the gym members worth calling (renewal reminders, reengagement, winback) and structurally refuses to call the members a call would cost — anyone on an auto-renewing contract. Every decision, including every refusal, comes back as a sentence a front-desk manager can read and argue with.

Onboarding exists so a gym gets from nothing to a working agent without anyone editing a JSON file, and without anything a customer supplied becoming an instruction the agent follows. The gym supplies typed values; the app writes every sentence the agent hears. Success is a gym owner who can see, before saving, exactly what Charlie will and will not put on the table — including what he will say when a field was left blank.

## Brand Personality

Plain, exact, accountable. The interface talks like a careful colleague who shows their working: it states what it knows, says so when it doesn't, and never claims something worked when it didn't. Calm under interruption; nothing competes for attention with the one decision on screen.

## Anti-references

- A consumer product or a marketing site. No hero sections, no bento grids, no marquees, no GSAP-style choreography, no picsum placeholder photography.
- SaaS onboarding wizards that celebrate progress with confetti, illustrations and "You're all set!" states.
- Spinners that end in "Connected!" when nothing connected. A placeholder that claims to have worked is worse than no feature.
- Churn-prediction dashboards that hand a manager a score they cannot interrogate.
- Decoration standing in for information: gradient text, glass cards, identical icon-card grids, tiny tracked eyebrows over every section.

## Design Principles

1. **Show the working.** Every value the system acts on is visible with its source: the rule behind a routing decision, the sentence from the document behind a prefilled field, the exact prompt text a config compiles to.
2. **Blank is an answer.** An empty field is shown as a valid choice with its consequence spelled out ("Charlie says he doesn't have that in front of him"), never styled as an error to be filled in.
3. **Nothing fakes success.** Progress reflects real stages; unbuilt integrations say "not built"; failures say what failed and what to do next.
4. **Legibility over impact, density over drama.** A manager should be able to read the whole screen once, in order, and act. Restraint is the default; emphasis is rationed for the thing that matters.
5. **One vocabulary everywhere.** The questionnaire, the dashboard and the evals page share components, colors and wording, so trust built on one screen carries to the next.

## Accessibility & Inclusion

WCAG 2.2 AA. Body and secondary text at 4.5:1 or better against its surface; every interactive control keyboard-operable with a visible focus indicator; form errors announced and tied to their fields; status and progress changes announced to assistive technology; no information carried by color alone (every state also has a word); reduced-motion preference honoured for every transition.
