# SUBAGENT_RULES.md

## Purpose: Keep main agent free for chat

The main session should act as an orchestrator and conversation layer, not the execution worker.

Why this improves reliability and UX:
- **Faster chat responses:** main agent stays responsive while work runs in parallel.
- **Cleaner context:** implementation details stay inside subagent transcripts instead of bloating the main conversation.
- **Safer model routing:** each task type gets an explicit model + thinking level.
- **Better recovery:** failed work can be retried by respawning a focused worker without disturbing user chat flow.

---

## Mandatory task→model mapping

Use this routing unless the user explicitly overrides it:

1. **Coding / technical analysis / debugging / multi-step implementation**
   - Model: `openai-codex/gpt-5.3-codex`
   - Thinking: `medium`

2. **Trivial operations (GitHub housekeeping, quick search/lookups, tiny edits, formatting, command snippets)**
   - Model: `openai-codex/gpt-5.1-codex-mini`
   - Thinking: `off` (or lowest available)

3. **Conversation, copywriting, rewriting, brainstorming, and creative non-coding work**
   - Model: `openai-codex/gpt-5.2`
   - Thinking: default/off unless user asks for deeper reasoning

---

## Exact operational workflow for main agent

For every non-trivial user request:

1. **Classify the task** into one of the three categories above.
2. **Prepare a task packet** for the subagent:
   - goal and expected output
   - constraints (files, commands, deadlines, style)
   - acceptance criteria
3. **Spawn subagent** with the mapped model + thinking level.
4. **Delegate execution** (tools, file edits, research, validation) to that subagent.
5. **Monitor to completion** and collect final summary/artifacts.
6. **Main agent responds to user** with concise results, decisions, and next options.

### Spawn templates (reference)

#### A) Coding / analysis
- `model: openai-codex/gpt-5.3-codex`
- `thinking: medium`
- label example: `code-impl-<topic>`

#### B) Trivial ops
- `model: openai-codex/gpt-5.1-codex-mini`
- `thinking: off`
- label example: `quick-op-<topic>`

#### C) Creative / conversation support
- `model: openai-codex/gpt-5.2`
- `thinking: off` (or default)
- label example: `creative-<topic>`

---

## Guardrails

- Main agent should only do direct execution itself for:
  - very short, chat-only replies that require no tools/files, or
  - emergency one-step fixes where spawning overhead would harm UX.
- If uncertain between categories, default upward in capability:
  - spark → gpt-5.2 → gpt-5.3-codex (medium)
- If user asks for a specific model, user instruction wins.
