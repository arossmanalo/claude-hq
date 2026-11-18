import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ROUTER_MODELS, type RouterModel, type RouterStatus } from "../../shared/protocol";
import type { SessionSummary } from "../../shared/model";
import { connection } from "../state/connection";
import styles from "./Composer.module.css";

const RESUME_TEXT =
  "Continue where you left off. The Claude Office server restarted while you were working.";

const MODEL_NAMES: Record<RouterModel, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  fable: "Fable",
};

interface ComposerProps {
  cwd: string;
  /** The session shown in the office, if any. */
  session: SessionSummary | null;
  router: RouterStatus | undefined;
  /** Called after a new session was requested, so the office can follow it. */
  onStartedNewSession: () => void;
}

/** Chat box for the router: send, queue, stop, pick the router's model, resume after a restart. */
export function Composer({ cwd, session, router, onStartedNewSession }: ComposerProps) {
  const [text, setText] = useState("");
  // Start from the model the router is already running, so switching views doesn't reset it.
  const [model, setModel] = useState<RouterModel | "">(() => router?.model ?? "");
  const [startNew, setStartNew] = useState(false);

  const routerOwnsShown = router?.sessionId != null && router.sessionId === session?.sessionId;
  const runningElsewhere = session?.live === true && !session.ownedByOffice && !routerOwnsShown;
  const newSession = startNew || session === null;
  const working = router?.phase === "working" || router?.phase === "starting";
  const blocked = runningElsewhere && !newSession;

  const send = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || blocked) return false;
    const sent = connection.send({
      type: "chat.send",
      cwd,
      sessionId: newSession ? null : (session?.sessionId ?? null),
      text: trimmed,
      model: model === "" ? null : model,
    });
    if (sent && newSession) {
      setStartNew(false);
      onStartedNewSession();
    }
    return sent;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (send(text)) setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (send(text)) setText("");
    }
  };

  return (
    <section className={styles.section} aria-label="Chat with the router">
      <RouterLine router={router} onResume={() => send(RESUME_TEXT)} />

      {router && router.queued.length > 0 && (
        <div className={styles.queue}>
          <p>
            {router.queued.length === 1 ? "1 message waits" : `${router.queued.length} messages wait`} for
            the router to finish.
          </p>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => connection.send({ type: "chat.clearQueue", cwd })}
          >
            Cancel queued
          </button>
        </div>
      )}

      {blocked ? (
        <div className={styles.blocked}>
          <p>This session is running in Claude Code. Chat with it there, or start a new session here.</p>
          <button type="button" className={styles.secondary} onClick={() => setStartNew(true)}>
            Start a new session
          </button>
        </div>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <label className="visually-hidden" htmlFor="composer-text">
            Message to the router
          </label>
          <textarea
            id="composer-text"
            className={styles.input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            placeholder={
              newSession
                ? "Describe what you want built. The router starts a new session."
                : working
                  ? "The router is working. Messages you send now wait their turn."
                  : "Message the router"
            }
          />
          <div className={styles.controls}>
            <label className={styles.model}>
              <span>Router model</span>
              <select
                value={model}
                onChange={(event) => {
                  const value = event.target.value;
                  setModel(ROUTER_MODELS.find((name) => name === value) ?? "");
                }}
              >
                <option value="">Router's own (agent file)</option>
                {ROUTER_MODELS.map((name) => (
                  <option key={name} value={name}>
                    {MODEL_NAMES[name]}
                  </option>
                ))}
              </select>
            </label>
            {newSession && session !== null && (
              <button type="button" className={styles.textButton} onClick={() => setStartNew(false)}>
                Continue this session instead
              </button>
            )}
            {!newSession && session !== null && !working && (
              <button type="button" className={styles.textButton} onClick={() => setStartNew(true)}>
                New session
              </button>
            )}
            {working && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => connection.send({ type: "chat.stop", cwd })}
              >
                Stop
              </button>
            )}
            <button type="submit" className={styles.primary} disabled={text.trim().length === 0}>
              {working ? "Queue message" : "Send"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function RouterLine({ router, onResume }: { router: RouterStatus | undefined; onResume: () => void }) {
  if (!router) return null;
  if (router.attention) {
    return <p className={styles.attention}>{router.attention}</p>;
  }
  switch (router.phase) {
    case "starting":
      return <p className={styles.status}>Starting the router…</p>;
    case "working":
      return (
        <p className={styles.status}>
          Router working · {router.handoffsThisRequest} of {router.handoffCap} handoffs used
        </p>
      );
    case "interrupted":
      return (
        <div className={styles.attentionRow}>
          <p className={styles.attention}>The router was cut off mid-task when the office stopped.</p>
          <button type="button" className={styles.secondary} onClick={onResume}>
            Resume
          </button>
        </div>
      );
    case "error":
      return <p className={styles.error}>{router.error ?? "The router stopped with an error."}</p>;
    default:
      return router.error ? <p className={styles.error}>{router.error}</p> : null;
  }
}
