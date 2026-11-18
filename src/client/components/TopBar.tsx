import { useOfficeStore } from "../state/officeStore";
import { navigate } from "../state/useHashRoute";
import { SoundControls } from "./SoundControls";
import styles from "./TopBar.module.css";

const CONNECTION_TEXT = {
  connecting: "Connecting…",
  open: "Connected",
  closed: "Server offline, retrying",
} as const;

export function TopBar() {
  const view = useOfficeStore((state) => state.view);
  const connectionState = useOfficeStore((state) => state.connection);
  const projects = useOfficeStore((state) => state.projects);
  const permissions = useOfficeStore((state) => state.permissions);
  const place =
    view.kind === "office"
      ? (projects.find((candidate) => candidate.key === view.projectKey)?.name ?? "Office")
      : view.kind === "new"
        ? (view.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "New office")
        : null;

  return (
    <header className={styles.bar}>
      <nav className={styles.crumbs} aria-label="Location">
        <button
          type="button"
          className={styles.brand}
          onClick={() => navigate({ kind: "building" })}
          aria-current={view.kind === "building" ? "page" : undefined}
        >
          Claude Office
        </button>
        {place && (
          <>
            <span className={styles.separator} aria-hidden="true">
              /
            </span>
            <span className={styles.current} aria-current="page">
              {place}
            </span>
          </>
        )}
      </nav>
      <div className={styles.status}>
        <SoundControls />
        {permissions.length > 0 && (
          <span className={styles.attention}>
            {permissions.length === 1 ? "1 approval waiting" : `${permissions.length} approvals waiting`}
          </span>
        )}
        <span className={styles.connection} data-state={connectionState}>
          <span className={styles.dot} aria-hidden="true" />
          {CONNECTION_TEXT[connectionState]}
        </span>
      </div>
    </header>
  );
}
