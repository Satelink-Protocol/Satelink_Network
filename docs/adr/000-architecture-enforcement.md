# ADR-000: Architecture Enforcement by Lint Rule

**Status:** Accepted
**Date:** 2026-08-01
**Milestone:** M0

## Context

The approved blueprint specifies a layered architecture: a pure domain layer
(`libs/`) with no I/O, aggregates that reference each other only by identifier,
two bounded contexts that never import each other, and dependency inversion
between application and infrastructure.

Architectural rules stated in documentation erode. Not through malice — through
a deadline, an autocomplete import, or an agent making a locally reasonable
choice. By the time erosion is noticed, unwinding it is expensive.

Two options were considered.

**Separate npm packages per layer.** Module boundaries enforce themselves
because a package cannot import what it does not depend on. Costs: twelve
`package.json` files, twelve build configs, version coordination on every
change, and meaningful friction for a solo operator.

**Lint-rule enforcement.** Two packages, layering enforced by
`dependency-cruiser` in CI. Costs: rules can be disabled; enforcement is
advisory unless CI blocks merges.

## Decision

Lint-rule enforcement, with three conditions that make it real rather than
advisory:

1. **Every structural rule is `severity: error`.** Warnings are ignored.
2. **The rules are themselves tested.** `tools/architecture-tests/guard.test.ts`
   writes violating fixtures, cruises them with the production config, and
   asserts the expected rule fires. If a rule is deleted or weakened, that test
   fails.
3. **Package count stays low.** Two domain packages, not twelve. The friction
   saved is real, and the enforcement is equivalent once CI blocks.

## Consequences

**Positive.** Layering is checked on every commit, in seconds. Rules are
readable in one file with the reasoning attached. Adding a rule is a
one-line change rather than a repository restructure.

**Negative.** A determined contributor can add an `eslint-disable`-equivalent
exception. Mitigated by the guard tests and by the config living in a
reviewed file.

**Deferred.** If the domain later needs to be published or consumed
externally, package extraction remains possible. The directory boundaries were
drawn so extraction is mechanical.

## The rule that matters most

`domain-no-io-packages` and `domain-no-node-core` together make
`libs/` unable to import a database driver, an HTTP client, or a node builtin.

This is what guarantees domain tests need no mocks. A domain test requiring a
mock is a signal that logic sits in the wrong layer — and with these rules, that
signal arrives at CI rather than six months later.

## Verification

The exit gate for M0 is a live tripwire, documented in
`docs/M0_VERIFICATION.md` and automated in the guard tests. It must be run
manually once, at M0, so that a human has personally watched the guard fail.
