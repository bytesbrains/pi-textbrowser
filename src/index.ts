import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Page, Browser, BrowserContext } from "playwright";

// ── Module-level browser state (one instance per Pi session) ──

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let ocrWorker: any = null;
let currentHeadless = true;

async function getPage(headless?: boolean): Promise<Page> {
  headless = headless ?? currentHeadless;
  if (!page || headless !== currentHeadless) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    currentHeadless = headless;
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    page = await context.newPage();
  }
  return page;
}

async function closeBrowser(): Promise<void> {
  if (ocrWorker) {
    try { await ocrWorker.terminate(); } catch { /* ignore */ }
    ocrWorker = null;
  }
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
    browser = null;
    context = null;
    page = null;
  }
}

// ── OCR helper ──

async function getOcrWorker(): Promise<any | null> {
  if (ocrWorker) return ocrWorker;
  try {
    const { createWorker } = await import("tesseract.js");
    ocrWorker = await createWorker("eng");
    return ocrWorker;
  } catch {
    return null;
  }
}

async function runOcr(buffer: Buffer): Promise<string> {
  const worker = await getOcrWorker();
  if (!worker) return "(OCR unavailable — install tesseract.js)";
  const { data: { text } } = await worker.recognize(buffer);
  return text.trim() || "(no text detected)";
}

// ── Page map generator ──

interface ElementInfo {
  index: number;
  tag: string;
  text?: string;
  attributes: Record<string, string>;
  bbox: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Generate a structured text map of the page.
 *
 * Modes:
 *   text-only (default): screenshot is captured → OCR runs → image is DISCARDED.
 *                        Only DOM + OCR text is returned. Zero image tokens.
 *   visual:              screenshot is captured → OCR text + base64 PNG image
 *                        are both returned. Useful when layout/colors matter.
 */
async function generatePageMap(p: Page, visual = false): Promise<{ text: string; image?: string }> {
  const url = p.url();
  const title = await p.title().catch(() => "(no title)");
  const viewport = p.viewportSize() ?? { width: 1920, height: 1080 };

  // Extract interactive / visible elements with bounding boxes (traverses shadow DOM)
  const elements: ElementInfo[] = await p.evaluate(() => {
    const interactive = new Set([
      "A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "OPTION", "LABEL", "DETAILS", "SUMMARY",
    ]);
    const results: ElementInfo[] = [];
    let index = 0;
    const keepAttrs = ["id", "name", "type", "placeholder", "href", "src", "alt", "role", "aria-label", "value"];

    function processElement(el: Element) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      if (rect.width < 2 || rect.height < 2) return;

      const tag = el.tagName.toLowerCase();
      const isInteractive =
        interactive.has(el.tagName) ||
        (el as HTMLElement).onclick != null ||
        el.getAttribute("role") === "button" ||
        el.getAttribute("role") === "link";

      if (!isInteractive && rect.width * rect.height < 400) return;

      const text = el.textContent?.trim().slice(0, 200) || undefined;
      const attrs: Record<string, string> = {};
      for (const a of keepAttrs) {
        const v = el.getAttribute(a);
        if (v) attrs[a] = v;
      }

      results.push({
        index: ++index,
        tag,
        text,
        attributes: attrs,
        bbox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      });

      // Recurse into shadow DOM
      if ((el as any).shadowRoot) {
        walkTree((el as any).shadowRoot);
      }
    }

    function walkTree(root: Document | ShadowRoot) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        processElement(walker.currentNode as Element);
      }
    }

    walkTree(document);
    return results;
  });

  // Capture screenshot for OCR (and optionally for visual mode)
  let screenshotBuffer: Buffer | null = null;
  let ocrText: string;
  try {
    screenshotBuffer = Buffer.from(await p.screenshot({ type: "png", fullPage: false }));
    ocrText = await runOcr(screenshotBuffer);
  } catch {
    ocrText = "(screenshot/OCR failed)";
  }

  // Build structured text output
  const lines: string[] = [];
  lines.push(`Page: ${url}`);
  lines.push(`Title: ${title}`);
  lines.push(`Viewport: ${viewport.width}x${viewport.height}`);
  lines.push("");

  const interactiveEls = elements.filter(
    (e) =>
      ["a", "button", "input", "textarea", "select"].includes(e.tag) ||
      e.attributes.role === "button" ||
      e.attributes.role === "link"
  );

  lines.push(`Elements (${interactiveEls.length} interactive of ${elements.length} total):`);
  for (const el of interactiveEls.slice(0, 60)) {
    const attrStr = Object.entries(el.attributes)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    const bboxStr = el.bbox
      ? `bbox=(${el.bbox.x},${el.bbox.y},${el.bbox.x + el.bbox.width},${el.bbox.y + el.bbox.height})`
      : "";
    lines.push(`  [${el.index}] <${el.tag}> ${attrStr}${attrStr ? " " : ""}${bboxStr}`);
    if (el.text && el.text.length > 1) {
      lines.push(`      text: "${el.text.replace(/\n/g, " ")}"`);
    }
  }
  if (interactiveEls.length > 60) {
    lines.push(`  ... (${interactiveEls.length - 60} more interactive elements hidden)`);
  }

  lines.push("");
  lines.push("OCR (full page screenshot):");
  lines.push(ocrText || "(no text detected)");

  const text = lines.join("\n");

  // ── Mode: text-only ──
  // Screenshot was captured only for OCR processing. Image is discarded.
  // Zero image tokens reach the AI.
  if (!visual) {
    return { text };
  }

  // ── Mode: visual ──
  // Include the base64-encoded PNG so the AI can see colors, layout, etc.
  const image = screenshotBuffer?.toString("base64");
  return { text, image };
}

// ── Extension ──

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "browser_navigate",
    label: "Browser Navigate",
    description: "Open a URL in the browser and return the page context (DOM + OCR). Default text-only mode captures screenshots only for OCR — no image tokens. Set visual=true to receive the actual PNG.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to open" }),
      headless: Type.Optional(Type.Boolean({ description: "Run headless (default true)" })),
      visual: Type.Optional(Type.Boolean({ description: "Return base64 PNG screenshot alongside text (default false = text-only, zero image tokens)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate) {
      const p = await getPage(params.headless !== false);
      await p.goto(params.url, { waitUntil: "load", timeout: 30000 });
      const { text, image } = await generatePageMap(p, params.visual);
      const content: any[] = [{ type: "text", text }];
      if (image) {
        content.push({ type: "image", source: { type: "base64", mediaType: "image/png", data: image } });
      }
      return { content, details: { url: p.url() } };
    },
  });

  pi.registerTool({
    name: "browser_click",
    label: "Browser Click",
    description: "Click an element by CSS selector, XPath, or visible text. Returns updated page context.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "CSS selector" })),
      xpath: Type.Optional(Type.String({ description: "XPath expression" })),
      text: Type.Optional(Type.String({ description: "Visible text content to match" })),
      visual: Type.Optional(Type.Boolean({ description: "Return base64 PNG screenshot alongside text (default false = text-only, zero image tokens)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate) {
      const p = await getPage();
      if (params.selector) {
        await p.locator(params.selector).first().click({ timeout: 10000, force: true });
      } else if (params.xpath) {
        await p.locator(`xpath=${params.xpath}`).first().click({ timeout: 10000, force: true });
      } else if (params.text) {
        await p.getByText(params.text, { exact: false }).first().click({ timeout: 10000, force: true });
      } else {
        return { content: [{ type: "text", text: "Error: provide selector, xpath, or text" }], isError: true, details: {} };
      }
      await p.waitForTimeout(500);
      const { text, image } = await generatePageMap(p, params.visual);
      const content: any[] = [{ type: "text", text }];
      if (image) {
        content.push({ type: "image", source: { type: "base64", mediaType: "image/png", data: image } });
      }
      return { content, details: {} };
    },
  });

  pi.registerTool({
    name: "browser_type",
    label: "Browser Type",
    description: "Type text into an input field. Returns updated page context.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for the input" }),
      text: Type.String({ description: "Text to type" }),
      clear: Type.Optional(Type.Boolean({ description: "Clear existing content first (default true)" })),
      visual: Type.Optional(Type.Boolean({ description: "Return base64 PNG screenshot alongside text (default false = text-only, zero image tokens)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate) {
      const p = await getPage();
      const locator = p.locator(params.selector).first();
      if (params.clear !== false) {
        await locator.fill(params.text);
      } else {
        await locator.pressSequentially(params.text);
      }
      const { text, image } = await generatePageMap(p, params.visual);
      const content: any[] = [{ type: "text", text }];
      if (image) {
        content.push({ type: "image", source: { type: "base64", mediaType: "image/png", data: image } });
      }
      return { content, details: {} };
    },
  });

  pi.registerTool({
    name: "browser_scroll",
    label: "Browser Scroll",
    description: "Scroll the page or a specific element. Returns updated page context.",
    parameters: Type.Object({
      direction: Type.String({ description: "Direction: up, down, left, right, or 'to' (element)" }),
      amount: Type.Optional(Type.Number({ description: "Pixels to scroll (default 800)" })),
      selector: Type.Optional(Type.String({ description: "CSS selector to scroll into view" })),
      visual: Type.Optional(Type.Boolean({ description: "Return base64 PNG screenshot alongside text (default false = text-only, zero image tokens)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate) {
      const p = await getPage();
      if (params.selector) {
        await p.locator(params.selector).first().scrollIntoViewIfNeeded({ timeout: 10000 });
      } else {
        const dir = params.direction ?? "down";
        const amt = params.amount ?? 800;
        const delta = dir === "up" || dir === "left" ? -amt : amt;
        const isVertical = dir === "up" || dir === "down";
        await p.evaluate(({ d, vertical }) => {
          if (vertical) window.scrollBy(0, d);
          else window.scrollBy(d, 0);
        }, { d: delta, vertical: isVertical });
      }
      await p.waitForTimeout(300);
      const { text, image } = await generatePageMap(p, params.visual);
      const content: any[] = [{ type: "text", text }];
      if (image) {
        content.push({ type: "image", source: { type: "base64", mediaType: "image/png", data: image } });
      }
      return { content, details: {} };
    },
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description: "Capture the current page and return an OCR-based text map. Set visual=true to also receive the PNG.",
    parameters: Type.Object({
      fullPage: Type.Optional(Type.Boolean({ description: "Capture full page height (default false)" })),
      visual: Type.Optional(Type.Boolean({ description: "Return base64 PNG screenshot alongside text (default false = text-only, zero image tokens)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate) {
      const p = await getPage();
      const { text, image } = await generatePageMap(p, params.visual);
      const content: any[] = [{ type: "text", text }];
      if (image) {
        content.push({ type: "image", source: { type: "base64", mediaType: "image/png", data: image } });
      }
      return { content, details: { fullPage: params.fullPage ?? false } };
    },
  });

  pi.registerTool({
    name: "browser_read",
    label: "Browser Read",
    description: "Get the current page context (DOM + OCR text map) without changing anything.",
    parameters: Type.Object({
      visual: Type.Optional(Type.Boolean({ description: "Return base64 PNG screenshot alongside text (default false = text-only, zero image tokens)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate) {
      const p = await getPage();
      const { text, image } = await generatePageMap(p, params.visual);
      const content: any[] = [{ type: "text", text }];
      if (image) {
        content.push({ type: "image", source: { type: "base64", mediaType: "image/png", data: image } });
      }
      return { content, details: {} };
    },
  });

  pi.registerTool({
    name: "browser_evaluate",
    label: "Browser Evaluate",
    description: "Execute JavaScript in the page context and return the result.",
    parameters: Type.Object({
      script: Type.String({ description: "JavaScript code to run" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate) {
      const p = await getPage();
      const result = await p.evaluate((script) => eval(script), params.script);
      const text = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
      return { content: [{ type: "text", text }], details: { result } };
    },
  });

  pi.on("session_shutdown", async () => {
    await closeBrowser();
  });
}
