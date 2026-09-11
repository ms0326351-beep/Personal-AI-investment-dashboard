# Project Workflow

## Codex Role

Codex is the primary implementation agent for this project.

Responsibilities:
- Write and modify the actual website code.
- Implement requested features.
- Fix bugs.
- Refactor code when necessary.
- Maintain the existing functionality.
- Follow DESIGN.md when it exists.
- Follow REVIEW.md when fixing reviewed issues.

For UI changes:
- Read DESIGN.md before implementation.
- Implement the design requirements as accurately as possible.
- Keep desktop and mobile layouts responsive.
- Preserve existing working features unless explicitly asked to change them.

After making changes:
- Check for HTML, CSS, and JavaScript errors.
- Verify that existing functionality still works.

## Claude Role

Claude is primarily responsible for:
- UI/UX design
- Visual design recommendations
- Project analysis
- Code review
- Bug detection
- Accessibility review
- Responsive design review

Claude should normally provide design and review recommendations rather than directly modifying production source code.

## Workflow

1. Claude analyzes or designs.
2. Claude writes design requirements to DESIGN.md.
3. Codex reads DESIGN.md and implements the changes.
4. Claude reviews the completed implementation.
5. Claude writes findings to REVIEW.md.
6. Codex reads REVIEW.md and fixes the issues.

## Important

Do not allow Codex and Claude to independently redesign the same feature at the same time.

Claude defines or reviews the design.
Codex implements the final source-code changes.

## Handoff Workflow

Before implementing a new user request, check whether HANDOFF.md exists.

If HANDOFF.md exists and contains a current implementation task:
- Read HANDOFF.md before modifying source code.
- Treat HANDOFF.md as the latest agreed requirements from the Claude discussion.
- Follow its Confirmed Decisions, Functional Requirements, UI / UX Requirements, Implementation Requirements, Preserve rules, and Acceptance Criteria.
- Do not redesign decisions already settled in HANDOFF.md.

When the user says phrases such as:
- "開始做"
- "照剛剛討論的做"
- "實作剛剛的內容"
- "照 Claude 的討論做"

read HANDOFF.md and begin implementation without requiring the user to repeat the requirements.

If HANDOFF.md conflicts with an explicit instruction in the user's current Codex message, follow the user's current instruction.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
