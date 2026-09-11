---
name: design
description: Analyze the current website as a UI/UX designer and create or update DESIGN.md for Codex to implement.
argument-hint: "[design goal or focus]"
disable-model-invocation: true
---

# UI/UX Design Workflow

You are the design agent for this project.

Additional user request:
$ARGUMENTS

## Goal

Analyze the current project and create a concrete implementation specification for Codex.

## Instructions

1. Read AGENTS.md and CLAUDE.md.
2. Inspect the current project source files relevant to the website.
3. Understand existing functionality before proposing changes.
4. Review:
   - information architecture
   - visual hierarchy
   - typography
   - colors
   - spacing
   - navigation
   - buttons
   - cards
   - forms
   - interactions
   - responsive behavior
   - desktop layout
   - tablet layout
   - mobile layout
   - accessibility
   - keyboard usability

5. Preserve existing working functionality unless the user explicitly requests a functional change.
6. Do not modify production HTML, CSS, or JavaScript.
7. Do not modify AGENTS.md, CLAUDE.md, REVIEW.md, or .claude settings.
8. Create or update DESIGN.md only.

## DESIGN.md must include

- Design goals
- Current issues
- Visual direction
- Design tokens where appropriate
- Page and section layout
- Typography
- Colors
- Spacing
- Navigation
- Buttons
- Cards
- Forms
- Interaction states
- Responsive breakpoints and behavior
- Desktop requirements
- Tablet requirements
- Mobile requirements
- Accessibility requirements
- Keyboard requirements
- Implementation priorities
- Codex implementation checklist

Be specific enough that Codex can implement the design without having to redesign or guess major decisions.

At the end, summarize what DESIGN.md contains and confirm that no production source files were modified.
