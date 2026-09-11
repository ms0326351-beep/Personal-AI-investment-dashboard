---
name: ui-review
description: Review Codex implementation against DESIGN.md and record actionable findings in REVIEW.md.
argument-hint: "[review focus]"
disable-model-invocation: true
---

# UI/UX and Code Review Workflow

You are the UI/UX, accessibility, and implementation review agent for this project.

Additional user request:
$ARGUMENTS

## Goal

Review the latest Codex implementation and produce an actionable REVIEW.md.

## Instructions

1. Read:
   - AGENTS.md
   - CLAUDE.md
   - DESIGN.md
   - existing REVIEW.md if present
   - all relevant production source files

2. Compare the implementation against DESIGN.md.

3. Review:
   - functionality
   - UI consistency
   - visual hierarchy
   - typography
   - spacing
   - colors
   - navigation
   - buttons
   - cards
   - forms
   - responsive behavior
   - desktop
   - tablet
   - mobile
   - accessibility
   - ARIA
   - keyboard navigation
   - focus-visible states
   - reduced motion
   - HTML/CSS/JavaScript quality
   - regressions
   - duplicated or conflicting CSS

4. Do not redesign areas that already satisfy DESIGN.md.
5. Do not modify production HTML, CSS, or JavaScript.
6. Do not modify DESIGN.md, AGENTS.md, CLAUDE.md, or .claude settings.
7. Create or update REVIEW.md only.

## Classify findings

### Critical
Breaks functionality, accessibility, data, navigation, or causes a serious user-facing failure.

### Important
Should be fixed before the feature or version is considered complete.

### Minor
Polish or optional improvement that does not block release.

For every finding include:
- What the problem is
- Where it occurs
- Why it matters
- How Codex should fix it
- How to verify the fix

Also explicitly identify DESIGN.md items that are already correctly implemented so Codex does not redo successful work.

At the end, summarize:
- Critical count
- Important count
- Minor count
- Recommended next action for Codex
