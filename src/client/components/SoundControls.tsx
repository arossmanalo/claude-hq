import { useState } from "react";
import { sound } from "../lib/sound";
import { connection } from "../state/connection";
import { useOfficeStore } from "../state/officeStore";
import styles from "./SoundControls.module.css";

/** Mute, volume, a preview, and opt-in browser notifications. Saved in the office settings. */
export function SoundControls() {
  const settings = useOfficeStore((state) => state.sound);
  const unlocked = useOfficeStore((state) => state.soundUnlocked);
  const [notifications, setNotifications] = useState(() =>
    "Notification" in window ? Notification.permission : "denied",
  );

  const save = (muted: boolean, volume: number) =>
    connection.send({ type: "settings.sound", muted, volume });

  return (
    <div className={styles.controls}>
      {!unlocked && !settings.muted && (
        <span className={styles.hint}>Click anywhere to enable sound</span>
      )}
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={!settings.muted}
        onClick={() => {
          const muted = !settings.muted;
          save(muted, settings.volume);
          if (!muted) sound.play("done", settings.volume);
        }}
      >
        {settings.muted ? "Sound off" : "Sound on"}
      </button>
      <label className={styles.volume}>
        <span className="visually-hidden">Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={settings.volume}
          disabled={settings.muted}
          onChange={(event) => useOfficeStore.setState({ sound: { ...settings, volume: Number(event.target.value) } })}
          onPointerUp={(event) => {
            const volume = Number(event.currentTarget.value);
            save(settings.muted, volume);
            sound.play("needsInput", volume);
          }}
          onKeyUp={(event) => save(settings.muted, Number(event.currentTarget.value))}
        />
      </label>
      {notifications === "default" && (
        <button
          type="button"
          className={styles.toggle}
          onClick={() => {
            void Notification.requestPermission().then(setNotifications);
          }}
        >
          Notify me
        </button>
      )}
    </div>
  );
}
