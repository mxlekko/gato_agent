function formatValue(value) {
  if (value === null || value === undefined) {
    return "-";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function buildCapabilityList(node, hasOverride = false) {
  const capabilities = [];

  capabilities.push(node.required ? "必需" : "可选");
  capabilities.push(node.enabled === false ? "已禁用" : "已启用");

  if (hasOverride) {
    capabilities.push("已覆盖");
  }

  if (node.skipAllowed) {
    capabilities.push("可跳过");
  }

  if (node.reorderable) {
    capabilities.push("可重排");
  }

  if (node.replaceable) {
    capabilities.push("可替换");
  }

  return capabilities;
}

export function buildNodeRemark(node) {
  if (node.description) {
    return node.description;
  }

  const nodeRemarks = {
    bootstrap_runtime: "初始化本次运行上下文，生成 requestId、traceId 和起始运行信息。",
    load_workflow_contract: "加载当前场景绑定的模板、技能、输入输出契约和运行约束。",
    validate_input: "校验请求参数格式，确保业务入参与场景契约一致。",
    authorize_scope: "检查权限范围，确认本次可读取和可返回的字段边界。",
    resolve_data_plan: "生成本次查询计划，决定后续取数要走哪种查询配置。",
    fetch_business_context: "调用数据工具拉取业务原始数据，作为后续生成建议的事实来源。",
    load_reference_bundle: "加载提示词、结构定义、数据字典和规则等引用资产。",
    normalize_facts: "把原始数据清洗成标准事实和业务画像，供模型稳定使用。",
    select_basis_fields: "挑出本次建议重点参考的关键字段，压缩模型关注范围。",
    draft_business_output: "调用模型生成业务建议初稿，输出结构化结果内容。",
    validate_output: "按 schema 校验模型输出，并做轻量修正和标准化。",
    repair_output: "当输出不满足结构要求时，触发一次定向修复生成。",
    finalize_result: "统一收口执行结果，组装最终返回给调用方的响应。",
    observe_run: "记录运行日志、观测指标和关键上下文，便于排查问题。"
  };

  return nodeRemarks[node.id] || "该节点负责当前流程中的一个执行环节。";
}

export function WorkflowNodeList({
  orderedNodeIds = [],
  nodesById = {},
  nodeOverrides = {}
}) {
  if (orderedNodeIds.length === 0) {
    return (
      <section className="section-card">
        <h4>节点顺序</h4>
        <p className="muted-text">当前场景没有可展示的流程节点。</p>
      </section>
    );
  }

  return (
    <section className="section-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">流程</p>
          <h4>节点顺序与职责</h4>
        </div>
        <span className="pill">{orderedNodeIds.length} 个节点</span>
      </div>

      <div className="workflow-node-list">
        {orderedNodeIds.map((nodeId, index) => {
          const node = nodesById[nodeId] || { id: nodeId };
          const override = nodeOverrides[nodeId];
          const hasOverride = Boolean(override);
          const overrideEntries = override
            ? Object.entries(override).filter(([, value]) => value !== undefined)
            : [];

          return (
            <article className="workflow-node" key={nodeId}>
              <div className="workflow-node-step">{index + 1}</div>

              <div className="workflow-node-body">
                <div className="workflow-node-head">
                  <div>
                    <h5>{node.id}</h5>
                    <p className="muted-text">
                      {node.handlerRef || "未提供 handlerRef"}
                    </p>
                    <p className="workflow-node-note">{buildNodeRemark(node)}</p>
                  </div>

                  <div className="tag-list">
                    <span className="tag">{node.phase || "默认"}</span>
                    <span className="tag tag-soft">{node.category || "未知"}</span>
                    {buildCapabilityList(node, hasOverride).map((capability) => (
                      <span className="tag tag-neutral" key={`${nodeId}-${capability}`}>
                        {capability}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="workflow-node-grid">
                  <div className="meta-block">
                    <span className="meta-label">工具角色</span>
                    <span className="meta-value">{node.toolRole || "-"}</span>
                  </div>
                  <div className="meta-block">
                    <span className="meta-label">允许配置</span>
                    <span className="meta-value">
                      {node.allowedConfig?.length ? node.allowedConfig.join(", ") : "-"}
                    </span>
                  </div>
                  <div className="meta-block">
                    <span className="meta-label">输入</span>
                    <span className="meta-value">
                      {node.inputs?.length ? node.inputs.join(", ") : "-"}
                    </span>
                  </div>
                  <div className="meta-block">
                    <span className="meta-label">输出</span>
                    <span className="meta-value">
                      {node.outputs?.length ? node.outputs.join(", ") : "-"}
                    </span>
                  </div>
                </div>

                <div className="override-box">
                  <span className="meta-label">当前覆盖</span>
                  {overrideEntries.length > 0 ? (
                    <div className="override-list">
                      {overrideEntries.map(([key, value]) => (
                        <div className="override-item" key={`${nodeId}-${key}`}>
                          <strong>{key}</strong>
                          <span>{formatValue(value)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-text">当前场景沿用模板默认值。</p>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
