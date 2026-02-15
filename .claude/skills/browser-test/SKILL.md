---
name: browser-test
description: Launch an autonomous browser testing agent (sonnet) as a team to test a UI feature or flow. The agent tests everything autonomously, analyzes screenshots itself, and reports issues. Use when the user wants to test a web UI, validate a feature, or check a user flow.
disable-model-invocation: false
argument-hint: "<feature/flow description> [--agents N]"
---

# Browser Test — Autonomous UI Testing Agent

Launch a sonnet-powered browser agent to test a UI feature or user flow. The agent navigates, interacts, takes screenshots, **analyzes them itself**, and sends a detailed report of issues found.

## Before Launching

### 1. Build a detailed test brief

The agent needs a precise description of what to test. Before spawning, assemble:

- **URL**: exact page to start testing
- **Feature/flow description**: what the feature does, expected behavior, edge cases
- **Test steps**: specific actions to perform (click X, fill Y, verify Z)
- **Expected results**: what correct behavior looks like at each step
- **Test file context** (if exists): read any relevant test file and include key assertions/scenarios in the task description — do NOT just pass a file path, the agent needs the actual context

If the user's request is vague, ask clarifying questions before launching.

### 2. Assess complexity

**Team lead (Opus) should pre-assess**:
- Simple flow (login, form submit, navigation) → agent handles everything alone
- Complex/technical feature (layout bugs, responsive issues, visual regressions) → plan to review screenshots yourself

## Orchestration

### 1. Create team

```
TeamCreate: team_name = "browser-test", description = <feature summary>
```

### 2. Create task

One TaskCreate with the **full test brief** as description. Include:
- URL to test
- Detailed feature/flow description with expected behavior
- Specific test scenarios and edge cases
- Acceptance criteria (what passes, what fails)
- Context from test files if applicable

### 3. Spawn agent

```yaml
subagent_type: browser-agent
model: sonnet
name: browser-1
team_name: browser-test
mode: bypassPermissions
run_in_background: true
prompt: |
  You are browser-1 on team browser-test. Your team lead is "team-lead".
  Check TaskList, claim your task, execute it, report via SendMessage.
```

For multiple agents (`--agents N`), split work into independent sub-tasks and spawn browser-1, browser-2, etc.

### 4. Monitor

- Respond promptly to agent questions
- Help unblock (CAPTCHAs → suggest direct URLs, auth → ask user)
- If the agent flags something as complex or ambiguous, review the screenshots yourself with the Read tool

### 5. Review and present

When the agent reports back:
1. Read the report — if issues found, check screenshots yourself for complex/visual issues
2. Present a structured summary to the user: what passed, what failed, evidence
3. Shutdown agent: `SendMessage type: shutdown_request`
4. Cleanup: `TeamDelete`

## When Team Lead Should Review Screenshots

- Agent reports a visual/layout issue it cannot fully assess from snapshot alone
- Agent flags uncertainty ("this might be a bug but I'm not sure")
- Feature involves complex visual elements (charts, animations, responsive layout)
- User explicitly asked for visual verification

Use the Read tool on screenshot paths (`/tmp/*.png`) to view them.

## Known Issues

- Search engines (DuckDuckGo, Google) trigger CAPTCHAs in headless mode — use direct URLs
- `sudo` commands require user's terminal
- agent-browser v0.10.0 at `/usr/bin/agent-browser`
