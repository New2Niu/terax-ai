"use client";

import type { DiagramPlugin } from "@streamdown/mermaid";
import { useTheme } from "@/modules/theme";
import { useEffect, useState } from "react";

import { ChatCodeBlock, useChatStreaming } from "./chat-code";

type Status =
  | { kind: "loading" }
  | { kind: "ready"; svg: string }
  | { kind: "error" };

// The plugin package statically imports `mermaid`, so this dynamic import keeps
// the whole diagram stack out of the eager bundle. One plugin instance is shared
// across every diagram in the window: `mermaid` is a module-level singleton
// whose `initialize` mutates global config, so per-theme instances would race.
// The theme is instead passed to `getMermaid` before every render, which
// re-initializes mermaid with the right config (the pattern streamdown uses).
let instancePromise: Promise<DiagramPlugin> | null = null;
function loadInstance(): Promise<DiagramPlugin> {
  instancePromise ??= import("@streamdown/mermaid").then(
    (mod) => mod.createMermaidPlugin(),
  );
  return instancePromise;
}

export function mermaidThemeFor(mode: "dark" | "light"): string {
  return mode === "dark" ? "dark" : "default";
}

function configFor(theme: string): Record<string, unknown> {
  return {
    theme,
    securityLevel: "strict",
    startOnLoad: false,
    // Surface parse failures as thrown errors instead of injecting an error
    // SVG, so a broken diagram falls back to readable source.
    suppressErrorRendering: true,
  };
}

let renderSeq = 0;

/**
 * Renders a `mermaid` fenced block as an SVG diagram. Lazy: neither the plugin
 * package nor `mermaid` is loaded until a diagram is actually shown. On any
 * failure it falls back to the normal highlighted code block so the source
 * stays readable.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const streaming = useChatStreaming();
  const { resolvedMode } = useTheme();
  const theme = mermaidThemeFor(resolvedMode);
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    if (streaming) return;
    let cancelled = false;
    setStatus({ kind: "loading" });
    loadInstance()
      .then((instance) => {
        renderSeq += 1;
        return instance
          .getMermaid(configFor(theme))
          .render(`terax-mermaid-${renderSeq}`, code);
      })
      .then(({ svg }) => {
        if (cancelled) return;
        setStatus(svg ? { kind: "ready", svg } : { kind: "error" });
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme, streaming]);

  // While the parent message is still streaming the source is incomplete and
  // cannot parse yet; keep the calm code placeholder instead of a parse error.
  if (streaming) return <ChatCodeBlock code={code} lang="mermaid" />;
  if (status.kind === "error") return <ChatCodeBlock code={code} lang="mermaid" />;

  if (status.kind === "loading") {
    return (
      <div className="not-prose my-2 flex min-h-24 items-center justify-center rounded-lg border border-border/50 bg-muted/20 px-3 py-4 text-[11px] text-muted-foreground">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div className="not-prose my-2 overflow-x-auto rounded-lg border border-border/50 bg-muted/20 px-3 py-3">
      <div
        className="flex justify-center [&>svg]:h-auto [&>svg]:max-w-full"
        role="img"
        // Mermaid runs with securityLevel:"strict", which sanitizes labels and
        // blocks script; this matches how streamdown injects its own SVG.
        dangerouslySetInnerHTML={{ __html: status.svg }}
      />
    </div>
  );
}
