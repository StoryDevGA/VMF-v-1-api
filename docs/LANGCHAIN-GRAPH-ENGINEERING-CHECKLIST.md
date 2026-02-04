# LangChain-LangGraph Engineering Checklist (PR Template)

Use this one-page checklist before merging LangChain/LangGraph work. It is derived only from the project docs on principles, the knowledge framework, and the agent flows technical guide.

## Summary (fill in)
- App or flow name:
- Single responsibility:
- Graph sketch link:

## Architecture and State
- [ ] Graph drawn with decision points, failure paths, and end states (control lives in the graph).
- [ ] State schema defined first (Zod), with all meaningful data in state; no hidden variables.
- [ ] Runtime context is immutable and passed separately (user, tenant, role, env).
- [ ] Build order followed: graph + state -> stub nodes -> deterministic logic -> agentic reasoning -> memory/models/streaming.

## Deterministic First, Bounded Reasoning
- [ ] Deterministic logic used wherever possible; LLMs only for ambiguity, synthesis, or judgment.
- [ ] Reasoning is inside dedicated nodes, one reasoning task per node, output validated immediately.

## Tools and Structured Output
- [ ] Tools are named, described, schema-validated, and deterministic; misuse fails loudly.
- [ ] Prompts describe intent; business logic and side effects live in tools or nodes.
- [ ] Structured outputs are the default and validated immediately.
- [ ] Output parsing and schema validation happen inside the graph with explicit failure routing.

## Errors, Routing, Completion
- [ ] Routing is done by graph edges, not prompts.
- [ ] Failures are explicit graph paths (no silent retries or fallbacks).
- [ ] All paths terminate or route to explicit error states; completion is explicit.

## Memory, Models, Streaming
- [ ] Short-term memory only unless long-term memory has a clear purpose and retrieval rules.
- [ ] Model selection is runtime logic (not hard-coded).
- [ ] Streaming is UX only and does not affect graph logic.

## Model Selection (Notes)
- Selection uses a single fixed model from admin config or `LLM_MODEL` fallback.
- Model choice should be treated as a runtime configuration (not hard-coded in nodes).
- Purpose: keep quality/cost predictable and avoid hidden routing behavior.

## Observability and Cost Control
- [ ] Tracing includes node transitions, tool calls, validation outcomes, and retries.
- [ ] Run metadata includes appName, flowName, userId, tenantId, requestId.
- [ ] Cost controls rely on deterministic-first logic and bounded reasoning.

## Multi-Agent Patterns (if used)
- [ ] Multiple specialist reasoning nodes are coordinated by the graph.
- [ ] Router/subgraph selection and critique loops are bounded and explicit.
- [ ] Human approval gate exists before side effects when required.

## Testing
- [ ] Node unit tests cover happy path and failures (mock tools).
- [ ] Tool contract tests cover schema acceptance and rejection.
- [ ] Graph integration tests cover critical and failure paths.
- [ ] Regression tests added for any production failure.
