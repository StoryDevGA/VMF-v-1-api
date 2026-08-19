# AGENTS.md instructions for C:\Users\garya\OneDrive\Documents\StoryLineOS\VMF-APP\dev-v1\VMF-v-1-api

## Operating Principles (Non-Negotiable)

1. Don't assume. Don't hide confusion. Surface tradeoffs.
2. Minimum code that solves the problem. Nothing speculative.
3. Touch only what you must. Clean up only your own mess.
4. Define success criteria. Loop until verified.

## Runtime Control Contract Quality Gate

- For governance, audit, lifecycle, activation, validation, dependency-lock, seed, or mock/API work, apply `../docs/references/runtime-control/runtime-control-contract-quality-gate.md` before coding and again before handoff.
- Load `backend-developer`, `mongo-db-developer` when schema/indexes are touched, `vmf-api-test-coverage` for API tests, and the API `pr-reviewer` before signoff.
- Build a short contract map before implementation: model/schema fields, indexes, validators, controllers, services, serializers, audit events, seed/import values, parity fixtures, and focused Jest suites.
- Governed writes require failure-path proof. Add or verify tests for audit persistence failure, real rollback semantics, unique-index race conflicts, stale/missing evidence, source immutability, and no success audit on rejected paths.
- Do not ship future-only fields in active signatures, checksums, indexes, or required payloads unless production code writes and queries them now.
- Final backend handoff must state the focused Jest commands, syntax checks, `git diff --check`, and which quality-gate surfaces were checked.

## Current governed cross-layer intake — 2026-08-14

- SS-012's pure `composition-lineage-and-fixture-hardening` slice is verified in exactly two API files. Focused composition tests pass 12/12, the adjacent seven-suite API regression passes 248/248, syntax/diff checks pass, and the independent evaluator passes at `0.99`.
- The provider-safe/GRR manifest seam is now locally verified in the separate harness `docs/generated/harness-runs/ss-012/2026-08-14-provider-safe-composition-manifest/`: focused verification is `212/212`, the adjacent seven-suite regression is `253/253`, syntax/diff checks pass, and the independent final evaluator passes at `0.96`.
- The bounded live Outcome Studio orchestration bridge is implemented in `src/services/outcomeStudioLiveCompositionBridgeService.js` and wired from `outcomeStudioService.js`. Its identity/lineage and schema-governance hardening slice is locally verified by the fresh final evaluator at `0.97`; bridge coverage is `32/32`, the focused nine-suite regression is `323/323`, and syntax/diff checks pass. The follow-up Markdown duplicate-content slice is also locally verified at `0.96`; bridge coverage is `37/37`, the focused nine-suite regression is `328/328`, and its exact normalization/no-composition negative matrix passes. The structured-source decision is resolved for the selected active cloud Development/Test records: database `test` returns `MARKDOWN` for both active Executive Brief Output Type and Schema, with exact persisted Markdown structure recorded in the SS-012 harness. Structured YAML/JSON alias strictness remains deferred because no structured path is applicable to those active records. Do not infer source values from pack type, generic text, fixture stage metadata, resolver fallback, or parser aliases, and do not call this bounded work full SS-012 closure.
- Real manifest persistence/readback is locally verified only for the existing GRR writer through the separate isolated harness `docs/generated/harness-runs/ss-012/2026-08-15-real-manifest-persistence-readback/`, using an exact generated `vmf_ss012_qa_*` cloud Development/Test database that was dropped after verification; the configured `test` database was not written. Any future structured-pack parsing contract, route-level service readback, provider, browser, deployment, production, and release claims remain separate gates. Explicit user-approved read-only cloud Development/Test queries are permitted for source evidence; any future cloud write requires a fresh bounded contract, exact temporary-target guard, evaluator PASS, and explicit authorization.
- `outcomeStudioEvidenceCompositionService.js` is the bounded composition owner; `outcomeStudioProviderSafeContextService.js` owns provider safety; `governedReasoningRuntimeService.js` is the sole manifest writer. The seam preserves the no-composition path and does not claim full SS-012 closure.

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
- vmf-api-test-coverage: Comprehensive VMF API/backend regression coverage for Jest/Supertest route tests, Mongoose persistence, Runtime Control lifecycle contracts, audit assertions, unique-index race tests, and mock/API parity fixtures. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-api/.git/skills/vmf-api-test-coverage/SKILL.md)
- vmf-client-test-coverage: Comprehensive VMF client/frontend regression coverage for Vitest, Testing Library, RTK Query mocks, Runtime Control lifecycle matrices, editor action states, cache invalidation, and mock/live parity. (file: C:/Users/garya/OneDrive/Documents/StoryLineOS/VMF-APP/dev-v1/VMF-v-1-client/.git/skills/vmf-client-test-coverage/SKILL.md)

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
