import { useEffect } from "react";
import { Notices } from "./components/Notices";
import { TopBar } from "./components/TopBar";
import { connection } from "./state/connection";
import { useOfficeStore } from "./state/officeStore";
import { useHashRoute } from "./state/useHashRoute";
import { BuildingView } from "./views/BuildingView";
import { OfficeView } from "./views/OfficeView";
import styles from "./App.module.css";

export function App() {
  useHashRoute();
  useEffect(() => connection.start(), []);
  const view = useOfficeStore((state) => state.view);

  return (
    <div className={styles.app}>
      <TopBar />
      <Notices />
      {view.kind === "building" ? (
        <BuildingView />
      ) : (
        <OfficeView projectKey={view.projectKey} pickedSessionId={view.sessionId} />
      )}
    </div>
  );
}
