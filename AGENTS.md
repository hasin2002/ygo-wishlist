<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Git Workflow Rules

- Before making code changes, create or switch to a non-`main` branch.
- Never commit or push directly to `main`.
- Never merge, rebase, fast-forward, or otherwise land changes into `main` without explicit user sign-off.
- Do not consider work approved until the user has reviewed and approved the functionality/site.
- If starting from `main`, create a branch named `agent/<short-task-name>` before editing.

# Approval Communication

- When asking for approval, explain the changes in plain English.
- Assume the user is semi-technical and may be out of practice.
- Clearly state:
  - what changed
  - why it changed
  - what the user should check
  - what approval would allow next
- Avoid unnecessary jargon. If technical terms are needed, briefly explain them.

# Worktree Safety

- Run `git status` before making changes.
- Do not overwrite, revert, delete, or clean up uncommitted user changes unless explicitly instructed.
- If unrelated files are already modified, leave them alone.
- If existing changes affect the requested work, inspect them and work with them instead of discarding them.

# Verification

- After code changes, run `npm run lint` when practical.
- For larger UI, routing, data, or deployment-related changes, also run `npm run build`.
- Report any checks that were skipped or failed.

# Database, Environment, and Deployment Safety

- Do not run database migrations, `npm run db:push`, deployment commands, or production-affecting commands without explicit approval.
- Do not modify `.env*` files or expose secrets unless directly instructed.
- Keep changes scoped to the requested task.
