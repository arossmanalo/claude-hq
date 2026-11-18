import { useState, type FormEvent } from "react";
import { sameFolder, useOfficeStore } from "../state/officeStore";
import { navigate } from "../state/useHashRoute";
import layout from "./Layout.module.css";
import styles from "./NewOfficeForm.module.css";

/** Opens an office for any folder, including one Claude Code has never run in. */
export function NewOfficeForm() {
  const projects = useOfficeStore((state) => state.projects);
  const [folder, setFolder] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cwd = folder.trim().replace(/^"(.*)"$/, "$1");
    if (!/^([a-zA-Z]:[\\/]|\/|\\\\)/.test(cwd)) {
      setProblem("Enter the folder's full path, for example D:\\Projects\\my-app.");
      return;
    }
    setProblem(null);
    const existing = projects.find((project) => sameFolder(project.cwd, cwd));
    navigate(existing ? { kind: "office", projectKey: existing.key, sessionId: null } : { kind: "new", cwd });
  };

  return (
    <section className={layout.section}>
      <h2 className={layout.sectionTitle}>Open an office</h2>
      <form className={styles.form} onSubmit={submit} noValidate>
        <label htmlFor="new-office-folder" className={styles.label}>
          Project folder
        </label>
        <div className={styles.row}>
          <input
            id="new-office-folder"
            className={styles.input}
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder="D:\Projects\my-app"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={problem !== null}
            aria-describedby={problem ? "new-office-problem" : undefined}
          />
          <button type="submit" className={styles.button} disabled={folder.trim().length === 0}>
            Open
          </button>
        </div>
        {problem && (
          <p id="new-office-problem" className={styles.problem}>
            {problem}
          </p>
        )}
      </form>
    </section>
  );
}
