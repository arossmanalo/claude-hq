import { relativeTime } from "../lib/format";
import type { BuildingData } from "../scene/BuildingScene";
import { useOfficeStore } from "../state/officeStore";
import { navigate } from "../state/useHashRoute";
import type { ProjectSummary } from "../../shared/model";
import layout from "./Layout.module.css";
import styles from "./Directory.module.css";

function statusOf(project: ProjectSummary, data: BuildingData) {
  if (data.attention.has(project.key)) return { tone: "attention", text: "Needs you" } as const;
  if (data.working.has(project.key)) return { tone: "working", text: "Working" } as const;
  if (project.live) return { tone: "live", text: "Open in Claude Code" } as const;
  return { tone: "quiet", text: relativeTime(project.sessions[0]?.updatedAt ?? null) } as const;
}

/** The lobby directory board: every floor as a plain list, for keyboards and small screens. */
export function Directory({ data }: { data: BuildingData }) {
  const connection = useOfficeStore((state) => state.connection);
  const { projects } = data;

  return (
    <section className={layout.section}>
      <h2 className={layout.sectionTitle}>Directory</h2>
      {projects.length === 0 ? (
        <p className={layout.lead}>
          {connection === "open"
            ? "No Claude Code sessions found. Start Claude Code in any project folder and its office appears here."
            : "Waiting for the office server…"}
        </p>
      ) : (
        <ul className={styles.list}>
          {projects.map((project) => {
            const status = statusOf(project, data);
            return (
              <li key={project.key}>
                <button
                  type="button"
                  className={styles.entry}
                  onClick={() => navigate({ kind: "office", projectKey: project.key, sessionId: null })}
                >
                  <span className={styles.name}>{project.name}</span>
                  <span className={styles.status} data-tone={status.tone}>
                    {status.text}
                  </span>
                  <span className={styles.path} title={project.cwd}>
                    {project.cwd}
                  </span>
                  <span className={styles.count}>
                    {project.sessions.length === 1 ? "1 session" : `${project.sessions.length} sessions`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
