import { compactNumber, relativeTime, workTokens } from "../lib/format";
import { navigate } from "../state/useHashRoute";
import type { ProjectSummary, SessionDetail } from "../../shared/model";
import layout from "./Layout.module.css";
import styles from "./SessionHeader.module.css";

interface SessionHeaderProps {
  cwd: string;
  project: ProjectSummary | null;
  detail: SessionDetail | null;
  /** True when viewing a session picked from the filing cabinet. */
  picked: boolean;
}

function modeText(detail: SessionDetail): string {
  if (detail.ownedByOffice) return "Run by the office";
  if (detail.live) return "Running in Claude Code, view only";
  return `Archived, last active ${relativeTime(detail.updatedAt)}`;
}

export function SessionHeader({ cwd, project, detail, picked }: SessionHeaderProps) {
  return (
    <section className={layout.section}>
      <p className={styles.folder} title={cwd}>
        {cwd}
      </p>
      <h1 className={styles.title}>{detail?.title ?? (project ? "Untitled session" : "New office")}</h1>
      {detail ? (
        <p className={styles.meta}>
          <span data-live={detail.live}>{modeText(detail)}</span>
          <span>{compactNumber(workTokens(detail.tokens))} tokens</span>
          {detail.commits.length > 0 && (
            <span>{detail.commits.length === 1 ? "1 commit" : `${detail.commits.length} commits`}</span>
          )}
        </p>
      ) : (
        <p className={styles.meta}>
          {project ? "Loading this session…" : "No sessions in this folder yet. Your first message starts one."}
        </p>
      )}
      {picked && project && (
        <button
          type="button"
          className={styles.link}
          onClick={() => navigate({ kind: "office", projectKey: project.key, sessionId: null })}
        >
          Back to the current session
        </button>
      )}
    </section>
  );
}
