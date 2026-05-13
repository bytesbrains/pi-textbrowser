# TextBrowser — Agent Usage Guide

> You are an AI agent. This document helps you use the TextBrowser extension effectively.

## Available Tools

| Tool | Purpose | When to use |
|---|---|---|
| `browser_navigate` | Open a URL, return page context | First visit to a site or explicit navigation |
| `browser_click` | Click an element by CSS, XPath, or text | Interact with links, buttons, form elements |
| `browser_type` | Type text into an input field | Fill forms, search boxes, login fields |
| `browser_scroll` | Scroll the page or an element into view | Explore long pages, find off-screen content |
| `browser_screenshot` | Capture current page + OCR text | Re-read page without changing anything |
| `browser_read` | Get current page context (no action) | Check if page state changed after an action |
| `browser_evaluate` | Execute arbitrary JavaScript | **Escape hatch** for shadow DOM, complex interactions |

## Dual-Mode Design

**Text-only mode (default)** — screenshots are captured for OCR only, then discarded. Zero image tokens reach the AI. Use this for 90% of cases.

**Visual mode** (`visual: true`) — screenshots are returned as base64 PNG alongside OCR text. Use only when you genuinely need to see colors, layout, or images. Expect 5-10× more tokens.

## Session Persistence

The browser maintains one Playwright Chromium instance per Pi session. All tools share the same page, cookies, and state. This means:

- ✅ After `browser_navigate`, `browser_click` and `browser_type` work on the same page
- ✅ Login sessions persist across tool calls
- ⚠️ `browser_navigate` reloads the page — LinkedIn/GitHub may kill sessions

## Best Practices

> **⚠️ CRITICAL: Prefer `browser_read` + `browser_click` over `browser_navigate`.**
> Every `browser_navigate` triggers a full page load, destroying login sessions and current state.
> Once you're on a site, stay there. Use read/click/type/scroll to move around.
> Only use `browser_navigate` when you genuinely need a completely different URL domain.

### Rule 1: Navigate once, then read & click
```
browser_navigate(url="https://example.com")   ← open the page
browser_read()                                  ← check what's there
browser_click(text="Sign In")                   ← interact
browser_type(selector="#email", text="user")    ← fill form
```

Avoid `browser_navigate` after logging in — it destroys the session.

### Rule 2: Use `headless: false` for visible browsing
The user can see and interact with a visible browser window. After opening with `headless: false`, all subsequent tools inherit this setting — the window stays open.

### Rule 3: Use element indices for precision
The page context returns elements with `[index]` markers. Refer to: `"click element [15] (the Sign In button)"`

### Rule 4: `browser_evaluate` is your shadow DOM escape hatch
When elements live inside shadow DOM (LinkedIn, some React apps), standard clicks fail. Use `browser_evaluate` to query and interact through `el.shadowRoot`:

```js
// Find and click a button inside shadow DOM
const el = document.querySelector('#host').shadowRoot.querySelector('button');
el.click();
```

### Rule 5: Wait after actions
After clicking, the page may need time to load. Use `browser_read` to confirm the new state before the next action.

## Common Patterns

### Form login
```
browser_navigate(url="https://site.com/login", headless=false)
browser_type(selector="#username", text="user")
browser_type(selector="#password", text="pass")
browser_click(selector="button[type='submit']")
browser_read()  ← verify logged in
```

### Explore with filters
```
browser_navigate(url="https://site.com/search")
browser_type(selector="input[placeholder='Search']", text="query")
browser_click(text="Search")
browser_scroll(direction="down", amount=500)
browser_read()
```

### Extract data via JS
```
browser_evaluate(script="Array.from(document.querySelectorAll('.item')).map(el => el.textContent)")
```

## Known Limitations

- **Shadow DOM**: LinkedIn, Salesforce, and some SPA frameworks use shadow DOM that blocks standard clicks. Use `browser_evaluate`.
- **Login sessions**: Some sites (LinkedIn) aggressively expire sessions when navigating. Log in once, then use read/click only.
- **Captchas / 2FA**: Cannot bypass security checks. Ask the user to complete them in the visible browser window.
- **File downloads**: Not supported. Use `browser_evaluate` to extract data as text.
- **OCR accuracy**: Tesseract OCR depends on screenshot quality. Complex layouts, small fonts, or low-contrast text may produce garbled results. When OCR is unreliable, rely on DOM elements instead.
