import { useEffect } from "react";
import { Notices } from "./components/Notices";
import { TopBar } from "./components/TopBar";
import { connection } from "./state/connection";
import { useOfficeStore } from "./state/officeStore";
import { useAttentionSignals } from "./state/useAttentionSignals";
import { useHashRoute } from "./state/useHashRoute";
import { BuildingView } from "./views/BuildingView";
import { NewOfficeView, OfficeView } from "./views/OfficeView";
import styles from "./App.module.css";

export function App() {
  useHashRoute();
  useAttentionSignals();
  useEffect(() => connection.start(), []);
  const view = useOfficeStore((state) => state.view);

  return (
    <div className={styles.app}>
      <TopBar />
      <Notices />
      {view.kind === "building" && <BuildingView />}
      {view.kind === "office" && (
        <OfficeView projectKey={view.projectKey} pickedSessionId={view.sessionId} />
      )}
      {view.kind === "new" && <NewOfficeView cwd={view.cwd} />}
    </div>
  );
}
