import type { View } from "./officeStore";

/**
 * `#/` is the building, `#/office/<project key>[/<session id>]` is one office, and
 * `#/new/<folder>` is an office for a folder with no sessions yet.
 */
export function viewFromHash(hash: string): View {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "office" && parts[1]) {
    return {
      kind: "office",
      projectKey: decodeURIComponent(parts[1]),
      sessionId: parts[2] ? decodeURIComponent(parts[2]) : null,
    };
  }
  if (parts[0] === "new" && parts[1]) {
    return { kind: "new", cwd: decodeURIComponent(parts[1]) };
  }
  return { kind: "building" };
}

export function hashFromView(view: View): string {
  switch (view.kind) {
    case "building":
      return "#/";
    case "new":
      return `#/new/${encodeURIComponent(view.cwd)}`;
    case "office": {
      const base = `#/office/${encodeURIComponent(view.projectKey)}`;
      return view.sessionId ? `${base}/${encodeURIComponent(view.sessionId)}` : base;
    }
  }
}
