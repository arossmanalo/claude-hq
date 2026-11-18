import { relativeTime } from "../lib/format";
import { navigate } from "../state/useHashRoute";
import type { ProjectSummary } from "../../shared/model";
import layout from "./Layout.module.css";
import styles from "./ArchiveList.module.css";

interface ArchiveListProps {
  project: ProjectSummary;
  currentSessionId: string | null;
  onClose: () => void;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Every session for this project, newest first. Picking one shows it in the office. */
export function ArchiveList({ project, currentSessionId, onClose }: ArchiveListProps) {
  return (
    <section className={layout.section}>
      <div className={styles.header}>
        <h2 className={layout.sectionTitle}>Filing cabinet</h2>
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </div>
      <ul className={styles.list}>
        {project.sessions.map((session) => (
          <li key={session.sessionId}>
            <button
              type="button"
              className={styles.entry}
              aria-current={session.sessionId === currentSessionId ? "true" : undefined}
              onClick={() => {
                navigate({ kind: "office", projectKey: project.key, sessionId: session.sessionId });
                onClose();
              }}
            >
              <span className={styles.title}>{session.title ?? "Untitled session"}</span>
              <span className={styles.meta}>
                {session.live ? <strong>Live now</strong> : relativeTime(session.updatedAt)}
                {" · "}
                {sizeLabel(session.sizeBytes)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
