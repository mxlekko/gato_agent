import { Navigate, Route, Routes } from "react-router-dom";
import { ShellLayout } from "./components/ShellLayout";
import { ConfigCatalogPage } from "./pages/configs/ConfigCatalogPage";
import { CompilePreviewPage } from "./pages/configs/CompilePreviewPage";
import { ValidateConfigPage } from "./pages/configs/ValidateConfigPage";
import { RunOncePage } from "./pages/debug/RunOncePage";
import { RolloutPage } from "./pages/rollout/RolloutPage";
import { RunDetailPage } from "./pages/runs/RunDetailPage";
import { RunListPage } from "./pages/runs/RunListPage";
import { ShadowComparePage } from "./pages/runs/ShadowComparePage";
import { SceneWorkflowPage } from "./pages/scenes/SceneWorkflowPage";
import { ScenesPage } from "./pages/scenes/ScenesPage";
import { TraceDetailPage } from "./pages/traces/TraceDetailPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ShellLayout />}>
        <Route index element={<Navigate to="/scenes" replace />} />
        <Route path="scenes" element={<ScenesPage />} />
        <Route path="scenes/:scene" element={<SceneWorkflowPage />} />
        <Route path="debug/run-once" element={<RunOncePage />} />
        <Route path="runs" element={<RunListPage />} />
        <Route path="runs/:runId" element={<RunDetailPage />} />
        <Route path="runs/:runId/shadow" element={<ShadowComparePage />} />
        <Route path="traces/:traceId" element={<TraceDetailPage />} />
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
