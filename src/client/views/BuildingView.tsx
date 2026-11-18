import { useCallback, useMemo } from "react";
import { SceneCanvas } from "../components/SceneCanvas";
import { BuildingScene, type BuildingData } from "../scene/BuildingScene";
import { routerFor, sameFolder, useOfficeStore } from "../state/officeStore";
import { navigate } from "../state/useHashRoute";
import { Directory } from "./Directory";
import { NewOfficeForm } from "./NewOfficeForm";
import layout from "./Layout.module.css";

export function BuildingView() {
  const projects = useOfficeStore((state) => state.projects);
  const routers = useOfficeStore((state) => state.routers);
  const permissions = useOfficeStore((state) => state.permissions);

  const data = useMemo<BuildingData>(() => {
    const attention = new Set<string>();
    const working = new Set<string>();
    for (const project of projects) {
      const router = routerFor(routers, project.cwd);
      const waiting = permissions.some((request) => sameFolder(request.cwd, project.cwd));
      if (waiting || router?.attention) attention.add(project.key);
      if (router?.phase === "working" || router?.phase === "starting") working.add(project.key);
    }
    return { projects, attention, working };
  }, [projects, routers, permissions]);

  const createScene = useCallback(
    () =>
      new BuildingScene({
        onOpenProject: (projectKey) => navigate({ kind: "office", projectKey, sessionId: null }),
      }),
    [],
  );

  return (
    <main className={layout.layout}>
      <section className={layout.stage} aria-label="Building">
        <SceneCanvas
          createScene={createScene}
          data={data}
          label={`Office building with ${projects.length} project floors. The directory lists the same floors.`}
        />
      </section>
      <aside className={layout.panel}>
        <NewOfficeForm />
        <Directory data={data} />
      </aside>
    </main>
  );
}
