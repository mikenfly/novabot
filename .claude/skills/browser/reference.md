# agent-browser CLI Reference

Complete command reference for the agent-browser automation tool.

## Installation & Setup

```bash
npm install -g agent-browser
# or
npx agent-browser --help
```

## Command Structure

```bash
agent-browser <command> [options] [arguments]
```

## All Commands

### Navigation Commands

| Command | Description | Example |
|---------|-------------|---------|
| `open <url>` | Navigate to URL | `agent-browser open https://example.com` |
| `back` | Go back in history | `agent-browser back` |
| `forward` | Go forward in history | `agent-browser forward` |
| `reload` | Reload current page | `agent-browser reload` |
| `close` | Close browser session | `agent-browser close` |

### Inspection Commands

| Command | Description | Example |
|---------|-------------|---------|
| `snapshot` | Get accessibility tree with element refs | `agent-browser snapshot` |
| `snapshot -i` | Interactive elements only | `agent-browser snapshot -i` |
| `screenshot [path]` | Take screenshot | `agent-browser screenshot page.png` |
| `get url` | Get current URL | `agent-browser get url` |
| `get title` | Get page title | `agent-browser get title` |
| `get text <ref>` | Extract text from element | `agent-browser get text @e5` |

### Interaction Commands

| Command | Description | Example |
|---------|-------------|---------|
| `click <ref>` | Click element | `agent-browser click @e10` |
| `fill <ref> <text>` | Fill input field | `agent-browser fill @e3 "hello"` |
| `type <ref> <text>` | Type into element | `agent-browser type @e2 "text"` |
| `press <key>` | Press keyboard key | `agent-browser press Enter` |
| `hover <ref>` | Hover over element | `agent-browser hover @e5` |
| `select <ref> <option>` | Select dropdown option | `agent-browser select @e8 "Option 1"` |

## Global Options

| Option | Description | Example |
|--------|-------------|---------|
| `--session <name>` | Use named session (isolated browser instance) | `--session testing` |
| `--profile <path>` | Use persistent profile (cookies, localStorage) | `--profile /tmp/profile` |
| `--headed` | Show browser window (default: headless) | `--headed` |
| `--timeout <ms>` | Navigation timeout in milliseconds | `--timeout 30000` |
| `--wait <ms>` | Wait time after actions | `--wait 1000` |

## Element References

The `snapshot` command outputs element references in the format `[ref=e1]`, `[ref=e2]`, etc.

Use these refs in commands with the `@` prefix:
- `@e1` - First element
- `@e10` - Tenth element
- etc.

You can also use CSS selectors instead of refs:
```bash
agent-browser click "button.submit"
agent-browser fill "#email" "user@example.com"
```

## Keyboard Keys

Supported keyboard keys for `press` command:
- `Enter`, `Return`
- `Tab`
- `Escape`, `Esc`
- `Space`
- `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`
- `Backspace`, `Delete`
- `Home`, `End`
- `PageUp`, `PageDown`
- `F1` through `F12`

With modifiers:
```bash
agent-browser press "Control+A"    # Select all
agent-browser press "Meta+C"       # Copy (Command on macOS)
agent-browser press "Shift+Tab"    # Tab backwards
```

## Sessions vs Profiles

### Sessions (`--session <name>`)
- Isolated browser instances running simultaneously
- Each session has its own cookies, localStorage, etc.
- Sessions are temporary (cleared when browser closes)
- Use for parallel testing or multi-account workflows

```bash
agent-browser open https://app.com --session user1
agent-browser open https://app.com --session user2
# Two separate browser instances
```

### Profiles (`--profile <path>`)
- Persistent storage on disk
- Cookies, localStorage, session data saved between runs
- Use for maintaining login state across sessions
- Profile directory is created if it doesn't exist

```bash
agent-browser open https://app.com --profile /tmp/my-profile
# Login, cookies saved to /tmp/my-profile
agent-browser close

# Later, profile is restored
agent-browser open https://app.com --profile /tmp/my-profile
# Already logged in!
```

## Output Formats

### snapshot
Returns accessibility tree in text format:
```
Page Title
  Navigation [role=navigation]
    Link "Home" [ref=e1]
    Link "About" [ref=e2]
    Link "Contact" [ref=e3]
  Main Content [role=main]
    Heading "Welcome" [ref=e4]
    Button "Get Started" [ref=e5]
    Input "Email" [ref=e6]
```

### snapshot -i (interactive only)
Returns only interactive elements:
```
Link "Home" [ref=e1]
Link "About" [ref=e2]
Button "Get Started" [ref=e5]
Input "Email" [ref=e6]
```

### get text
Returns plain text content of element:
```
Welcome to our website
```

### get url
Returns current URL:
```
https://example.com/page
```

## Error Handling

Common error messages:

| Error | Cause | Solution |
|-------|-------|----------|
| `Element not found: @e10` | Ref doesn't exist or page changed | Re-run `snapshot` to get fresh refs |
| `Timeout waiting for navigation` | Page took too long to load | Increase `--timeout` or check URL |
| `Session not found: xyz` | Session was closed or doesn't exist | Open new session with `open` |
| `Cannot interact with element` | Element not visible or disabled | Check `snapshot`, try different element |

## Examples

See [SKILL.md](SKILL.md) for workflow examples.

## Tips

1. Always run `snapshot` before interacting to get current element refs
2. Use `snapshot -i` for cleaner output when you only need interactive elements
3. Use `--profile` to avoid re-logging in for authenticated workflows
4. Use `--session` to run multiple isolated browser instances
5. Use `--headed` during development to see what's happening
6. Refs are stable for a page load but change when page updates (re-snapshot after navigation/clicks)
7. Screenshot paths are relative to current working directory
