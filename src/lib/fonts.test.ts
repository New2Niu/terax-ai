import { afterEach, describe, expect, it, vi } from "vitest";
import { primaryFamily, resolveFontFamily } from "./fonts";

const FALLBACK = '"JetBrains Mono", SFMono-Regular, Menlo, monospace';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("terminal font availability", () => {
  it("does not accept an absent font when FontFaceSet.check returns true", async () => {
    const context = {
      font: "",
      measureText: () => ({
        width:
          context.font.endsWith("serif") && !context.font.endsWith("monospace")
            ? 110
            : 100,
      }),
    };
    vi.stubGlobal("document", {
      fonts: { check: () => true },
      createElement: () => ({ getContext: () => context }),
    });
    const { detectMonoFontFamily } = await import("./fonts");
    expect(detectMonoFontFamily()).toBe(FALLBACK);
  });

  it("finds an installed later candidate and caches its measurements", async () => {
    const context = {
      font: "",
      measureText: vi.fn(() => ({
        width: context.font.includes('"Hack Nerd Font"')
          ? 130
          : context.font.endsWith(", serif") || context.font === "16px serif"
            ? 110
            : 100,
      })),
    };
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => context }),
    });
    const { detectMonoFontFamily } = await import("./fonts");
    expect(detectMonoFontFamily()).toBe(`"Hack Nerd Font", ${FALLBACK}`);
    const calls = context.measureText.mock.calls.length;
    detectMonoFontFamily();
    expect(context.measureText).toHaveBeenCalledTimes(calls);
  });

  it("loads text fonts before canvas rasterization, only once per window", async () => {
    const load = vi.fn(async () => []);
    vi.stubGlobal("document", { fonts: { load } });
    const { ensureMonoFontsLoaded } = await import("./fonts");
    const first = ensureMonoFontsLoaded();
    expect(ensureMonoFontsLoaded()).toBe(first);
    await first;
    expect(load).toHaveBeenCalledWith('400 14px "JetBrains Mono"');
    expect(load).toHaveBeenCalledWith('700 14px "JetBrains Mono"');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("resolveFontFamily", () => {
  it("quotes a bare family and appends the mono fallback", () => {
    expect(resolveFontFamily("JetBrainsMono Nerd Font")).toBe(
      `"JetBrainsMono Nerd Font", ${FALLBACK}`,
    );
  });

  it("does not double-quote an already-quoted family", () => {
    expect(resolveFontFamily('"Fira Code"')).toBe(`"Fira Code", ${FALLBACK}`);
  });

  it("passes a comma-separated stack through and still appends fallback", () => {
    expect(resolveFontFamily("Foo, Bar")).toBe(`Foo, Bar, ${FALLBACK}`);
  });

  it("strips stray internal quotes to avoid a malformed token", () => {
    expect(resolveFontFamily('Foo"Bar')).toBe(`"FooBar", ${FALLBACK}`);
  });

  it("trims surrounding whitespace before quoting", () => {
    expect(resolveFontFamily("  Hack Nerd Font  ")).toBe(
      `"Hack Nerd Font", ${FALLBACK}`,
    );
  });

  it("falls back to the mono chain for empty input", () => {
    expect(resolveFontFamily("")).toBe(FALLBACK);
    expect(resolveFontFamily("   ")).toBe(FALLBACK);
  });
});

describe("primaryFamily", () => {
  it("returns the first unquoted family of a stack", () => {
    expect(primaryFamily('"MesloLGS NF", "JetBrains Mono", monospace')).toBe(
      "MesloLGS NF",
    );
  });

  it("returns a single bare family", () => {
    expect(primaryFamily("Hack Nerd Font Mono")).toBe("Hack Nerd Font Mono");
  });

  it("returns null for blank input", () => {
    expect(primaryFamily("   ")).toBeNull();
  });
});

describe("ensureInstalledFontLoaded", () => {
  it("skips the font lookup on platforms other than macOS", async () => {
    vi.resetModules();
    vi.doMock("./platform", () => ({ IS_MAC: false }));
    const invoke = vi.fn(async () => new ArrayBuffer(8));
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    const { ensureInstalledFontLoaded } = await import("./fonts");

    await ensureInstalledFontLoaded('"Linux Only Font", monospace');

    expect(invoke).not.toHaveBeenCalled();
    vi.doUnmock("./platform");
    vi.doUnmock("@tauri-apps/api/core");
  });

  it("resolves and keeps other faces when one face cannot be constructed", async () => {
    vi.resetModules();
    vi.doMock("./platform", () => ({ IS_MAC: true }));
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn(async () => new ArrayBuffer(8)),
    }));
    let constructed = 0;
    class FakeFontFace {
      constructor(
        readonly family: string,
        _data: ArrayBuffer,
        readonly descriptors: { weight: string },
      ) {
        constructed += 1;
        if (constructed === 1) throw new Error("bad font data");
      }
      async load() {}
    }
    const add = vi.fn();
    vi.stubGlobal("FontFace", FakeFontFace);
    vi.stubGlobal("document", { fonts: { add, load: vi.fn() } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ensureInstalledFontLoaded } = await import("./fonts");

    await expect(
      ensureInstalledFontLoaded('"Broken Test Font", monospace'),
    ).resolves.toBeUndefined();

    expect(add).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    vi.doUnmock("./platform");
    vi.doUnmock("@tauri-apps/api/core");
  });
});

describe("ensureAutoDetectNerdFont", () => {
  it("registers the installed candidate and re-runs a failed detection", async () => {
    vi.resetModules();
    vi.doMock("./platform", () => ({ IS_MAC: true }));
    const invoke = vi.fn(async (command: string) =>
      command === "fonts_find_installed"
        ? "Hack Nerd Font"
        : new ArrayBuffer(8),
    );
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    let registered = false;
    const context = {
      font: "",
      measureText: () => ({
        width:
          registered && context.font.includes('"Hack Nerd Font"') ? 130 : 100,
      }),
    };
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => context }),
      fonts: { add: vi.fn(), load: vi.fn() },
    });
    vi.stubGlobal(
      "FontFace",
      class {
        async load() {
          registered = true;
        }
      },
    );
    const {
      detectMonoFontFamily,
      ensureAutoDetectNerdFont,
      fontsRevision,
      resolveFontFamily,
      subscribeFontsRevision,
    } = await import("./fonts");

    // The canvas cannot see a user-installed font before it is registered.
    expect(detectMonoFontFamily()).toBe(FALLBACK);
    const listener = vi.fn();
    const unsubscribe = subscribeFontsRevision(listener);

    await ensureAutoDetectNerdFont();

    expect(invoke).toHaveBeenCalledWith("fonts_find_installed", {
      candidates: expect.arrayContaining(["Hack Nerd Font"]),
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fontsRevision()).toBeGreaterThan(0);
    expect(resolveFontFamily("")).toBe(`"Hack Nerd Font", ${FALLBACK}`);
    unsubscribe();
    vi.doUnmock("./platform");
    vi.doUnmock("@tauri-apps/api/core");
  });

  it("keeps a detection that already found a Nerd Font", async () => {
    vi.resetModules();
    vi.doMock("./platform", () => ({ IS_MAC: true }));
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn(async (command: string) =>
        command === "fonts_find_installed"
          ? "JetBrainsMono Nerd Font"
          : new ArrayBuffer(8),
      ),
    }));
    const context = {
      font: "",
      measureText: () => ({
        width: context.font.includes('"JetBrainsMono Nerd Font"') ? 130 : 100,
      }),
    };
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => context }),
      fonts: { add: vi.fn(), load: vi.fn() },
    });
    vi.stubGlobal(
      "FontFace",
      class {
        async load() {}
      },
    );
    const {
      detectMonoFontFamily,
      ensureAutoDetectNerdFont,
      resolveFontFamily,
      subscribeFontsRevision,
    } = await import("./fonts");

    const expected = `"JetBrainsMono Nerd Font", ${FALLBACK}`;
    expect(detectMonoFontFamily()).toBe(expected);
    const listener = vi.fn();
    const unsubscribe = subscribeFontsRevision(listener);

    await ensureAutoDetectNerdFont();

    expect(listener).not.toHaveBeenCalled();
    expect(resolveFontFamily("")).toBe(expected);
    unsubscribe();
    vi.doUnmock("./platform");
    vi.doUnmock("@tauri-apps/api/core");
  });

  it("does not ask native for other platforms or without a match", async () => {
    vi.resetModules();
    vi.doMock("./platform", () => ({ IS_MAC: false }));
    const invoke = vi.fn(async () => "Hack Nerd Font");
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    const { ensureAutoDetectNerdFont } = await import("./fonts");

    await ensureAutoDetectNerdFont();

    expect(invoke).not.toHaveBeenCalled();
    vi.doUnmock("./platform");
    vi.doUnmock("@tauri-apps/api/core");

    vi.resetModules();
    vi.doMock("./platform", () => ({ IS_MAC: true }));
    const lookup = vi.fn(async () => null);
    vi.doMock("@tauri-apps/api/core", () => ({ invoke: lookup }));
    vi.stubGlobal("document", { fonts: {} });
    const listeners = await import("./fonts");
    const listener = vi.fn();
    const unsubscribe = listeners.subscribeFontsRevision(listener);

    await listeners.ensureAutoDetectNerdFont();

    expect(listener).not.toHaveBeenCalled();
    expect(listeners.fontsRevision()).toBe(0);
    expect(lookup).toHaveBeenCalledWith("fonts_find_installed", {
      candidates: expect.any(Array),
    });
    unsubscribe();
    vi.doUnmock("./platform");
    vi.doUnmock("@tauri-apps/api/core");
  });
});
