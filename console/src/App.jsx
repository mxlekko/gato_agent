import { Navigate, Route, Routes } from "react-router-dom";
import { ShellLayout } from "./components/ShellLayout";
import { ConfigCatalogPage } from "./pages/configs/ConfigCatalogPage";
import { CompilePreviewPage } from "./pages/configs/CompilePreviewPage";
import { ValidateConfigPage } from "./pages/configs/ValidateConfigPage";
import { RunOncePage } from "./pages/debug/RunOncePage";
import { RolloutPage } from "./pages/rollout/RolloutPage";
import { RunDetailPage } from "./pages/runs/RunDetailPage";
import { RunListPage } from "./pages/runs/RunListPage";
import { RagJobsPage } from "./pages/rag/RagJobsPage";
import { RagLibraryDetailPage } from "./pages/rag/RagLibraryDetailPage";
import { RagLibraryEditPage } from "./pages/rag/RagLibraryEditPage";
import { RagLibraryPage } from "./pages/rag/RagLibraryPage";
import { RagOverviewPage } from "./pages/rag/RagOverviewPage";
import { RagSearchPage } from "./pages/rag/RagSearchPage";
import { RagSettingsPage } from "./pages/rag/RagSettingsPage";
import { RagSyncPage } from "./pages/rag/RagSyncPage";
import { NewScenePage } from "./pages/scenes/NewScenePage";
import { SceneWorkflowPage } from "./pages/scenes/SceneWorkflowPage";
import { ScenesPage } from "./pages/scenes/ScenesPage";
import { TraceDetailPage } from "./pages/traces/TraceDetailPage";

export default function App() {
  return (
    <Routes>
      <Route path="/rag/library/:docId/edit" element={<RagLibraryEditPage />} />
      <Route path="/rag/library/:docId" element={<RagLibraryDetailPage />} />
      <Route path="/" element={<ShellLayout />}>
        <Route index element={<Navigate to="/scenes" replace />} />
        <Route path="scenes" element={<ScenesPage />} />
        <Route path="scenes/new" element={<NewScenePage />} />
        <Route path="scenes/:scene" element={<SceneWorkflowPage />} />
        <Route path="debug/run-once" element={<RunOncePage />} />
        <Route path="runs" element={<RunListPage />} />
        <Route path="runs/:runId" element={<RunDetailPage />} />
        <Route path="traces/:traceId" element={<TraceDetailPage />} />
        <Route path="rag" element={<Navigate to="/rag/overview" replace />} />
        <Route path="rag/overview" element={<RagOverviewPage />} />
        <Route path="rag/search" element={<RagSearchPage />} />
        <Route path="rag/library" element={<RagLibraryPage />} />
        <Route path="rag/jobs" element={<RagJobsPage />} />
        <Route path="rag/sync" element={<RagSyncPage />} />
        <Route path="rag/settings" element={<RagSettingsPage />} />
        <Route path="configs" element={<Navigate to="/configs/skills" replace />} />
        <Route
          path="configs/skills"
          element={<ConfigCatalogPage kind="skill" sectionLabel="业务技能" />}
        />
        <Route
          path="configs/templates"
          element={<ConfigCatalogPage kind="template" sectionLabel="流程模板" />}
        />
        <Route
          path="configs/queries"
          element={<ConfigCatalogPage kind="query" sectionLabel="查询服务配置" />}
        />
        <Route
          path="configs/tools"
          element={<ConfigCatalogPage kind="tool" sectionLabel="工具配置" />}
        />
        <Route path="configs/validate" element={<ValidateConfigPage />} />
        <Route path="configs/compile-preview" element={<CompilePreviewPage />} />
        <Route path="rollout" element={<RolloutPage />} />
      </Route>
    </Routes>
  );
}
