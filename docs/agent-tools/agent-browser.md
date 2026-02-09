# Agent Browser CLI

Browser automation tool for AI agents. Use via bash commands.

## Core Workflow

1. **Navigate**: `agent-browser open <url>`
2. **Inspect**: `agent-browser snapshot` — returns accessibility tree with element refs (@e1, @e2, etc.)
3. **Interact**: Use refs from snapshot to interact with elements
4. **Close**: `agent-browser close` when done

## Essential Commands

```bash
# Navigation
agent-browser open https://example.com
agent-browser back
agent-browser reload

# Inspection (returns structured text for AI parsing)
agent-browser snapshot           # Full accessibility tree with @refs
agent-browser snapshot -i        # Interactive elements only
agent-browser screenshot [path]  # Visual capture

# Interaction (use @refs from snapshot)
agent-browser click @e5
agent-browser fill @e3 "text here"
agent-browser press Enter
agent-browser type @e2 "text"

# Information extraction
agent-browser get text @e1
agent-browser get url
agent-browser get title
```

## Key Features

- **Element refs**: snapshot outputs `[ref=e1]` tags — use as `@e1` in commands
- **Selectors**: Also supports CSS selectors instead of refs
- **Sessions**: Use `--session <name>` for isolated browser instances
- **Profiles**: Use `--profile <path>` to persist login state
- **Headless**: Runs headless by default; use `--headed` to see window

## Example Task: Search DuckDuckGo

```bash
agent-browser open https://duckduckgo.com
agent-browser snapshot -i                    # Find search box ref
agent-browser fill @e10 "AI agents"
agent-browser press Enter
agent-browser snapshot | head -40            # View results
agent-browser close
```

## Notes

- Always `snapshot` before interacting to get current element refs
- Refs change on page updates — re-snapshot as needed
- Use `-i` flag on snapshot for cleaner output (interactive elements only)
- Handle CAPTCHAs/bot detection by using `--profile` for persistent sessions
