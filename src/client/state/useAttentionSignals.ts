import { useEffect } from "react";
import { compareSignals, snapshotOf } from "../lib/signals";
import { sound } from "../lib/sound";
import { useOfficeStore } from "./officeStore";

const BASE_TITLE = "Claude Office";

/**
 * Turns office events into sounds, a count in the tab title, and a browser notification when the
 * tab is in the background. Runs once at the app root.
 */
export function useAttentionSignals(): void {
  useEffect(() => {
    const unlock = () => {
      sound.unlock();
      useOfficeStore.getState().setSoundUnlocked();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    const initial = useOfficeStore.getState();
    let previous = snapshotOf(initial.permissions, initial.routers, initial.taskDoneCount);

    const unsubscribe = useOfficeStore.subscribe((state) => {
      const next = snapshotOf(state.permissions, state.routers, state.taskDoneCount);
      const signals = compareSignals(previous, next);
      previous = next;

      document.title = signals.waitingCount > 0 ? `(${signals.waitingCount}) ${BASE_TITLE}` : BASE_TITLE;

      const volume = state.sound.muted ? 0 : state.sound.volume;
      if (signals.needsInput) {
        sound.play("needsInput", volume);
        notify("Claude Office needs you", "An agent is waiting for your answer.");
      } else if (signals.done) {
        sound.play("done", volume);
        notify("Task finished", "The router finished your request.");
      }
    });

    return () => {
      unsubscribe();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
}

function notify(title: string, body: string): void {
  if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
  // One tag replaces the previous notification instead of stacking them.
  new Notification(title, { body, tag: "claude-office" });
}
