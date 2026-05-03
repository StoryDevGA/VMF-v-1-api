# AGENTS.md instructions for C:\Users\garya\OneDrive\Documents\StoryLineOS\VMF-APP\dev-v1\VMF-v-1-api

## Operating Principles (Non-Negotiable)

1. Don't assume. Don't hide confusion. Surface tradeoffs.
2. Minimum code that solves the problem. Nothing speculative.
3. Touch only what you must. Clean up only your own mess.
4. Define success criteria. Loop until verified.

## Skills
A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill.

### Available skills
- skill-creator: Guide for creating effective skills. Use when users want to create or update a skill that extends Codex capabilities. (file: C:/Users/garya/.codex/skills/.system/skill-creator/SKILL.md)
- skill-installer: Install Codex skills into `$CODEX_HOME/skills` from curated or GitHub sources. Use when users ask to list/install skills. (file: C:/Users/garya/.codex/skills/.system/skill-installer/SKILL.md)
- frontend-design: Design and build production-grade React components/pages using the VMF design system, token architecture, and component library. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-client/.git/skills/front-end-designer/SKILL.md)
- front-end-developer: Review and implement enterprise-quality frontend code with React/JS/CSS, Redux Toolkit, RTK Query, testing, and accessibility best practices. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-client/.git/skills/front-end-developer/SKILL.md)
- frontend-api-integration: Build and maintain frontend API integration layers, auth/session handling, contract alignment, and API testing patterns. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-client/.git/skills/frontend-api-integration/SKILL.md)
- pr-reviewer: Review pull request diffs with structured feedback on behavior, quality, security, tests, and maintainability. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-client/.git/skills/pr-reviewer/SKILL.md)
- prd: Generate product requirements documents (PRDs), including discovery questions and structured requirement output. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-client/.git/skills/prd-writer/SKILL.md)
- technical-writer: Convert PRDs into implementation-ready technical specifications with architecture, API, testing, rollout, and traceability. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-client/.git/skills/technical-writer/SKILL.md)
- ui-ux-expert: Review UI/UX design and implementation quality against VMF token system, theming, component reuse, and accessibility standards. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-client/.git/skills/ui-ux/SKILL.md)
- api-contract-openapi-engineer: Engineer backend API contracts from requirements into OpenAPI specs and implementation plans. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-api/.git/skills/api-contract-openapi-engineer/SKILL.md)
- auth-security-engineer: Implement and review API authentication, authorization, and security controls in Node/Express services. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-api/.git/skills/auth-security-engineer/SKILL.md)
- backend-developer: Build and maintain backend Node/Express features, architecture, and service-layer integrations. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-api/.git/skills/backend-developer/SKILL.md)
- production-ready: Stress-test and harden AI-generated backend functions for outages, scale, latency, stale data, retries, debugging, and production metrics. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-api/.git/skills/production-ready/SKILL.md)
- lang-chain-graph-expert: Design and implement LangChain/LangGraph agent workflows, orchestration, and evaluation patterns. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-api/.git/skills/lang-chain-graph-expert/SKILL.md)
- mongo-db-developer: Design MongoDB schemas, indexes, and query patterns for scalable backend data access. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-api/.git/skills/mongo-db-developer/SKILL.md)
- pr-reviewer (api): Review API/backend pull requests for correctness, regressions, security, and test coverage. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-api/.git/skills/pr-reviewer/SKILL.md)
- prd-writer (api): Produce backend-oriented PRDs with technical scope, requirements, and acceptance criteria. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-api/.git/skills/prd-writer/SKILL.md)
- technical-writer (api): Convert backend PRDs into implementation-ready technical specs with architecture and rollout detail. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-api/.git/skills/technical-writer/SKILL.md)
- test-engineer-node: Create and maintain Node.js backend test suites, fixtures, and quality gates. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-api/.git/skills/test-engineer-node/SKILL.md)

### How to use skills
- Discovery: The list above is the skills available in this session (name + description + file path). Skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill is not in the list or the path cannot be read, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1) After deciding to use a skill, open its `SKILL.md`. Read only enough to follow the workflow.
  2) When `SKILL.md` references relative paths (for example `scripts/foo.py`), resolve them relative to the skill directory listed above first, and only consider other paths if needed.
  3) If `SKILL.md` points to extra folders such as `references/`, load only the specific files needed for the request; do not bulk-load everything.
  4) If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.
  5) If `assets/` or templates exist, reuse them instead of recreating from scratch.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order used.
  - Announce which skill(s) are being used and why (one short line). If skipping an obvious skill, state why.
- Context hygiene:
  - Keep context small: summarize long sections instead of pasting them; only load extra files when needed.
  - Avoid deep reference-chasing: prefer opening only files directly linked from `SKILL.md` unless blocked.
  - When variants exist (frameworks, providers, domains), pick only relevant reference files and note that choice.
- Safety and fallback: If a skill cannot be applied cleanly (missing files, unclear instructions), state the issue, choose the next-best approach, and continue.
