import { useState } from "react";
import type { SessionDetail } from "../../shared/model";
import styles from "./FormatBanner.module.css";

/**
 * Claude Code's log format is internal. When a session contains event kinds or lines this build
 * doesn't understand, say so: agent states may be wrong until the office is updated.
 */
export function FormatBanner({ detail }: { detail: SessionDetail }) {
  const [dismissed, setDismissed] = useState(false);
  const unknown = Object.entries(detail.unknownEventTypes);
  const unknownCount = unknown.reduce((sum, [, count]) => sum + count, 0);
  if (dismissed || (unknownCount === 0 && detail.malformedLines === 0)) return null;

  const parts: string[] = [];
  if (unknownCount > 0) {
    const names = unknown.map(([name]) => name).slice(0, 3).join(", ");
    parts.push(`${unknownCount} events of kinds this office doesn't know (${names})`);
  }
  if (detail.malformedLines > 0) {
    parts.push(`${detail.malformedLines} lines it couldn't read`);
  }

  return (
    <div className={styles.banner} role="note">
      <p>
        <strong>Claude Code's log format may have changed.</strong> This session has {parts.join(" and ")}.
        Agent states shown here may be off until Claude Office is updated.
      </p>
      <button type="button" onClick={() => setDismissed(true)}>
        Hide
      </button>
    </div>
  );
}
