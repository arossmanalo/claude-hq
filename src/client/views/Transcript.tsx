import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { chatMessageListSchema } from "../../shared/protocol";
import type { ChatMessage, SessionDetail } from "../../shared/model";
import layout from "./Layout.module.css";
import styles from "./Transcript.module.css";

const PAGE_SIZE = 100;

interface EarlierState {
  sessionId: string | null;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
}

/** The router conversation, newest at the bottom, with older pages loaded on request. */
export function Transcript({
  detail,
  emptyBecauseNew,
}: {
  detail: SessionDetail | null;
  /** The folder has no sessions yet, so there's nothing to load. */
  emptyBecauseNew: boolean;
}) {
  const sessionId = detail?.sessionId ?? null;
  const [earlier, setEarlier] = useState<EarlierState>({
    sessionId,
    messages: [],
    loading: false,
    error: null,
  });
  const scrollRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);

  // Older pages belong to one session; drop them when the office shows another.
  if (earlier.sessionId !== sessionId) {
    setEarlier({ sessionId, messages: [], loading: false, error: null });
  }

  const recent = detail?.messages ?? [];
  const messages = [...earlier.messages, ...recent];
  const firstIndex = messages[0]?.index ?? 0;
  const hasEarlier = detail ? firstIndex > 0 : false;

  useLayoutEffect(() => {
    const list = scrollRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [recent.length, sessionId]);

  useEffect(() => {
    stickToBottom.current = true;
  }, [sessionId]);

  const loadEarlier = async () => {
    if (!sessionId || earlier.loading) return;
    const requestedFor = sessionId;
    setEarlier((state) => ({ ...state, loading: true, error: null }));
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(requestedFor)}/messages?before=${firstIndex}&limit=${PAGE_SIZE}`,
      );
      if (!response.ok) throw new Error(`The server answered ${response.status}.`);
      const page = chatMessageListSchema.parse(await response.json());
      setEarlier((state) =>
        // A late answer for a session we've left is dropped.
        state.sessionId === requestedFor
          ? { ...state, loading: false, messages: [...page, ...state.messages] }
          : state,
      );
    } catch (error: unknown) {
      setEarlier((state) =>
        state.sessionId === requestedFor
          ? {
              ...state,
              loading: false,
              error: `Couldn't load earlier messages. ${error instanceof Error ? error.message : ""} Try again.`,
            }
          : state,
      );
    }
  };

  return (
    <section className={`${layout.section} ${styles.section}`}>
      <h2 className={layout.sectionTitle}>Conversation</h2>
      {!detail ? (
        <p className={layout.lead}>
          {emptyBecauseNew ? "Nothing here yet. What you send the router appears here." : "Loading…"}
        </p>
      ) : messages.length === 0 ? (
        <p className={layout.lead}>No messages yet. What you send the router appears here.</p>
      ) : (
        <ol
          ref={scrollRef}
          className={styles.list}
          onScroll={(event) => {
            const list = event.currentTarget;
            stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
          }}
        >
          {hasEarlier && (
            <li className={styles.earlier}>
              <button type="button" onClick={() => void loadEarlier()} disabled={earlier.loading}>
                {earlier.loading ? "Loading earlier messages…" : "Show earlier messages"}
              </button>
              {earlier.error && <p className={styles.error}>{earlier.error}</p>}
            </li>
          )}
          {messages.map((message) => (
            <li key={message.index} className={styles.message} data-author={message.author}>
              <span className={styles.author}>{message.author === "user" ? "You" : "Router"}</span>
              <p className={styles.text}>{message.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
