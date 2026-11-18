import { useEffect } from "react";
import { useOfficeStore, type View } from "./officeStore";
import { hashFromView, viewFromHash } from "./route";

/** Keeps the store's view in step with the URL hash, so Back and bookmarks work. */
export function useHashRoute(): void {
  const setView = useOfficeStore((state) => state.setView);
  useEffect(() => {
    const sync = () => setView(viewFromHash(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [setView]);
}

export function navigate(view: View): void {
  window.location.hash = hashFromView(view);
}
