# CLAUDE.md - VMF-v-1-api

Codebase instructions and context for Claude Code assistance in the VMF v1 API backend.

## Working Principles

1. **Don't assume. Don't hide confusion. Surface tradeoffs.**
   - Ask for clarification when requirements are ambiguous.
   - Explicitly surface design tradeoffs and ask for direction rather than making assumptions.
   - If a decision has downsides, make them visible.

2. **Minimum code that solves the problem. Nothing speculative.**
   - Write only what the task requires.
   - Don't add abstraction layers, helper functions, or generalization for hypothetical future use.
   - No feature flags, scaffolding, or "nice-to-haves" unless explicitly requested.

3. **Touch only what you must. Clean up only your own mess.**
   - Don't refactor unrelated code while fixing a bug or adding a feature.
   - Don't rename files, reorganize imports, or improve patterns outside the scope of the current task.
   - Fix only the mess you create; leave existing technical debt alone unless it directly blocks the task.

4. **Define success criteria. Loop until verified.**
   - Before starting, clarify what "done" means for this task.
   - Run tests and verify the feature works end-to-end.
   - Don't consider it complete until all success criteria are met.

## Tech Stack

- **Runtime:** Node.js + Express.js
- **Database:** MongoDB + Mongoose ODM
- **Validation:** Zod (request boundary), Mongoose pre-hooks (persistence boundary)
- **Testing:** Jest (unit tests), integrated test patterns
- **Patterns:** Layered validation, audit logging, transactional operations

## Key Patterns

### Validation Architecture
- **Zod schemas** at the request boundary (controllers)
- **Mongoose pre-validate hooks** at the persistence boundary (models)
- **Explicit field allowlists** (never spread `req.body` into constructors)
- **Field-level error details** in 422 responses for user feedback

### Error Handling
- 404: Resource not found
- 409: Conflict (duplicate, state violation, invariant broken)
- 422: Validation failed (field-level error details)
- 401/403: Authentication/authorization
- Structured error response with `error.code`, `error.details`, `error.message`

### Audit Logging
- `auditService.logFromRequest(req, action, resourceType, diff)`
- Structured diffs comparing before/after state
- Captures actor context (userId, requestId)
- Critical for compliance and debugging

### Security
- **Always escape user input in regex:** Use `escapeRegex()` helper before `$regex` queries
- **Never rely on client validation alone**
- **Validate at system boundaries** (user input, external APIs)
- **No hardcoded credentials or secrets** in code

## File Structure

```
src/
├── __tests__/              # Test files
├── config/                 # Database, environment config
├── controllers/            # Request handlers
├── middleware/             # Express middleware
├── models/                 # Mongoose schemas
├── routes/                 # Express routes
├── services/               # Business logic, shared utilities
├── validators/             # Zod schemas
├── constants/              # Constants and enums
├── scripts/                # Utility scripts (migrations, seeds)
└── seeds/                  # Data seeding
```

## Before Asking for Code Changes

Make sure you understand:
- What problem this solves
- Which tests will validate it
- Whether any existing patterns need to be followed
- If there are any performance implications
- What the audit trail should capture

## Git Workflow

- Prefer creating new commits over amending
- Include context in commit messages (what, why, not just what)
- Reference task or issue numbers when applicable
- Don't force-push unless explicitly authorized

## Testing Expectations

- New features should have corresponding test cases
- Test both happy path and error cases
- Test edge cases (empty, null, boundary values)
- Verify audit logs capture the right details
- Run full test suite before considering work complete
