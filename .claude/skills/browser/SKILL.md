---
name: browser
description: Automate web browser workflows using agent-browser CLI. Use when the user wants to test web UI, fill forms, extract data from websites, take screenshots, record demos, or interact with web pages programmatically.
disable-model-invocation: false
argument-hint: "[url] [action] [args...]"
allowed-tools: Bash(agent-browser *), Read, Write
---

# Browser Automation with agent-browser

Automate web browser interactions using the `agent-browser` CLI tool. Perfect for testing, data extraction, and web workflows.

## Core Workflow

1. **Navigate**: `agent-browser open <url>`
2. **Inspect**: `agent-browser snapshot` — returns accessibility tree with element refs (@e1, @e2, etc.)
3. **Interact**: Use refs from snapshot to interact with elements
4. **Close**: `agent-browser close` when done

## Essential Commands

### Navigation
```bash
agent-browser open https://example.com
agent-browser back
agent-browser forward
agent-browser reload
agent-browser get url        # Get current URL
agent-browser get title      # Get page title
```

### Inspection (returns structured text for AI parsing)
```bash
agent-browser snapshot           # Full accessibility tree with @refs
agent-browser snapshot -i        # Interactive elements only (cleaner)
agent-browser screenshot [path]  # Visual capture
agent-browser get text @e1       # Extract text from specific element
```

### Interaction (use @refs from snapshot)
```bash
agent-browser click @e5
agent-browser fill @e3 "text here"
agent-browser type @e2 "text"
agent-browser press Enter
agent-browser press Tab
```

## Key Features

- **Element refs**: snapshot outputs `[ref=e1]` tags — use as `@e1` in commands
- **Selectors**: Also supports CSS selectors instead of refs
- **Sessions**: Use `--session <name>` for isolated browser instances
- **Profiles**: Use `--profile <path>` to persist login state
- **Headless**: Runs headless by default; use `--headed` to see window

## Common Workflows

### Example 1: Search DuckDuckGo
```bash
agent-browser open https://duckduckgo.com
agent-browser snapshot -i                    # Find search box ref
agent-browser fill @e10 "AI agents"
agent-browser press Enter
agent-browser snapshot | head -40            # View results
agent-browser get text @e15                  # Extract specific result
agent-browser close
```

### Example 2: Login Flow
```bash
agent-browser open https://example.com/login --profile /tmp/my-profile
agent-browser snapshot -i                    # Find form fields
agent-browser fill @e5 "user@example.com"    # Email field
agent-browser fill @e6 "password123"         # Password field
agent-browser click @e7                      # Submit button
agent-browser screenshot login-success.png   # Verify
agent-browser close
```

### Example 3: Data Extraction
```bash
agent-browser open https://news.ycombinator.com
agent-browser snapshot -i                    # Find story links
agent-browser get text @e20                  # Extract first story title
agent-browser click @e20                     # Navigate to story
agent-browser snapshot                       # Get article content
agent-browser back                           # Return to list
agent-browser close
```

### Example 4: Form Testing
```bash
agent-browser open https://example.com/contact --headed
agent-browser snapshot -i
agent-browser fill @e3 "John Doe"            # Name field
agent-browser fill @e4 "john@example.com"    # Email field
agent-browser fill @e5 "Hello World"         # Message field
agent-browser screenshot before-submit.png
agent-browser click @e6                      # Submit
agent-browser screenshot after-submit.png
agent-browser close
```

## Important Notes

1. **Always snapshot before interacting** to get current element refs
2. **Refs change on page updates** — re-snapshot as needed
3. **Use `-i` flag** on snapshot for cleaner output (interactive elements only)
4. **Handle CAPTCHAs** by using `--profile` for persistent sessions
5. **Sessions are isolated** — multiple `--session` names won't interfere
6. **Headless by default** — add `--headed` to see the browser window

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Element ref not found | Re-run `snapshot` to get fresh refs |
| Can't find element | Use `snapshot -i` to see all interactive elements |
| Login state lost | Use `--profile` to persist cookies/storage |
| Page not loading | Check URL, try `reload`, or increase wait time |
| CAPTCHA blocking | Use `--profile` with `--headed` to solve manually first |

## Advanced Usage

### Multiple Sessions
```bash
# Session 1: logged in as user A
agent-browser open https://app.com/login --session userA --profile /tmp/userA
agent-browser fill @e1 "userA@example.com"
agent-browser click @e3

# Session 2: logged in as user B (isolated from session 1)
agent-browser open https://app.com/login --session userB --profile /tmp/userB
agent-browser fill @e1 "userB@example.com"
agent-browser click @e3
```

### Persistent Profile
```bash
# First time: login and save profile
agent-browser open https://app.com/login --profile /tmp/my-app --headed
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password"
agent-browser click @e3
# Profile now saved with cookies/localStorage

# Later: reuse saved profile (already logged in)
agent-browser open https://app.com/dashboard --profile /tmp/my-app
agent-browser snapshot  # Already authenticated!
```

## Arguments

When invoked with `/browser`:
- `/browser https://google.com` → Open Google and take snapshot
- `/browser search "query"` → Search current page for text
- `/browser screenshot` → Take screenshot of current page
- `/browser close` → Close current browser session

For more details on agent-browser CLI options and features, see [reference.md](reference.md)
