import {
  ensureAutoDetectNerdFont,
  fontsRevision,
  subscribeFontsRevision,
} from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { resolveTerminalFont, useTheme } from "@/modules/theme";
import { useEffect, useSyncExternalStore } from "react";

export function useTerminalFont() {
  const fontFamily = usePreferencesStore((p) => p.terminalFontFamily);
  const fontWeight = usePreferencesStore((p) => p.terminalFontWeight);
  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const { activeTheme, resolvedMode } = useTheme();
  // Re-derives the font when auto-detect registers an installed Nerd Font.
  useSyncExternalStore(subscribeFontsRevision, fontsRevision, fontsRevision);

  useEffect(() => {
    if (fontFamily.trim()) return;
    void ensureAutoDetectNerdFont();
  }, [fontFamily]);

  return resolveTerminalFont(
    { fontFamily, fontWeight, fontSize },
    activeTheme,
    resolvedMode,
  );
}
