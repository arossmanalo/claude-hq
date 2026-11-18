import { useCallback, useEffect, useMemo, useState } from "react";
import { SceneCanvas } from "../components/SceneCanvas";
import { OfficeScene, type OfficeData } from "../scene/OfficeScene";
import { buildRooms } from "../scene/rooms";
import { connection } from "../state/connection";
import { currentSessionId, useOfficeStore } from "../state/officeStore";
import { navigate } from "../state/useHashRoute";
import { ArchiveList } from "./ArchiveList";
import { FormatBanner } from "./FormatBanner";
import { RoomList } from "./RoomList";
import { SessionHeader } from "./SessionHeader";
import { Transcript } from "./Transcript";
import layout from "./Layout.module.css";

interface OfficeViewProps {
  projectKey: string;
  pickedSessionId: string | null;
}

export function OfficeView({ projectKey, pickedSessionId }: OfficeViewProps) {
  const project = useOfficeStore((state) =>
    state.projects.find((candidate) => candidate.key === projectKey),
  );
  const routers = useOfficeStore((state) => state.routers);
  const connectionState = useOfficeStore((state) => state.connection);
  const sessionId = project ? currentSessionId(project, routers, pickedSessionId) : null;
  const detail = useOfficeStore((state) => (sessionId ? state.sessions[sessionId] : undefined));
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    connection.subscribe(sessionId ? [sessionId] : []);
  }, [sessionId]);
  useEffect(() => () => connection.subscribe([]), []);

  const rooms = useMemo(() => buildRooms(detail ?? null), [detail]);
  const latestHandoff = detail?.handoffs.at(-1);
  const data = useMemo<OfficeData>(
    () => ({
      rooms,
      handoff: latestHandoff
        ? {
            role: latestHandoff.role,
            description: latestHandoff.description,
            finished: latestHandoff.finished,
          }
        : null,
      archiveCount: project?.sessions.length ?? 0,
      selectedRole,
    }),
    [rooms, latestHandoff, project?.sessions.length, selectedRole],
  );

  const createScene = useCallback(
    () =>
      new OfficeScene({
        onSelectRoom: (role) => setSelectedRole((current) => (current === role ? null : role)),
        onOpenArchive: () => setArchiveOpen(true),
      }),
    [],
  );

  if (!project) {
    return (
      <main className={layout.layout}>
        <section className={layout.section}>
          <p className={layout.lead}>
            {connectionState === "open"
              ? "There's no project at this address. It may have no sessions left."
              : "Loading the office…"}
          </p>
          <button type="button" onClick={() => navigate({ kind: "building" })}>
            Back to the building
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={layout.layout}>
      <section className={layout.stage} aria-label={`${project.name} office`}>
        <SceneCanvas
          createScene={createScene}
          data={data}
          label={`Office for ${project.name}, one room per agent. The room list beside it has the same details.`}
        />
      </section>
      <aside className={layout.panel}>
        <SessionHeader project={project} detail={detail ?? null} picked={pickedSessionId !== null} />
        {detail && <FormatBanner detail={detail} />}
        {archiveOpen ? (
          <ArchiveList
            project={project}
            currentSessionId={sessionId}
            onClose={() => setArchiveOpen(false)}
          />
        ) : (
          <>
            <RoomList
              rooms={rooms}
              selectedRole={selectedRole}
              onSelect={setSelectedRole}
              onOpenArchive={() => setArchiveOpen(true)}
              archiveCount={project.sessions.length}
            />
            <Transcript detail={detail ?? null} />
          </>
        )}
      </aside>
    </main>
  );
}
