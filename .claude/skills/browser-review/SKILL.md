---
name: browser-review
description: Perform live browser QA of the current website and append a Live Browser Verification section to REVIEW.md.
argument-hint: "[URL or testing focus]"
disable-model-invocation: true
---

# Live Browser Verification Workflow

You are the live browser QA and UI/UX verification agent for this project.

Additional user request:
$ARGUMENTS

## Goal

Verify the actual running website in the connected browser rather than relying only on source-code inspection.

## Before testing

1. Read:
   - DESIGN.md
   - REVIEW.md
   - relevant source files

2. Use the connected browser tools.
3. If no URL was supplied, use the current local development URL when it is clearly available.
4. Do not modify production HTML, CSS, or JavaScript.
5. Do not modify DESIGN.md, AGENTS.md, CLAUDE.md, or .claude settings.

## Live tests

Verify as many of these as applicable:

- Page loads successfully
- Desktop layout
- Tablet layout around 768px
- Mobile layout around 375px
- Navigation
- Mobile navigation
- Buttons
- Links
- Forms
- Tabs
- Dialogs / Modals
- Toasts
- Mouse interactions
- Keyboard navigation
- Arrow keys
- Home / End
- Enter / Space
- Escape
- Focus-visible states
- ARIA state changes
- Text overflow or clipping
- Horizontal overflow
- Responsive layout
- Reduced Motion where testable
- Console errors and warnings
- Failed resources
- Regressions against existing functionality
- Visual consistency with DESIGN.md

## Tool limitations

If a browser operation is unsupported or does not respond within a reasonable time:
- Do not retry indefinitely.
- Record it as a browser-tool limitation.
- Use a reasonable alternative verification method when possible.
- Clearly distinguish a tool limitation from a website defect.

## REVIEW.md output

Preserve existing review history.

Append or update a section named:

# Live Browser Verification

Include:

- Environment / URL tested
- Desktop result
- Tablet result
- Mobile result
- Interaction result
- Keyboard result
- Accessibility result
- Console result
- Newly discovered issues
- Browser-tool limitations

Classify new issues as:
- Critical
- Important
- Minor

Finish with exactly one verdict:

Live browser verdict: PASS

or

Live browser verdict: PASS WITH MINOR NOTES

or

Live browser verdict: FAIL

Do not modify source code during this workflow.
