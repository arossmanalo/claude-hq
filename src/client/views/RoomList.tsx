import { compactNumber, workTokens } from "../lib/format";
import { modelLabel, stateLabel, type RoomModel } from "../scene/rooms";
import layout from "./Layout.module.css";
import styles from "./RoomList.module.css";

interface RoomListProps {
  rooms: RoomModel[];
  selectedRole: string | null;
  onSelect: (role: string | null) => void;
  onOpenArchive: () => void;
  archiveCount: number;
}

/** Text version of the floor plan: every room's state, model, and tokens. */
export function RoomList({ rooms, selectedRole, onSelect, onOpenArchive, archiveCount }: RoomListProps) {
  return (
    <section className={layout.section}>
      <h2 className={layout.sectionTitle}>Rooms</h2>
      <ul className={styles.list}>
        {rooms.map((room) => {
          const selected = selectedRole === room.role;
          return (
            <li key={room.role}>
              <button
                type="button"
                className={styles.room}
                aria-pressed={selected}
                aria-expanded={selected}
                onClick={() => onSelect(selected ? null : room.role)}
              >
                <span className={styles.name}>{room.label}</span>
                <span className={styles.state} data-state={room.state}>
                  {stateLabel(room)}
                </span>
                <span className={styles.meta}>
                  {[
                    modelLabel(room.model),
                    room.agentCount > 0 ? `${compactNumber(workTokens(room.tokens))} tokens` : null,
                    room.commits === 1 ? "1 commit" : room.commits > 1 ? `${room.commits} commits` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No work in this session"}
                </span>
              </button>
              {selected && room.task && <p className={styles.task}>Task: {room.task}</p>}
            </li>
          );
        })}
      </ul>
      {archiveCount > 0 && (
        <button type="button" className={styles.archive} onClick={onOpenArchive}>
          Open filing cabinet ({archiveCount === 1 ? "1 session" : `${archiveCount} sessions`})
        </button>
      )}
    </section>
  );
}
