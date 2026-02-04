# LangGraph Agent Flows – Technical Guide (Node.js)

This document is a **step-by-step technical playbook** for developers when they next need to build a LangChain / LangGraph application.

It is designed to be used **at build time**, not just read once. Developers should work through it sequentially when starting a new application.

---

## How to Use This Guide

When starting a new application:

1. Read **Sections 1–3** before writing any code.
2. Implement **Sections 4–6** as your first working skeleton.
3. Add complexity using **Sections 7–12** only when required.
4. Use **Sections 13–15** as guardrails during review.

This ordering is intentional and prevents architectural drift.

---

## 1. Define the Application Boundary (Before Code)

Before touching LangChain or LangGraph, answer these questions:

- What is the **single responsibility** of this application?
- What decisions require **reasoning** vs rules?
- What actions must be **deterministic and auditable**?

Output of this step:
- A short written description of the workflow in plain English.

If you cannot explain the flow without mentioning prompts or models, stop here.

---

## 2. Draw the Flow as a Graph (Mandatory)

Sketch the execution flow as a graph:

- Start node
- Processing nodes
- Decision points
- Failure paths
- End states

This can be done on paper or a whiteboard.

Rule:
> If you cannot draw the graph, you do not control the system.

---

## 3. Define State (The First Code You Write)

State is defined **before** logic.

### Example State Schema

```ts
import { z } from "zod";

export const GraphState = z.object({
  messages: z.array(z.any()),
  intent: z.string().optional(),
  decision: z.string().optional(),
  data: z.any().optional(),
  error: z.string().optional()
});

export type GraphStateType = z.infer<typeof GraphState>;
```

Rules:
- If it matters later, it lives in state
- No hidden variables

---

## 4. Build a Skeleton Graph (No Agents Yet)

Create a graph with **stub nodes only**.

```ts
import { StateGraph } from "@langchain/langgraph";

const graph = new StateGraph<GraphStateType>()
  .addNode("start", startNode)
  .addNode("process", processNode)
  .addNode("end", endNode)
  .addEdge("start", "process")
  .addEdge("process", "end");
```

Goal:
- Verify execution order
- Verify state propagation

No LLMs yet.

---

## 5. Implement Deterministic Logic First

Replace stub logic with **pure code** wherever possible.

Example:
- Classification via rules
- Validation via schemas
- Calculations via functions

Rule:
> If it can be written as code, do not use an LLM.

---

## 6. Introduce Agentic Reasoning (Only Where Needed)

Add agents **inside nodes**, never globally.

```ts
async function reasoningNode(state: GraphStateType) {
  const result = await agent.invoke({ input: state.messages });

  return {
    ...state,
    decision: result.output
  };
}
```

Rules:
- One reasoning task per node
- Output must be validated

---

## 7. Add Tools as Explicit Contracts

Tools represent real capabilities.

```ts
export const lookupUser = tool(
  async ({ userId }) => fetchUser(userId),
  {
    name: "lookup_user",
    description: "Fetch a user record",
    schema: z.object({ userId: z.string() })
  }
);
```

Rules:
- Strict schemas
- Deterministic behavior

---

## 8. Move Routing Logic Into the Graph

```ts
graph.addConditionalEdges("process", (state) => {
  if (state.intent === "support") return "support";
  if (state.intent === "sales") return "sales";
  return "error";
});
```

Never route via prompts.

---

## 9. Design Failure Paths Explicitly

Every failure has a node.

```ts
async function errorNode(state: GraphStateType) {
  return {
    ...state,
    result: "Unable to complete request",
  };
}
```

Rule:
> Errors are states, not exceptions.

---

## 10. Add Memory and Checkpointing

```ts
import { MemorySaver } from "@langchain/langgraph";

const runnable = graph.compile({
  checkpointer: new MemorySaver()
});
```

Use memory only when continuity is required.

---

## 11. Streaming (Optional, Last)

```ts
for await (const event of runnable.stream(input)) {
  console.log(event);
}
```

Streaming must not affect graph logic.

---

## 12. Validate End States

Before shipping, confirm:

- All outputs are validated
- All paths terminate
- All failures are observable

---

## 13. Review Checklist (Use in PRs)

- Is control in the graph?
- Is state explicit?
- Are tools deterministic?
- Is reasoning bounded?
- Are failures explicit?

---

## 14. Common Failure Modes

- Prompt-based routing
- Global agents
- Hidden state mutation
- Tool logic inside prompts

---

## 15. Final Build Rule

Build agent systems like **software**, not experiments.

LangChain provides capabilities.
LangGraph enforces control.

If control is unclear, stop and redesign.

---

# Appendix A: One-Page Agent Flow Build Checklist

Use this as a **build-time checklist** (and as a PR checklist) for any new LangGraph application.

## A1. Architecture (Before Code)

- Define the application’s single responsibility in 3–5 sentences.
- Identify which steps are deterministic vs reasoning-based.
- Draw the full execution graph including failure paths and termination states.

## A2. State and Contracts

- Define a state schema (Zod) before implementing nodes.
- Confirm all data required later is stored in state.
- Define structured output schemas for:
  - routing decisions
  - tool inputs
  - tool outputs
  - final outputs

## A3. Graph Skeleton

- Implement stub nodes and compile the graph.
- Validate state propagation across all paths.
- Ensure all paths terminate (`__end__`) or route to explicit error states.

## A4. Deterministic First

- Implement deterministic logic before introducing any LLM calls.
- Implement validation nodes for all structured outputs.

## A5. Reasoning (Bounded)

- Add agentic reasoning only inside dedicated nodes.
- Enforce bounded scope (one reasoning task per node).
- Validate agent output immediately.

## A6. Tools (Contracts)

- Tools have strict schemas and deterministic behavior.
- Tools do business logic and side effects; prompts do intent.
- Tool failures route to explicit recovery or error nodes.

## A7. Reliability

- Add explicit error-handling nodes and recovery paths.
- Add checkpointing if resumability is required.
- Add rate limiting / timeouts around external tools.

## A8. Observability

- Enable tracing and consistent run metadata.
- Log node transitions, tool calls, validation failures, and retries.

## A9. Testing

- Unit test nodes as pure functions where possible.
- Integration test the graph for critical paths.
- Add regression tests for known failure cases.

---

# Appendix B: Reference Folder Structure (Recommended)

Use this structure to keep large agent flows maintainable.

```
src/
  graph/
    index.ts              # Graph assembly and compile()
    routes.ts             # Conditional edge routing logic
    state.ts              # Zod schema + state types
    constants.ts          # Node names, error codes, enums

  nodes/
    start.ts
    classify.ts
    reasoning.ts
    execute.ts
    validate.ts
    error.ts

  tools/
    index.ts              # Tool registry
    lookupUser.ts
    searchDocs.ts
    writeRecord.ts

  prompts/
    classify.prompt.ts
    reasoning.prompt.ts

  lib/
    tracing.ts            # Observability helpers
    timeouts.ts           # Timeout wrappers
    retry.ts              # Controlled retry helpers
    logger.ts

  tests/
    nodes/
      classify.test.ts
      validate.test.ts
    graph/
      criticalPaths.test.ts
      failurePaths.test.ts

  app.ts                  # HTTP/API entrypoint
  config.ts               # env parsing, feature flags
```

Rules:
- Nodes import tools; tools do not import nodes.
- Graph routing logic lives in `graph/routes.ts`, not inside nodes.
- Prompts are isolated from code logic and versioned.

---

# Appendix C: Multi-Agent Orchestration Patterns

Multi-agent does not mean “multiple global agents.” It means **multiple reasoning nodes**, each with a bounded responsibility, coordinated by the graph.

## C1. Pattern: Specialist Nodes (Recommended)

Use multiple specialist reasoning nodes:
- `planner` → creates a bounded plan
- `researcher` → tool-augmented retrieval
- `writer` → final synthesis
- `critic` → validation / quality gate

Graph controls which nodes run and when.

Key rule:
> The graph is the supervisor; agents are workers.

## C2. Pattern: Router + Subgraphs

Use a router node to select one of several **subgraphs**.

- `router` decides `flow = sales | support | research | admin`
- Each flow is its own subgraph with dedicated nodes and tools.

Benefits:
- Isolation of concerns
- Cleaner testing
- Easier scaling

## C3. Pattern: Debate / Critique Loop (Bounded)

If you need iterative refinement:
- Limit the number of critique cycles in state (`critiqueCount`).
- Terminate after N cycles or on validation success.

Rule:
> Iteration is a controlled loop, not an open-ended agent run.

## C4. Pattern: Human-in-the-Loop Approval

Introduce an explicit approval node:
- `propose` → generate action plan
- `approve` → user/ops approval gate
- `execute` → tool side effects only after approval

Rule:
> Side effects happen only after explicit approval state.

---

# Appendix D: Testing Strategy for Agent Graphs

Testing is essential because agent flows have more branching, more external dependencies, and more failure modes.

## D1. Unit Testing Nodes

Treat nodes as pure functions where possible:
- given input state
- return new state

Mock tool invocations.

Test:
- happy path
- validation failure
- tool failure mapping

## D2. Tool Contract Tests

For each tool:
- validate schema acceptance
- validate schema rejection
- validate deterministic output for deterministic input

## D3. Graph Integration Tests

Run the compiled graph across:
- critical success paths
- known failure paths
- high-latency tool scenarios (timeouts)

Assert:
- correct termination
- correct error routing
- correct state outputs

## D4. Regression Harness

When a production issue occurs:
- capture a minimal reproduction input and expected state outcome
- add it to a regression suite

Rule:
> Every failure becomes a test case.

---

# Appendix E: Practical Extensions You Can Add Safely

## E1. Feature Flags

Use feature flags to control:
- model selection
- tool availability
- optional critique loops

## E2. Rate Limits and Budget Guards

Track:
- token usage
- tool call counts
- elapsed time

Enforce budgets by routing to safe termination states.

## E3. Observability Standards

Minimum metadata per run:
- `appName`
- `flowName`
- `userId`
- `tenantId`
- `requestId`

This enables reliable debugging and analytics.

