---
name: browser-test
description: Launch an autonomous browser testing agent (sonnet) as a subagent to test a UI feature or flow. The agent tests everything autonomously, analyzes screenshots itself, and reports issues. Use when the user wants to test a web UI, validate a feature, or check a user flow.
disable-model-invocation: false
argument-hint: "<feature/flow description>"
---

# Browser Test — Autonomous UI Testing Agent

Launch a sonnet-powered browser agent to test a UI feature or user flow. The agent navigates, interacts, takes screenshots, **analyzes them itself**, and returns a detailed report of issues found.

## Before Launching

### 1. Build a detailed test brief

The agent needs a precise description of what to test. Before spawning, assemble:

- **URL**: exact page to start testing
- **Feature/flow description**: what the feature does, expected behavior, edge cases
- **Test steps**: specific actions to perform (click X, fill Y, verify Z)
- **Expected results**: what correct behavior looks like at each step
- **Test file context** (if exists): read any relevant test file and include key assertions/scenarios in the prompt — do NOT just pass a file path, the agent needs the actual context

If the user's request is vague, ask clarifying questions before launching.

## Launching the Agent

Use the Task tool to spawn a single subagent:

```yaml
Task:
  subagent_type: browser-agent
  model: sonnet
  mode: bypassPermissions
  run_in_background: true
  description: "Test <feature summary>"
  prompt: |
    ## Test Brief

    **URL**: <url>
    **Feature**: <description>

    ### Test Steps
    1. <step 1>
    2. <step 2>
    ...

    ### Expected Results
    - <expected behavior at each step>

    ### Context
    <any relevant code/test context>
```

Put the **full test brief** directly in the prompt — the agent has no access to task lists or team communication.

## Monitoring

- The agent runs in background. Use `Read` on its output file to check progress.
- When the agent finishes, it returns a structured test report.

## After the Agent Returns

1. Read the report from the agent's output
2. If issues were found, review screenshots yourself with the Read tool for complex/visual issues
3. Present a structured summary to the user: what passed, what failed, evidence

## When to Review Screenshots

- Agent reports a visual/layout issue it cannot fully assess from snapshot alone
- Agent flags uncertainty ("this might be a bug but I'm not sure")
- Feature involves complex visual elements (charts, animations, responsive layout)
- User explicitly asked for visual verification

Use the Read tool on screenshot paths (`/tmp/*.png`) to view them.

## Known Issues

- Search engines (DuckDuckGo, Google) trigger CAPTCHAs in headless mode — use direct URLs
- `sudo` commands require user's terminal
- agent-browser v0.10.0 at `/usr/bin/agent-browser`
