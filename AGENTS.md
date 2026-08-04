<!-- BEGIN:nextjs-agent-rules -->
# Next.js version awareness

When changing Next.js APIs, routing, configuration, or conventions, read the relevant guide in `node_modules/next/dist/docs/` first and heed deprecation notices. Do not read Next.js documentation for unrelated work.
<!-- END:nextjs-agent-rules -->

# Records UI and Copy Semantics

- Extend the nearest existing Records form, control, or dialog before introducing a new visual pattern. `src/components/records/entry-form-ui.tsx` and the Inventory filter dialog are the reference implementations for Records forms and dialogs.
- When a user supplies an in-app UI reference, match its hierarchy, placement, dimensions, and interaction model—not just its colours.
- A `Copy` is one exact physical instance of a Card Printing. Grouped UI may summarise several Copies, but every selection, photo source, listing member, and fulfilment action must retain the exact Copy ID.
- Inventory photos belong to physical Copies. When a grouped selection contains several Copies, aggregate the photos from every selected Copy; never decide availability from only the first Copy.

# Dialog Placement and Behaviour

- Render viewport-level dialogs through a React portal to `document.body`. Do not mount them beneath an ancestor using `transform`, `filter`, `perspective`, or a retained transform animation: those properties can capture `position: fixed` descendants and break viewport positioning or z-index.
- A Records dialog must cover the complete viewport, use a bounded and internally scrollable panel, work with keyboard focus, close with Escape and a backdrop click where appropriate, restore focus to its trigger, and lock background scrolling.

# Execution Model and Task Boundaries

- Work on one GitHub issue or coherent implementation task at a time. Do not dispatch or implement multiple issues in parallel.
- Keep the main task accountable for scoping, planning, final decisions, integration, validation judgment, user communication, and Git operations.
- Handle genuinely small, isolated changes directly. For substantial implementation after scope and acceptance criteria are fixed, the main task may delegate one bounded implementation assignment to one sub-agent.
- Do not start a second implementation sub-agent, automatically refill work, or begin another issue in the same task. Model and reasoning selection for delegated GitHub work belongs in the dispatch skill.
- Recommend a fresh Codex task after an issue reaches review, PR, merge, or completion, or when the next request changes scope. Briefly explain that a fresh task avoids carrying stale context and unnecessary usage.
- Before recommending a fresh task, provide a compact handoff with the issue, branch or worktree, completed work, remaining work, important decisions, and checks already run. Do not interrupt active edits or validation merely to change tasks.

# Git Workspace Ownership

- Before editing, inspect `pwd`, `git status --short --branch`, and `git worktree list`.
- One implementation task owns one focused `agent/<short-task-name>` branch or worktree. Never implement directly on `main`.
- Use the current clean checkout by default. Create a worktree only when another active task requires a different branch, the current checkout is dirty or already owned, or the user explicitly requests one.
- Never edit, switch, repurpose, or remove another task's worktree. If checkout ownership is unclear, stop and ask before changing files.

# Git Workflow Rules

- Never commit or push directly to `main`.
- Never merge, rebase, fast-forward, or otherwise land changes into `main` without explicit user sign-off.
- Do not consider work approved until the user has reviewed and approved the functionality/site.
- Keep each branch focused on its associated task or approved GitHub issue.
- Do not move uncommitted changes between branches or worktrees unless the user explicitly requests it.

# Significant Change Planning Workflow

- Treat work as significant when it affects multiple features or layers, changes architecture or data models, introduces migrations or new dependencies, touches authentication/authorization, integrates external services, or otherwise has meaningful regression or deployment risk.
- Use `$plan-significant-change` for the detailed planning workflow before implementation. Do not force it onto small, isolated, low-risk fixes.
- Create a GitHub issue only when the user requests one or when approved multi-session work needs a durable source of truth.
- Implementation requires approval of the agreed scope. Database changes, production actions, deployment, and merging into `main` remain separately explicit.

# GitHub Access

- Prefer the connected GitHub app for issue and pull-request operations when available.
- If a GitHub CLI or Git authentication check fails in a restricted environment, retry it once with normal keychain and network access before diagnosing an authentication problem.
- Never expose tokens or request re-authentication unless the normal-access check also fails.

# Existing Change Safety

- Do not overwrite, revert, delete, or clean up uncommitted user changes unless explicitly instructed.
- If unrelated files are already modified, leave them alone.
- If existing changes affect the requested work, inspect them and work with them instead of discarding them.

# Verification

- Run the smallest relevant checks once after implementation. Prefer focused tests for the changed behaviour and run `npm run lint` for code changes when practical.
- Run `npm run build` when the change affects routing, build configuration, schema or generated boundaries, deployment behaviour, or broad integration, or when the user requests it. Do not run a production build for every routine UI change.
- Use browser or manual QA only for the changed user flow and concrete regression risks.
- Report any checks that were skipped or failed.

# Dev Server Cleanup

- If you start a dev server for testing or any other reason, stop it completely when you are done using it.
- Before finishing, make sure any server process you started has been killed and is no longer running.
- Follow `README.md` for local environment, worktree dependency, authentication-host, ngrok, eBay, and deployment guidance. Do not duplicate or improvise environment instructions in task prompts.
- Stop any tunnel you started when testing ends. Do not expose a local server longer than needed.

# Database, Environment, and Deployment Safety

- `npm run db:push` is pre-authorized for development database changes. Run it as part of implementation and verification without requesting separate approval.
- This local-development permission does not authorize staging or production database changes, other migration commands, deployment commands, or production-affecting actions.
- Do not modify `.env*` files or expose secrets unless directly instructed.
- Keep changes scoped to the requested task.

# eBay Listing Test Safety

- Never create, verify, or publish an auction-style eBay listing for testing. Test listings must always use the fixed-price, Good 'Til Cancelled format.
- Before publishing any test listing to the live eBay marketplace, verify that eBay reports no upfront listing or optional-upgrade fee. Refuse publication when any non-zero upfront fee is reported.

# eBay Media Boundaries

- Keep inventory-photo discovery and local listing-photo staging independent of eBay authorization. Require eBay credentials only for eBay operations such as upload, validation, or publication.
- Preserve and surface the real eBay authorization failure with a reconnect action; do not misreport saved inventory photos as unavailable when the external upload is the failing step.
