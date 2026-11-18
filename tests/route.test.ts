import { describe, expect, it } from "vitest";
import { hashFromView, viewFromHash } from "../src/client/state/route";
import type { View } from "../src/client/state/officeStore";

describe("hash routes", () => {
  it.each<View>([
    { kind: "building" },
    { kind: "office", projectKey: "d:\\ai workspace\\shop", sessionId: null },
    { kind: "office", projectKey: "/home/me/shop", sessionId: "abc-123" },
    { kind: "new", cwd: "D:\\Projects\\New App" },
  ])("round-trips %o", (view) => {
    expect(viewFromHash(hashFromView(view))).toEqual(view);
  });

  it("falls back to the building for anything it doesn't know", () => {
    expect(viewFromHash("#/nowhere")).toEqual({ kind: "building" });
    expect(viewFromHash("")).toEqual({ kind: "building" });
  });
});
