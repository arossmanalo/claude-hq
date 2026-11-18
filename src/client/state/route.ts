import type { View } from "./officeStore";

/** `#/` is the building; `#/office/<project key>[/<session id>]` is one office. */
export function viewFromHash(hash: string): View {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "office" && parts[1]) {
    return {
      kind: "office",
      projectKey: decodeURIComponent(parts[1]),
      sessionId: parts[2] ? decodeURIComponent(parts[2]) : null,
    };
  }
  return { kind: "building" };
}

export function hashFromView(view: View): string {
  if (view.kind === "building") return "#/";
  const base = `#/office/${encodeURIComponent(view.projectKey)}`;
  return view.sessionId ? `${base}/${encodeURIComponent(view.sessionId)}` : base;
}
