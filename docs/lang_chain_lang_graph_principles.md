# LangChain–LangGraph Principles

This document defines practical, production-oriented principles for building applications with **LangChain** and **LangGraph** (JavaScript / Node.js). It is intended as a durable reference you can apply directly when designing, implementing, and scaling agentic systems.

---

## 1. Graph-First Architecture

**Principle**: Design the system as a graph before thinking about prompts or agents.

LangGraph should be the architectural backbone. Every application should be expressible as a state machine composed of nodes and edges, where execution order, branching, retries, and termination conditions are explicit.

Agents belong *inside* nodes, not at the top level of the system. This ensures that reasoning is bounded, observable, and governable.

---

## 2. Explicit State Is Mandatory

**Principle**: All meaningful data must live in graph state.

Define a state schema up front. This includes messages, intermediate artifacts, decisions, validation results, and control flags. Avoid ad-hoc variables or hidden closures.

State is mutable and graph-scoped. Runtime context (user ID, tenant, role, environment) should be immutable and passed separately via invocation configuration.

---

## 3. Deterministic First, Agentic Second

**Principle**: Use deterministic logic wherever possible.

If a step can be implemented as pure code, a rule, or a validation function, do not delegate it to an LLM. Agentic reasoning should be reserved for ambiguity, synthesis, or judgment.

This reduces cost, improves reliability, and makes failure modes easier to reason about.

---

## 4. Tools Are Contracts, Not Helpers

**Principle**: Treat every tool as a stable API surface.

Each tool must have a clear name, a precise description, and a strict input schema (preferably Zod). Tools should fail loudly and predictably when misused.

Business logic belongs in tools and nodes, not embedded in prompts. Prompts should describe intent, not implementation details.

---

## 5. Structured Output by Default

**Principle**: Free-text output is an edge case, not the default.

Whenever output is consumed by another system, node, or decision point, enforce structured output using schemas. Validate immediately and route failures explicitly.

This eliminates brittle parsing and prevents silent corruption of downstream logic.

---

## 6. Memory Is a Design Choice

**Principle**: Start with short-term memory only.

Use LangGraph checkpointers to support resumability and retries. Introduce long-term memory (databases, vector stores) only after you can clearly articulate what is stored, why it is stored, and how it is retrieved.

Unbounded memory without governance creates instability and unpredictable behavior.

---

## 7. Model Selection Is Runtime Logic

**Principle**: Model choice should be dynamic, not hard-coded.

Define multiple models with different cost and capability profiles. Use middleware to select models based on state size, task complexity, or failure conditions.

This allows you to control cost without degrading quality in critical paths.

---

## 8. Error Handling Is a First-Class Path

**Principle**: Failure must be modeled explicitly.

Assume tools will fail, schemas will be violated, and models will produce invalid output. Handle these cases with explicit graph branches or middleware.

Never rely on implicit retries or silent fallbacks. Every failure should be observable and traceable.

---

## 9. Streaming Is a UX Concern

**Principle**: Streaming improves perception, not correctness.

Use streaming to enhance user experience and responsiveness. Do not let streaming mechanics leak into core orchestration or business logic.

The graph should behave identically whether streaming is enabled or not.

---

## 10. Instrument Everything

**Principle**: Observability is not optional.

Use run names, tags, metadata, and tracing from the beginning. Track node transitions, tool calls, validation outcomes, and retries.

A system you cannot observe is a system you cannot safely evolve.

---

## 11. Build in the Correct Order

**Recommended Sequence**:
1. Define the graph and state schema.
2. Implement stub nodes.
3. Replace stubs with real tools and logic.
4. Introduce agentic reasoning where necessary.
5. Add memory, dynamic models, and streaming.

This order minimizes rework and architectural drift.

---

## Core Mental Model

LangChain provides **capabilities**.

LangGraph provides **control**.

Production systems require both, applied deliberately and with clear boundaries.

