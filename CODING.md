# CODING.md - Development Workflow & Model Strategy

## Model Provider Rules ⚠️

**ALWAYS use these providers** (they leverage Nisch's existing subscriptions — no extra API cost):

1. **`google-gemini-cli/<model>`** — 1st priority for Google models
2. **`google-antigravity/<model>`** — fallback for Google + Claude models
3. **`openai-codex/<model>`** — for OpenAI models (uses Nisch's OpenAI subscription)

**NEVER use** `openai/` (bare), `anthropic/`, `google/` (bare) or any other provider that requires separate API keys. If a model isn't available under the preferred providers, ask Nisch before using a paid provider.

This applies to: spawning subagents, skills, cron jobs, session overrides — everywhere a model is specified.

---

## Model Routing Strategy

Optimized for cost (subscription-only) and performance:

### Main Session (You = Zoe)
- **Model:** `google-antigravity/claude-opus-4-6-thinking`
- **Role:** Orchestration, planning, tool calling, skill creation
- **Use for:** 
  - High-level decision making
  - Complex multi-step planning
  - Creating/updating skills
  - Coordinating subagents
  - Critical implementations

### Subagents (Background Workers)
- **Default Model:** `google-antigravity/claude-sonnet-4-5`
- **Thinking:** Off (for speed)
- **Max Concurrent:** 8
- **Use for:**
  - Routine implementation tasks
  - File operations when steps are clear
  - Testing & validation
  - Documentation generation
  - Code formatting/linting

### Model Override Strategy for Specific Tasks

When spawning subagents, **explicitly override the model** for these scenarios:

#### 🧠 Heavy Reasoning & Complex Planning
```
sessions_spawn(
  task="Design the database schema and API architecture for...",
  model="openai-codex/gpt-5.3-codex",
  thinking="high"
)
```
Use `openai-codex/gpt-5.3-codex` with **high thinking** for:
- Complex architecture planning and system design
- Difficult algorithmic problems requiring deep reasoning
- Multi-step decision-making with trade-off analysis
- Critical security implementations
- Performance-critical code requiring careful thought

#### 🔧 High-Stakes Implementation
```
sessions_spawn(
  task="Implement core authentication system with JWT",
  model="google-antigravity/claude-opus-4-6-thinking"
)
```
Use `google-antigravity/claude-opus-4-6-thinking` for:
- Complex feature implementation
- Code that needs strong tool-use and iteration
- Multi-file refactors with testing

#### 🔍 Research & Context Gathering
```
sessions_spawn(
  task="Research best practices for Redis caching strategies",
  model="google-gemini-cli/gemini-3-pro-preview"
)
```
Use `google-gemini-cli/gemini-3-pro-preview` for:
- Large documentation review
- API documentation parsing
- Multi-file context analysis
- Research tasks with heavy reading

#### ⚡ Trivial Tasks
```
sessions_spawn(
  task="Generate commit message from git diff",
  model="google-gemini-cli/gemini-2.5-flash"
)
```
Use `google-gemini-cli/gemini-2.5-flash` for:
- Commit messages
- Simple formatting
- Basic file renaming
- Generating boilerplate comments

## Workflow Patterns

### Pattern 1: Complex Feature Development
```
1. Main session (Opus): Plan architecture, break down into tasks
2. Spawn subagent (Codex): Implement core logic
3. Spawn subagent (Sonnet): Write tests
4. Spawn subagent (Flash): Generate documentation
5. Main session (Opus): Review, integrate, commit
```

### Pattern 2: Bug Investigation
```
1. Main session (Opus): Analyze issue, form hypothesis
2. Spawn subagent (Gemini-Pro): Search codebase for similar patterns
3. Spawn subagent (Sonnet): Implement fix
4. Spawn subagent (Sonnet): Verify fix with tests
```

### Pattern 3: Refactoring
```
1. Main session (Opus): Define refactoring scope and goals
2. Spawn multiple subagents (Sonnet): Parallel file updates
3. Spawn subagent (Sonnet): Update tests
4. Main session (Opus): Final review and commit
```

## Cost Optimization Tips

1. **Default to Sonnet for subagents** - Already configured
2. **Use Codex 5.3 + high thinking for hard problems** - Architecture, complex algorithms, deep reasoning
3. **Override to Opus for strong implementation** - Multi-file, tool-heavy work
4. **Use Gemini-Pro for reading-heavy tasks** - Large context windows
5. **Use Flash for trivial work** - Commit messages, formatting
6. **Batch similar tasks** - Spawn one subagent for multiple related files
7. **Always use `google-gemini-cli/`, `google-antigravity/`, or `openai-codex/` providers** - All subscription-covered, no extra API cost

## Memory & Context

- **Main session** has full context (MEMORY.md, USER.md, SOUL.md)
- **Subagents** get task-focused prompts without personal context
- **Pass relevant info in spawn prompts** - Don't rely on memory_search in subagents

## Tool Restrictions for Subagents

Subagents **cannot** use:
- `sessions_spawn` (no nested spawning)
- `memory_search` / `memory_get` (pass context in task)
- `gateway` / `cron` (system management)
- `sessions_list` / `sessions_send` (session orchestration)

Subagents **can** use:
- `read`, `write`, `edit`, `exec`, `process`
- `web_search`, `web_fetch`, `browser`
- All coding tools

## Quick Commands

```bash
# View current model config
openclaw models status

# List available models
openclaw models list

# Check subagent activity
/subagents list

# View subagent logs
/subagents log <id> 20 tools

# Stop runaway subagent
/subagents stop <id>
```

## Development Setup Checklist

- [x] Model routing configured (Opus main, Sonnet subagents)
- [x] Fallback chain configured
- [x] Max concurrent subagents: 8
- [ ] Code editor integration (if needed)
- [ ] Git hooks (if needed)
- [ ] Pre-commit checks (if needed)

## Notes

- When you (main session) delegate work, **be explicit about the model choice**
- If a subagent fails, the main session gets the error and can retry with a different approach
- Subagent sessions auto-archive after 60 minutes (transcripts preserved)
- Cost tracking available in announce messages (token usage + estimated cost)

---

*This workflow is designed for speed and cost-efficiency. Adjust model choices based on task complexity and budget constraints.*
