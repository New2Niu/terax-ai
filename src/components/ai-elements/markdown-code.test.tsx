import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MarkdownCode, markdownCodeText } from "./markdown-code";

// `MermaidDiagram` reads the theme and (while streaming) the chat streaming
// flag; both are mocked so the routing decision can be rendered in isolation
// without the chat store / Tauri surface.
vi.mock("@/modules/theme", () => ({
  useTheme: () => ({ resolvedMode: "dark" }),
}));
vi.mock("./chat-code", () => ({
  ChatCodeBlock: ({ lang }: { code: string; lang: string | null }) =>
    createElement("pre", { "data-chat-code": lang ?? "" }, "chat-code-stub"),
  useChatStreaming: () => false,
}));

describe("markdownCodeText", () => {
  it("preserves text nested inside React children for HTML-wrapped code blocks", async () => {
    const React = await import("react");

    const text = markdownCodeText([
      "\n",
      React.createElement("span", { key: "a" }, 'const client = createClient("");'),
      "\n",
      React.createElement("span", { key: "b" }, 'await client.send({ id: "example" });'),
      "\n",
    ]);

    expect(text).toBe(
      '\nconst client = createClient("");\nawait client.send({ id: "example" });\n',
    );
  });
});

describe("MarkdownCode mermaid routing", () => {
  it("routes language-mermaid to the diagram renderer, not the code block", () => {
    const html = renderToStaticMarkup(
      createElement(
        MarkdownCode,
        { className: "language-mermaid" },
        "graph TD;\n  A-->B;",
      ),
    );

    // MermaidDiagram's loading state: the effect that loads the plugin never
    // runs under SSR, so this proves the routing without needing mermaid.
    expect(html).toContain("Rendering diagram");
    expect(html).not.toContain("chat-code-stub");
  });

  it("routes every other language to the highlighted code block", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownCode, { className: "language-ts" }, "const x = 1;"),
    );

    expect(html).toContain('data-chat-code="ts"');
    expect(html).not.toContain("Rendering diagram");
  });

  it("falls back to a plain inline pill without a language class", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownCode, {}, "inline"),
    );

    expect(html).toContain("<code");
    expect(html).not.toContain("chat-code-stub");
    expect(html).not.toContain("Rendering diagram");
  });

  it("keeps the diagram stack behind a dynamic import in mermaid.tsx", () => {
    const src = readFileSync(new URL("./mermaid.tsx", import.meta.url), "utf8");

    expect(src).toContain('import("@streamdown/mermaid")');
    // No static *value* import (`import type` is erased at compile time).
    expect(src).not.toMatch(
      /^import(?!\s+type)[^\n]*from "@streamdown\/mermaid"/m,
    );
  });
});
