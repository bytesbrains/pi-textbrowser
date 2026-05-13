# TextBrowser for Pi

> Browse the web with **structured text** instead of raw screenshots. **10-50x cheaper** than vision-model approaches.

```
┌─────────────┐     browser_navigate(url)     ┌─────────────┐
│   Pi Agent  │ ─────────────────────────────>│  Playwright │
│  (you)      │                               │   Chromium  │
│             │ <─ DOM + OCR text map ────────│             │
└─────────────┘        (~200 tokens)          └─────────────┘
```

## Why TextBrowser?

| Approach | ~Tokens | Relative Cost |
|---|---|---|
| PNG 1920×1080 (vision model) | ~1,500–3,000 | 100% |
| **TextBrowser (text-only)** | **~150–400** | **5–15%** |

Vision-model screenshots burn thousands of tokens per page. TextBrowser captures the **DOM structure** + runs **OCR** on a screenshot, then **discards the image**. Only clean, structured text reaches the AI. You get element lists, bounding boxes, visible text, and OCR content — all for a fraction of the cost.

Need to see colors or layout? Flip to **visual mode** and get the PNG too.

## Install

```bash
pi install npm:pi-textbrowser
```

Or add to your `.pi/settings.json`:

```json
{
  "packages": ["npm:pi-textbrowser"]
}
```

## Tools

| Tool | What it does |
|---|---|
| `browser_navigate` | Open a URL, return page context |
| `browser_click` | Click by selector / text / XPath |
| `browser_type` | Fill input fields |
| `browser_scroll` | Scroll page or element into view |
| `browser_screenshot` | Capture current page context |
| `browser_read` | Read current page without changing it |
| `browser_evaluate` | Run JavaScript in the page |

## Dual-Mode Design

### Text-only mode (default)

```
browser_navigate(url="https://example.com")
```

- Screenshot is captured **only for OCR**
- Image is **discarded immediately**
- Returns: structured DOM elements + OCR text
- **Zero image tokens** reach the AI

### Visual mode

```
browser_navigate(url="https://example.com", visual=true)
```

- Screenshot captured for OCR **and** returned as base64 PNG
- Returns: text map + actual image
- Use when colors, layout, or visual design matter

## Example Session

```
You: Open https://littlevoice.club and explore the games

→ browser_navigate(url="https://littlevoice.club")

Page: https://littlevoice.club/
Title: Little Voice Club — Stories, Games, Songs & Fun for Kids
Viewport: 1920x1080

Elements (70 interactive of 330 total):
  [11] <a> href="/games" text="🎮 Play Games"
  [12] <a> href="/stories" text="🌙 Stories"
  ...

OCR (full page screenshot):
Stories, songs & games for curious little minds
...

→ browser_click(text="🎮 Play Games")

Page: https://littlevoice.club/games
Title: Games — Little Voice Club
...
```

## Requirements

- Node.js 18+
- Playwright browsers installed: `npx playwright install chromium`

## License

MIT
