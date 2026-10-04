# Maintaining Deckyard during beta

## Apply the beta doctrine at every ritual

Deckyard is in beta with a near-zero installed base (one fork, ours). The
standing direction of the current work is **tightening**: one canonical form
per concept, drift reduced, a spec/API/slide-type system that is consistent,
understandable and elegant. The canonical statement is
`docs/reference/versioning.md` § _The beta stance: purity over compatibility_.
Apply it at the recurring moments:

- **Picking up work** ("check TODO.md", "geef een prompt om verder te gaan"):
  frame the item against the course — prefer the structural fix over the
  tolerant patch, and say so in the prompt or plan you produce.
- **Reviewing a PR**: tolerance-creep is a _blocking_ finding, not a style
  nit — a second accepted shape/spelling for one meaning, an "accepts both"
  without a normalize-and-remove story, a "valid forever" promise while the
  beta badge is up. Breaking-but-clean beats compatible-but-cluttered during
  beta.
- **Writing docs**: state the normative target plus an honest
  implementation-status note; never promise eternal compatibility during beta.
- **Weighing a design**: "the code already accepts X" is never an argument —
  current behaviour describes the codebase, it does not justify the contract.
  When surfaces disagree, the inconsistency is the defect, not the precedent.
- **Meeting a form question mid-build**: decide it on the doctrine side
  (declaration over a branch on a name, one shape, refuse over silently
  repair) and state the decision in the PR body for the reviewer to test.
  "Behaviour preserved, minted as a B-number, test pins the disagreement" is
  not an option — that parks tolerance with a label on it (D92, 2026-09-09).
  Only a _product_ question (does Jaap want X at all) is parked, with an
  advice, in the terugkeer-check of `docs/plans/handoff/queue.md`.
- **Reviewing for parked tolerance**: a PR that _leaves_ an existing second
  form standing and mints a number for it is the same blocking finding as a
  PR that adds one. Decide it in the review (a D-number) or send it back.
