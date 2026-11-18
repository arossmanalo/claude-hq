import { useEffect } from "react";
import { useOfficeStore } from "../state/officeStore";
import styles from "./Notices.module.css";

const INFO_LIFETIME_MS = 6000;

/** Toasts for server notices. Errors stay until dismissed; info fades out on its own. */
export function Notices() {
  const notices = useOfficeStore((state) => state.notices);
  const dismiss = useOfficeStore((state) => state.dismissNotice);

  useEffect(() => {
    const timers = notices
      .filter((notice) => notice.level === "info")
      .map((notice) => window.setTimeout(() => dismiss(notice.id), INFO_LIFETIME_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [notices, dismiss]);

  if (notices.length === 0) return null;
  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.id} className={styles.notice} data-level={notice.level}>
          <p>{notice.message}</p>
          <button type="button" onClick={() => dismiss(notice.id)} aria-label="Dismiss">
            Close
          </button>
        </div>
      ))}
    </div>
  );
}
