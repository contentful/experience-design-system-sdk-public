# A CI check keeps the docs aligned with the code

## Status

Proposed. Phase 1 is implemented. Phases 2 and 3 need decisions (see Open questions).

## Context

The CLI is documented in this repo and, for people who install it, in the public
Contentful docs (`contentful/contentful-docs`). The two sets of docs drifted from
the CLI more than once. Each case was found by hand:

- commands that do not exist (`setup`, `doctor`, `apply`);
- flags that are not options of `import` (`--project`, `--tokens`, `--no-cache`);
- a framework listed as "coming soon" after it shipped;
- a stage list that left out a stage;
- a count of supported agents that was out of date.

Nothing in CI looked at the docs, so a change to the CLI could merge with the docs
wrong, and the first sign was a customer following a step that did not work.

## Decision

Add a check that reads facts from the code and tells the author where the docs
disagree. Build it in phases, so each phase can be reviewed on its own.

1. **Read-only check (done).** `scripts/docs-alignment/check.py` reads the
   registered commands and options, the supported agents, the import stages, the
   home menu, the supported frameworks and file types, the log retention and the
   Node version from the source. It checks the repo docs, and the public docs when
   it can read them. It also warns when a PR changes code that usually needs a doc
   update and changes no doc. A workflow runs it on PRs to `main` and `development`.
   Drift is a warning. A repository variable turns it into a failure.
2. **Fix the repo docs automatically.** For drift the script can describe exactly
   (a missing item in a list, a command that does not exist), commit the fix to the
   PR branch.
3. **Open a linked PR in `contentful-docs`.** For drift in the public docs, open a
   draft PR there and link the two PRs. It merges only after the CLI release ships.

A skill (`.claude/skills/docs-alignment/SKILL.md`) records how to do the same by hand.

## Consequences

- Facts are read with patterns, not by importing the code, so the check needs no
  build and runs in seconds. If the code is reshaped, the check says which fact it
  could not read and exits with an error, instead of passing silently.
- The check can only judge facts it knows about. Prose is not checked. Each new
  fact that matters needs a rule.
- The script is Python with the standard library only, because CI runners have it
  and it needs no install step.
- Reading the public docs needs a token with read access to `contentful-docs`.
  Without it, the public-docs half of the check is skipped and says so.

## Open questions

- **Phase 2:** Is it acceptable for a bot to push commits to PR branches? On `main`,
  PRs are release PRs from `development`, and the release job ignores bot commits.
- **Phase 3:** Who provisions a GitHub App or token with write access to
  `contentful-docs`, and who reviews the docs PRs?
- **AI in CI:** Rewriting prose, not just lists, needs an AI agent in CI. That needs
  an API key and a review of how untrusted PR contents reach the agent.
- **Strict mode:** When should drift start to fail the job?
