<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Concurrent Chat and Git Worktree Safety

- Assume other chats or agents may be working on this repository at the same time.
- Before changing files, run `pwd`, `git status --short --branch`, and `git worktree list` to identify the current folder, branch, and active worktrees.
- Each independent implementation task must use its own dedicated Git worktree and its own `agent/<short-task-name>` branch.
- A branch name such as `agent/search-filters` is not a worktree. The worktree is the separate checkout folder associated with that branch.
- Create task worktrees as sibling folders when practical, for example: `git worktree add ../ygo-wishlist-search-filters -b agent/search-filters main`.
- After creating a task worktree, perform all edits, tests, commits, and development-server work from that worktree only.
- Never switch branches in an existing worktree merely to start a different task. Another chat may still be using that folder.
- Never edit files in, repurpose, or remove another task's worktree.
- Before creating a worktree, inspect `git worktree list` and confirm that the intended branch and folder are not already in use.
- If the current folder has uncommitted changes, is on an unexpected branch, or cannot be clearly associated with this chat's task, stop before editing and ask the user which worktree to use.
- If creating or accessing a separate worktree is not possible, explain the limitation and ask the user for direction instead of switching branches in the shared checkout.

# Git Workflow Rules

- Never commit or push directly to `main`.
- Never merge, rebase, fast-forward, or otherwise land changes into `main` without explicit user sign-off.
- Do not consider work approved until the user has reviewed and approved the functionality/site.
- Keep each branch focused on its associated task or approved GitHub issue.
- Do not move uncommitted changes between branches or worktrees unless the user explicitly requests it.

# Significant Change Planning Workflow

- Treat work as significant when it affects multiple features or layers, changes architecture or data models, introduces migrations or new dependencies, touches authentication/authorization, integrates external services, or otherwise has meaningful regression or deployment risk.
- If an initial user message appears to request or explore a significant change, do not begin implementation immediately. Explain briefly why planning would reduce risk and offer to work through a plan first.
- Do not force the planning workflow onto small, isolated, low-risk fixes.
- During planning, inspect the relevant code and project documentation, clarify important unknowns, identify risks, and divide the work into reviewable outcomes.
- Before creating anything in GitHub, present the proposed plan to the user and wait for explicit approval to create the issue.
- Once approved, create a GitHub issue that acts as the source of truth and includes:
  - the problem and desired outcome
  - scope and explicit non-goals
  - the proposed implementation approach
  - acceptance criteria and pass conditions
  - automated tests to add or run
  - manual test steps the user can follow
  - risks, dependencies, migration concerns, and rollback notes where relevant
- Do not begin implementation merely because the issue exists. Wait until the user approves the issue and asks for implementation.
- Implement the approved issue in a new dedicated worktree and branch. Reference the issue in the branch work and later pull request.
- A new implementation chat or agent may perform the work, but the Git worktree and branch provide the isolation; spawning a subagent alone does not.
- When implementation is ready, explain what changed, what checks passed, and exactly what the user should manually test.
- Open a pull request only after the user approves the implemented behaviour. A draft pull request may be opened earlier only when the user explicitly requests it, for example to run PR-only CI checks.
- Creating or approving a pull request does not authorize merging it. Merge only after separate explicit user approval.

# Approval Communication

- When asking for approval, explain the changes in plain English.
- Assume the user is semi-technical and may be out of practice.
- Clearly state:
  - what changed
  - why it changed
  - what the user should check
  - what approval would allow next
- Avoid unnecessary jargon. If technical terms are needed, briefly explain them.

# Existing Change Safety

- Do not overwrite, revert, delete, or clean up uncommitted user changes unless explicitly instructed.
- If unrelated files are already modified, leave them alone.
- If existing changes affect the requested work, inspect them and work with them instead of discarding them.

# Verification

- After code changes, run `npm run lint` when practical.
- For larger UI, routing, data, or deployment-related changes, also run `npm run build`.
- Report any checks that were skipped or failed.

# Dev Server Cleanup

- If you start a dev server for testing or any other reason, stop it completely when you are done using it.
- Before finishing, make sure any server process you started has been killed and is no longer running.

# Database, Environment, and Deployment Safety

- Do not run database migrations, `npm run db:push`, deployment commands, or production-affecting commands without explicit approval.
- Do not modify `.env*` files or expose secrets unless directly instructed.
- Keep changes scoped to the requested task.
