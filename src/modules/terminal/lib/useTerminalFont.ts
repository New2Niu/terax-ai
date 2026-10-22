import {
  detectMonoFontFamily,
  ensureAutoDetectNerdFont,
  resolveFontFamily,
  subscribeFontsRevision,
} from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { resolveTerminalFont, useTheme } from "@/modules/theme";
import { useEffect, useSyncExternalStore } from "react";

/**
 * The terminal font stack for this window. The auto-detected family is read as
 * the external-store snapshot rather than a plain call: detection lives in a
 * module cache, so consumers only see the value change, and re-apply the font,
 * when it is part of the snapshot.
 */
export function useTerminalFont() {
  const fontFamily = usePreferencesStore((p) => p.terminalFontFamily);
  const fontWeight = usePreferencesStore((p) => p.terminalFontWeight);
  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const { activeTheme, resolvedMode } = useTheme();
  const detected = useSyncExternalStore(
    subscribeFontsRevision,
    detectMonoFontFamily,
    detectMonoFontFamily,
  );

  useEffect(() => {
    if (fontFamily.trim()) return;
    void ensureAutoDetectNerdFont();
  }, [fontFamily]);

  const resolved = resolveTerminalFont(
    { fontFamily, fontWeight, fontSize },
    activeTheme,
    resolvedMode,
  );
  return {
    ...resolved,
    fontFamily: resolved.fontFamily.trim()
      ? resolveFontFamily(resolved.fontFamily)
      : detected,
  };
}
