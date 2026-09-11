---
name: handoff
description: Summarize the decisions from the current Claude discussion into HANDOFF.md so Codex can implement them directly.
argument-hint: "[optional implementation focus]"
disable-model-invocation: true
---

# Claude to Codex Handoff

You are preparing an implementation handoff for Codex.

Additional user request:
$ARGUMENTS

## Goal

Turn the current conversation and agreed decisions into a concise, implementation-ready HANDOFF.md.

## Instructions

1. Review the current conversation.
2. Identify the latest decisions that the user has actually agreed to.
3. Distinguish confirmed requirements from ideas that were only discussed.
4. Read relevant project files when necessary to understand the existing implementation.
5. Do not redesign decisions that have already been settled.
6. Do not modify production HTML, CSS, JavaScript, DESIGN.md, REVIEW.md, AGENTS.md, CLAUDE.md, or .claude settings.
7. Create or replace HANDOFF.md only.

## HANDOFF.md format

# HANDOFF

## Goal
State what Codex needs to accomplish.

## Confirmed Decisions
List the decisions agreed upon in the current Claude discussion.

## Functional Requirements
List required functionality.

## UI / UX Requirements
List relevant layout, visual, responsive, and interaction requirements.

## Files Likely Involved
List likely files Codex may need to inspect or modify.

## Implementation Requirements
Give concrete implementation instructions without writing the implementation itself.

## Preserve
List existing behavior, data, or design that must not be broken.

## Acceptance Criteria
Provide clear checks Codex can use to determine whether the implementation is complete.

## Open Questions
Only include unresolved questions that genuinely block implementation. If none, write "None."

At the end, confirm that HANDOFF.md is ready for Codex and that no production source files were modified.
