import { useCallback, useEffect, useMemo, useState } from "react";
import { SceneCanvas } from "../components/SceneCanvas";
import { OfficeScene, type OfficeData } from "../scene/OfficeScene";
import { buildRooms } from "../scene/rooms";
import { connection } from "../state/connection";
import { currentSessionId, routerFor, sameFolder, useOfficeStore } from "../state/officeStore";
import { navigate } from "../state/useHashRoute";
import type { ProjectSummary } from "../../shared/model";
import { Approvals } from "./Approvals";
import { ArchiveList } from "./ArchiveList";
import { Composer } from "./Composer";
import { FormatBanner } from "./FormatBanner";
import { RoomList } from "./RoomList";
import { SessionHeader } from "./SessionHeader";
import { Transcript } from "./Transcript";
import layout from "./Layout.module.css";

/** `#/office/<key>`: an office for a project the logs already know. */
export function OfficeView({ projectKey, pickedSessionId }: { projectKey: string; pickedSessionId: string | null }) {
  const project = useOfficeStore((state) =>
    state.projects.find((candidate) => candidate.key === projectKey),
  );
  const connectionState = useOfficeStore((state) => state.connection);

  if (!project) {
    return (
      <main className={layout.layout}>
        <section className={layout.section}>
          <p className={layout.lead}>
            {connectionState === "open"
              ? "There's no project at this address. It may have no sessions left."
              : "Loading the office…"}
          </p>
          <button type="button" className={layout.plainButton} onClick={() => navigate({ kind: "building" })}>
            Back to the building
          </button>
        </section>
      </main>
    );
  }
  return <Office cwd={project.cwd} project={project} pickedSessionId={pickedSessionId} />;
}

/** `#/new/<folder>`: an office for a folder with no sessions yet. Moves to the real one once it exists. */
export function NewOfficeView({ cwd }: { cwd: string }) {
  const project = useOfficeStore((state) =>
    state.projects.find((candidate) => sameFolder(candidate.cwd, cwd)),
  );
  useEffect(() => {
    if (project) navigate({ kind: "office", projectKey: project.key, sessionId: null });
  }, [project]);
  return <Office cwd={cwd} project={project ?? null} pickedSessionId={null} />;
}

interface OfficeProps {
  cwd: string;
  project: ProjectSummary | null;
  pickedSessionId: string | null;
}

function Office({ cwd, project, pickedSessionId }: OfficeProps) {
  const routers = useOfficeStore((state) => state.routers);
  const allPermissions = useOfficeStore((state) => state.permissions);
  const router = routerFor(routers, cwd);
  const sessionId = project ? currentSessionId(project, routers, pickedSessionId) : null;
  const detail = useOfficeStore((state) => (sessionId ? state.sessions[sessionId] : undefined));
  const summary = project?.sessions.find((session) => session.sessionId === sessionId) ?? null;
  const permissions = useMemo(
    () => allPermissions.filter((request) => sameFolder(request.cwd, cwd)),
    [allPermissions, cwd],
  );
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
        ? { role: latestHandoff.role, description: latestHandoff.description, finished: latestHandoff.finished }
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

  const name = project?.name ?? cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
  const followNewSession = () => {
    if (project && pickedSessionId) navigate({ kind: "office", projectKey: project.key, sessionId: null });
  };

  return (
    <main className={layout.layout}>
      <section className={layout.stage} aria-label={`${name} office`}>
        <SceneCanvas
          createScene={createScene}
          data={data}
          label={`Office for ${name}, one room per agent. The room list beside it has the same details.`}
        />
      </section>
      <aside className={layout.panel}>
        <SessionHeader cwd={cwd} project={project} detail={detail ?? null} picked={pickedSessionId !== null} />
        {detail && <FormatBanner detail={detail} />}
        {archiveOpen && project ? (
          <ArchiveList project={project} currentSessionId={sessionId} onClose={() => setArchiveOpen(false)} />
        ) : (
          <>
            <RoomList
              rooms={rooms}
              selectedRole={selectedRole}
              onSelect={setSelectedRole}
              onOpenArchive={() => setArchiveOpen(true)}
              archiveCount={project?.sessions.length ?? 0}
            />
            <Transcript detail={detail ?? null} emptyBecauseNew={project === null} />
          </>
        )}
        <div className={layout.dock}>
          <Approvals requests={permissions} />
          <Composer
            cwd={cwd}
            session={detail ?? summary}
            router={router}
            onStartedNewSession={followNewSession}
          />
        </div>
      </aside>
    </main>
  );
}
