import { invoke } from "@tauri-apps/api/core";
import { IS_MAC } from "./platform";

const NERD_FONT_CANDIDATES = [
  "JetBrainsMono Nerd Font",
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMonoNL Nerd Font",
  "FiraCode Nerd Font",
  "FiraCode Nerd Font Mono",
  "MesloLGS NF",
  "MesloLGM Nerd Font",
  "Hack Nerd Font",
  "Hack Nerd Font Mono",
  "CaskaydiaCove Nerd Font",
  "CaskaydiaMono Nerd Font",
  "Iosevka Nerd Font",
  "Iosevka Term Nerd Font",
  "SauceCodePro Nerd Font",
  "Hasklug Nerd Font",
];

const FALLBACK_CHAIN = '"JetBrains Mono", SFMono-Regular, Menlo, monospace';

let detected: string | null = null;
let monoReady: Promise<void> | null = null;

export function ensureMonoFontsLoaded(): Promise<void> {
  if (monoReady) return monoReady;
  if (typeof document === "undefined" || !document.fonts?.load) {
    monoReady = Promise.resolve();
    return monoReady;
  }
  monoReady = Promise.allSettled([
    document.fonts.load('400 14px "JetBrains Mono"'),
    document.fonts.load('700 14px "JetBrains Mono"'),
  ]).then(() => undefined);
  return monoReady;
}

export function resolveFontFamily(userInput: string): string {
  const name = userInput.trim();
  if (!name) return detectMonoFontFamily();
  // A comma means the user gave a full stack; otherwise quote the single family.
  // Strip any quotes first so a stray quote can't produce a malformed token.
  const head = name.includes(",") ? name : `"${name.replace(/['"]/g, "")}"`;
  return `${head}, ${FALLBACK_CHAIN}`;
}

let revision = 0;
const revisionListeners = new Set<() => void>();

/** Bumped when a registered font makes `detectMonoFontFamily` change its answer. */
export function fontsRevision(): number {
  return revision;
}

export function subscribeFontsRevision(listener: () => void): () => void {
  revisionListeners.add(listener);
  return () => {
    revisionListeners.delete(listener);
  };
}

/**
 * Drops a failed auto-detect result once its font was registered, so the next
 * `resolveFontFamily("")` probes a canvas that can see it, and tells
 * subscribers to derive their font again. A detection that already found a
 * Nerd Font keeps its answer.
 */
function invalidateDetectedMonoFont(): void {
  if (detected !== FALLBACK_CHAIN) return;
  detected = null;
  revision += 1;
  for (const listener of revisionListeners) listener();
}

export function detectMonoFontFamily(): string {
  if (detected) return detected;
  if (typeof document === "undefined") {
    detected = FALLBACK_CHAIN;
    return detected;
  }
  const context = document.createElement("canvas").getContext("2d");
  if (context) {
    const sample = "Wim0123\ue0a0\ue718";
    const fallbacks = ["monospace", "serif"];
    const widths = fallbacks.map((fallback) => {
      context.font = `16px ${fallback}`;
      return context.measureText(sample).width;
    });
    for (const font of NERD_FONT_CANDIDATES) {
      if (
        fallbacks.some((fallback, index) => {
          context.font = `16px "${font}", ${fallback}`;
          return context.measureText(sample).width !== widths[index];
        })
      ) {
        detected = `"${font}", ${FALLBACK_CHAIN}`;
        return detected;
      }
    }
  }
  detected = FALLBACK_CHAIN;
  return detected;
}

const INSTALLED_FACE_STYLES = [
  { style: "Regular", weight: "400" },
  { style: "Bold", weight: "700" },
] as const;

const installedFamilies = new Map<string, Promise<void>>();

/** First family in a CSS font-family list, unquoted; null for blank input. */
export function primaryFamily(cssFamily: string): string | null {
  const first = cssFamily
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return first ? first : null;
}

/**
 * Registers the installed family's Regular and Bold faces as `FontFace`s so
 * canvas glyph rasterization can use them. WKWebView canvas does not resolve
 * user-installed fonts by name, so the terminal would otherwise draw Nerd Font
 * glyphs with the system monospace. Families that are not installed resolve
 * with nothing registered and the CSS fallback chain keeps applying. Only macOS
 * has font directories for the lookup (see `modules/fonts.rs`), so other
 * platforms skip it.
 */
export function ensureInstalledFontLoaded(cssFamily: string): Promise<void> {
  const family = primaryFamily(cssFamily);
  if (
    !IS_MAC ||
    !family ||
    typeof document === "undefined" ||
    !document.fonts
  ) {
    return Promise.resolve();
  }
  let pending = installedFamilies.get(family);
  if (!pending) {
    pending = loadInstalledFaces(family);
    installedFamilies.set(family, pending);
  }
  return pending;
}

async function loadInstalledFaces(family: string): Promise<void> {
  await Promise.all(
    INSTALLED_FACE_STYLES.map(async ({ style, weight }) => {
      const data = await invoke<ArrayBuffer>("fonts_read_installed", {
        family,
        style,
      }).catch(() => null);
      if (!data) return;
      try {
        const face = new FontFace(family, data, { weight });
        await face.load();
        document.fonts.add(face);
      } catch (error) {
        console.warn(
          `Could not register installed font ${family} ${style}`,
          error,
        );
      }
    }),
  );
}

let autoDetect: Promise<void> | null = null;

/**
 * Registers the installed Nerd Font an empty `terminalFontFamily` should
 * auto-detect. WKWebView canvas resolves neither user-installed fonts by name
 * nor `document.fonts.check` for them, so the native side picks the candidate
 * first and this registers it before the canvas probe runs. Cached per window;
 * skipped where the native lookup does not exist.
 */
export function ensureAutoDetectNerdFont(): Promise<void> {
  if (!autoDetect) autoDetect = autoDetectNerdFont();
  return autoDetect;
}

async function autoDetectNerdFont(): Promise<void> {
  if (!IS_MAC || typeof document === "undefined" || !document.fonts) return;
  const family = await invoke<string | null>("fonts_find_installed", {
    candidates: NERD_FONT_CANDIDATES,
  }).catch(() => null);
  if (typeof family !== "string" || !family) return;
  await ensureInstalledFontLoaded(family);
  invalidateDetectedMonoFont();
}
