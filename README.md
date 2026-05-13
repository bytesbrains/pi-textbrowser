# TextBrowser for Pi

[![npm version](https://img.shields.io/npm/v/pi-textbrowser)](https://www.npmjs.com/package/pi-textbrowser)
[![license](https://img.shields.io/npm/l/pi-textbrowser)](./LICENSE)

> Headless browser extension for Pi — browse the web with **structured DOM + OCR text maps**. **10-50x cheaper** than screenshot-based browsing.

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
You: Open https://example.com and explore the page

→ browser_navigate(url="https://example.com")

Page: https://example.com/
Title: Example Domain
Viewport: 1920x1080

Elements (14 interactive of 82 total):
  [3] <a> href="https://iana.org/domains/example" text="More information..."
  ...

OCR (full page screenshot):
Example Domain
This domain is for use in illustrative examples in documents.
...
```

## Requirements

- Node.js 18+
- Pi coding agent installed
- Playwright Chromium: `npx playwright install chromium`

## License

MIT © [nandal](https://github.com/nandal)
