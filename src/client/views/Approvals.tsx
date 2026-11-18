import { useState } from "react";
import { roleLabel } from "../scene/rooms";
import { connection } from "../state/connection";
import type { PermissionRequest } from "../../shared/protocol";
import styles from "./Approvals.module.css";

/** Approve/Deny cards for what the office wouldn't approve on its own. */
export function Approvals({ requests }: { requests: PermissionRequest[] }) {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  if (requests.length === 0) return null;

  const answer = (requestId: string, allow: boolean) => {
    if (answered.has(requestId)) return;
    if (connection.send({ type: "permission.answer", requestId, allow })) {
      setAnswered((current) => new Set(current).add(requestId));
    }
  };

  return (
    <section className={styles.section} aria-label="Approvals waiting">
      {requests.map((request) => {
        const busy = answered.has(request.requestId);
        return (
          <article key={request.requestId} className={styles.card}>
            <p className={styles.who}>
              <strong>{roleLabel(request.role)}</strong> wants to · {request.reason.toLowerCase()}
            </p>
            <code className={styles.what}>{request.summary}</code>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.allow}
                disabled={busy}
                onClick={() => answer(request.requestId, true)}
              >
                Allow once
              </button>
              <button
                type="button"
                className={styles.deny}
                disabled={busy}
                onClick={() => answer(request.requestId, false)}
              >
                Deny
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
