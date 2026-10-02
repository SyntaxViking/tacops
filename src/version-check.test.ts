import { describe, expect, it } from "vitest";
import { extractMainScriptSrc } from "./version-check";

describe("extractMainScriptSrc", () => {
  it("extracts the hashed main bundle's src from a real index.html shape", () => {
    const html = `<!doctype html><html><head></head><body><div id="root"></div><script type="module" crossorigin src="/assets/main-BhZqNjhE.js"></script></body></html>`;
    expect(extractMainScriptSrc(html)).toBe("/assets/main-BhZqNjhE.js");
  });

  it("returns null when there's no matching script tag", () => {
    expect(extractMainScriptSrc("<html><body>no scripts here</body></html>")).toBeNull();
  });

  it("isn't confused by other /assets/ scripts (e.g. a worker chunk) that aren't the main bundle", () => {
    const html = `<script src="/assets/board-solver.worker-CtyyAEbE.js"></script><script src="/assets/main-zT64XUxo.js"></script>`;
    expect(extractMainScriptSrc(html)).toBe("/assets/main-zT64XUxo.js");
  });
});
