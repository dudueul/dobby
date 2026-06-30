# Coding guideline (non-negotiable)

This is the governing coding guideline for this repository. Agents and
contributors follow it. Reviewers refuse changes that violate it. Sections A–D
below are canonical; the "Applied to dobby" section maps them onto this repo's
stack (Python services, a TypeScript BFF+PWA, YAML configs).

---

## A. Design principles (non-negotiable)

### A.1 Deep modules, narrow seams
A module's value is `useful_functionality / interface_surface`. Push it up by
hiding more behind a smaller interface, not by adding more files.

- Prefer one function that resolves a complete capability over a chain of
  micro-helpers. Example: `requireSession(request, env)` returns a fully
  resolved `SessionUser` (with permissions, scopes, contact, audit context). Do
  not export `parseSessionCookie`, `loadSession`, `loadUser`, `loadPermissions`,
  `resolveScopes` separately.
- Internal complexity is fine; surface complexity is not. Long files with one
  well-named export beat short files with many.
- Information hiding is the goal. Callers should not need to know about
  pagination cursors, retry policies, transaction boundaries, or which Durable
  Object they are talking to.
- Refuse during review: files <40 LOC that only re-export, classes whose methods
  are 1:1 wrappers around other modules, `manager`/`helper`/`util` suffixes that
  hide vague responsibilities, deep import chains where every layer just forwards.

### A.2 Smallest logical test scope per assertion
- One test asserts one fact. If the failure message can't fit in a single
  sentence, the test is too big.
- Test names read as English sentences in `subject_verb_condition` form, e.g.
  `requireSession_rejectsExpiredCookie`,
  `billingCascade_picksClosestAncestor_whenGroupAndProgramBothPay`.
- Pick the smallest seam that exposes the behavior under test, not the smallest
  file. For a deep module, the public function is often the right seam — do not
  break encapsulation just to write smaller tests.
- Tests are independent. No shared mutable state across tests; every test sets up
  its own fixture and tears it down. Flake = bug.
- Property-based tests state the invariant in one sentence, e.g. `forall ancestor
  in scope chain, the closer ancestor always wins`. The framework generates the
  cases.

### A.3 Design for testability from line one
- Pure domain core. `packages/domain` holds zero-effect functions over plain
  data. Scope walker, permission resolver, billing cascade, ACH surcharge, audit
  redaction, state-machine transitions all live here. They take inputs, return
  outputs, never touch I/O.
- Effects at the edges. DB, fetch, env, time, randomness all enter through narrow
  ports. In this codebase, those ports are Effect `Layer`s + `Context.Tag`s in
  `packages/effect-runtime`.
- Inject, don't import. Server functions receive their ports through the
  per-request runtime built once at the seam. Never reach for a global.
- No conditional imports for test mode. If you can't test it without
  `if (NODE_ENV === 'test')`, the design is wrong.
- Every public function is reachable from a test in <2 lines of setup. If it
  takes more, the seam is wrong.

These three principles compound: deep modules give us few seams; the few seams
are pure or near-pure; the few seams are trivial to test at the smallest scope.

## B. The slice contract

Every change lands as an approved slice. A slice is the smallest atomic unit of
behavior change — typically ≤100 LOC of production code (excluding tests,
fixtures, generated files, lockfiles). Before any code is written, the agent
posts the contract below. The user reviews and explicitly approves. Then `/tdd`
runs red → green → refactor on the listed tests, and a single commit lands.

```
Slice <id>: <verb-phrase headline>

WHY        one sentence (problem solved or capability added)
SCOPE      files touched (paths), public API delta (new/changed exports)
DEPTH      interface surface (count of exported names) and what they hide
           — refuse the slice if interface_surface > 3 for non-aggregate modules
TESTS      every applicable test type (see docs/testing/catalog.md) with
           target file paths, one assertion per test, English-sentence names
GATES      which tests must be green before merge (default: all listed)
NON-GOAL   explicit out-of-scope items so the slice doesn't sprawl
COMMIT     single conventional-commit message; NO Claude signature
```

Rules:

- No follow-up commits silently extend the slice. New behavior = new slice.
- One slice = one PR = one commit. Squash-merge disabled. Linear history on `main`.
- Soft cap. ≤100 functional LOC of production code. "Functional LOC" means
  non-blank, non-comment lines, measured by `cloc`. The cap is for production code
  only — tests, fixtures, generated files, and lockfiles do not count. Slices that
  exceed 100 must either justify in the commit body (a `Soft-cap note:` line citing
  the functional count and the reason a split would harm narrative atomicity) or
  split into multiple slices.
- Aggregate modules (e.g. a permission catalog literal that re-exports many
  constants) may exceed an interface-surface of 3 if they exist solely to expose a
  uniform array of names; this is the only exception to the deep-module rule.

## C. Commit narrative

The commit log is a story of how the stack accreted, not a changelog. Each commit
follows this template:

```
<type>(<scope>): <imperative summary, ≤72 chars>

Why this commit exists in the sequence: <one sentence tying to the prior commit>.
What this commit unlocks: <one sentence pointing at the next commit's prerequisite>.
Tests added:
- <test type>: <file path>
- ...
```

`<type>` is a conventional-commit type (`feat`, `fix`, `docs`, `refactor`,
`test`, `chore`, `perf`, `build`, `ci`, `revert`). `<scope>` is the bounded
context or package (`identity`, `permissions`, `billing`, `db`, `ui`,
`methodology`, …).

**Banned in commit messages:** any AI co-authorship attribution (`Co-Authored-By:
Claude`, `Co-Authored-By: GPT`, `Co-Authored-By:` lines naming Anthropic / OpenAI
/ Copilot / Cursor / Gemini / Sonnet / Opus / Haiku), the `🤖 Generated with`
footer, the `Generated with [Claude Code]` line, or any `claude.ai/code` URL.
Human co-authors via `Co-Authored-By: Name <email>` are accepted.

## D. Banned patterns

Refuse a slice if it does any of the following:

- Shallow exports. Splits a single deep capability across many small exported
  helpers (`parseX` + `loadX` + `resolveX` instead of one `requireX`).
- `util` / `helper` / `manager` files with vague responsibilities.
- `if (NODE_ENV === 'test')` branches in production code.
- Globals for ports. Reaching for `process.env`, `Date.now()`, `Math.random()`,
  `fetch`, `crypto`, the db client, or Stripe client inside a domain function. All
  of these enter through ports.
- Throw inside the domain core. Domain code returns a typed result with a tagged
  error; it never throws.
- Hand-built `Ctx` objects. Use the project's port/injection mechanism instead.
- Tests that assert on error message strings. Assert on the tagged error's `_tag`
  (or typed kind) instead.
- Tests that share mutable state between cases.
- Slices that bundle two capabilities ("introduce X and also fix Y").
- Slices that exceed 100 LOC of production code without splitting and re-approval.
- Commits with a Claude signature in any form, anywhere in the message.
- Imports from `dev-only` modules in non-dev code paths. Production bundles must
  not contain them; CI grep-asserts on the deployed bundle.

---

## Applied to dobby (stack mapping)

The canon above is written for the YOJO-cf Effect-TS stack. In this repo the same
principles bind via these equivalents:

- **Pure domain core (A.3).** Pure functions over plain data with no I/O — e.g.
  `services/archive-job/archive.py::eviction_plan` (no `psycopg`/clock imports at
  module load; effects passed in). New decision logic goes in pure functions like
  this, tested directly.
- **Effects at the edges / ports.** Python services take DB/MQTT/clock/HTTP as
  injected arguments or lazy imports, not module-level globals. The control-panel
  **BFF allow-list** (`apps/control-panel/server/config.ts`) is a deep-module
  seam: one `climate.hvac`/`lock.*` entity hides the device protocol; clients
  never speak Z-Wave/RTSP. Home Assistant is the deep module that owns devices.
- **Tests (A.2).** One assertion, sentence names — see
  `services/archive-job/test_archive.py` (`evictionPlan_evictsOldestFirst`, …).
  `pytest.ini` collects the sentence-style names.
- **Slice contract (B).** Post the contract and get approval before coding. One
  capability per PR/commit; linear history on `main`. Functional LOC measured with
  `cloc`.
- **Commit narrative + no AI signature (C).** Every commit uses the Why/What/Tests
  template and carries **no** `Co-Authored-By: Claude`, `Generated with`, or
  `claude.ai/code` line. (This has been the practice for every commit in this repo.)
- **CI gate.** `.github/workflows/ci.yml` runs the validators, the pure-planner
  tests, and the control-panel typecheck/build that back these rules.
