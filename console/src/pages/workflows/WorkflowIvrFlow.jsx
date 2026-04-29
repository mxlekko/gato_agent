import { buildNodeRemark } from "./WorkflowNodeList";

const CARD_WIDTH = 228;
const CARD_HEIGHT = 132;
const GAP_X = 58;
const LANE_HEIGHT = 196;
const CANVAS_LEFT = 24;
const CANVAS_TOP = 58;
const SHELL_PAD_X = 16;
const SHELL_PAD_TOP = 34;
const SHELL_PAD_BOTTOM = 18;

function formatNodeTitle(node) {
  return node?.id || "-";
}

function buildPhaseLabel(phase) {
  return {
    bootstrap: "启动",
    contract: "契约",
    input: "入参",
    policy: "权限",
    data: "取数",
    reference: "引用",
    transform: "转换",
    generation: "生成",
    reasoning: "生成",
    validation: "校验",
    output: "输出",
    observe: "观测"
  }[phase] || phase || "默认";
}

function buildDefaultEdges(orderedNodeIds = [], defaultNextByNodeId = {}) {
  if (Object.keys(defaultNextByNodeId || {}).length > 0) {
    return Object.entries(defaultNextByNodeId)
      .filter(([, to]) => to)
      .map(([from, to]) => ({ from, to }));
  }

  return orderedNodeIds.slice(0, -1).map((nodeId, index) => ({
    from: nodeId,
    to: orderedNodeIds[index + 1]
  }));
}

function buildEdgePath(fromPosition, toPosition, offset = 0) {
  const fromX = fromPosition.x + CARD_WIDTH;
  const fromY = fromPosition.y + CARD_HEIGHT / 2;
  const toX = toPosition.x;
  const toY = toPosition.y + CARD_HEIGHT / 2;
  const controlGap = Math.max(42, Math.abs(toX - fromX) / 2);
  const controlOffset = offset * 18;

  return `M ${fromX} ${fromY} C ${fromX + controlGap} ${fromY + controlOffset}, ${toX - controlGap} ${toY - controlOffset}, ${toX} ${toY}`;
}

export function buildNodeShell(node = {}) {
  if (node.toolRole === "knowledge_retriever" || node.category === "knowledge") {
    return {
      key: "knowledge-tool",
      label: "RAG Tool",
      detail: "向量检索 / 相似片段"
    };
  }

  if (node.toolRole === "context_fetcher" || node.id === "resolve_data_plan") {
    return {
      key: "query-tool",
      label: "查询 Tool",
      detail: "取数计划 / 数据查询"
    };
  }

  if (node.toolRole === "output_validator") {
    return {
      key: "validation-tool",
      label: "校验 Tool",
      detail: "结构校验 / 归一"
    };
  }

  if (
    node.toolRole === "advisory_llm"
    || ["load_reference_bundle", "normalize_facts", "select_basis_fields"].includes(node.id)
  ) {
    return {
      key: "business-skill",
      label: "Business Skill",
      detail: "业务编排 / 生成逻辑"
    };
  }

  return {
    key: "platform-runtime",
    label: "平台运行壳",
    detail: "契约 / 权限 / 收口"
  };
}

function buildShellGroups(flowNodes, positions) {
  const groups = [];

  for (const flowNode of flowNodes) {
    const shell = buildNodeShell(flowNode.node);
    const previousGroup = groups[groups.length - 1];

    if (previousGroup?.shell.key === shell.key) {
      previousGroup.nodes.push(flowNode);
    } else {
      groups.push({
        shell,
        nodes: [flowNode]
      });
    }
  }

  return groups.map((group, index) => {
    const bounds = group.nodes.reduce(
      (nextBounds, flowNode) => {
        const position = positions[flowNode.id];
        return {
          minX: Math.min(nextBounds.minX, position.x),
          maxX: Math.max(nextBounds.maxX, position.x + CARD_WIDTH),
          minY: Math.min(nextBounds.minY, position.y),
          maxY: Math.max(nextBounds.maxY, position.y + CARD_HEIGHT)
        };
      },
      {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity
      }
    );

    return {
      ...group,
      id: `${group.shell.key}-${index}`,
      x: bounds.minX - SHELL_PAD_X,
      y: bounds.minY - SHELL_PAD_TOP,
      width: bounds.maxX - bounds.minX + SHELL_PAD_X * 2,
      height: bounds.maxY - bounds.minY + SHELL_PAD_TOP + SHELL_PAD_BOTTOM
    };
  });
}

export function WorkflowIvrFlow({
  orderedNodeIds = [],
  nodesById = {},
  defaultNextByNodeId = {},
  conditionalEdges = [],
  eyebrow = "IVR",
  title = "连线流程视图",
  description = null,
  visibleShellKeys = ["platform-runtime", "query-tool", "knowledge-tool", "business-skill", "validation-tool"]
}) {
  if (orderedNodeIds.length === 0) {
    return (
      <section className="section-card">
        <h4>{title}</h4>
        <p className="muted-text">当前场景没有可展示的流程节点。</p>
      </section>
    );
  }

  const flowNodes = orderedNodeIds.map((nodeId, index) => ({
    id: nodeId,
    index,
    node: nodesById[nodeId] || { id: nodeId }
  }));
  const phases = Array.from(
    new Set(flowNodes.map(({ node }) => node.phase || "default"))
  );
  const positions = Object.fromEntries(
    flowNodes.map(({ id, index, node }) => {
      const phaseIndex = Math.max(0, phases.indexOf(node.phase || "default"));
      return [
        id,
        {
          x: CANVAS_LEFT + index * (CARD_WIDTH + GAP_X),
          y: CANVAS_TOP + phaseIndex * LANE_HEIGHT
        }
      ];
    })
  );
  const defaultEdges = buildDefaultEdges(orderedNodeIds, defaultNextByNodeId)
    .filter((edge) => positions[edge.from] && positions[edge.to]);
  const visibleConditionalEdges = conditionalEdges
    .filter((edge) => positions[edge.from] && positions[edge.to]);
  const globalConditionalEdges = conditionalEdges
    .filter((edge) => edge.from === "any" || !positions[edge.from] || !positions[edge.to]);
  const shellGroups = buildShellGroups(flowNodes, positions);
  const canvasWidth = CANVAS_LEFT * 2 + orderedNodeIds.length * CARD_WIDTH + Math.max(0, orderedNodeIds.length - 1) * GAP_X;
  const canvasHeight = CANVAS_TOP + phases.length * LANE_HEIGHT + 24;

  return (
    <section className="section-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h4>{title}</h4>
        </div>
        <span className="pill">{defaultEdges.length + visibleConditionalEdges.length} 条连线</span>
      </div>
      {description ? <p className="section-text">{description}</p> : null}
      <div className="ivr-shell-legend">
        {visibleShellKeys.includes("platform-runtime") ? (
          <span className="ivr-shell-chip ivr-shell-chip-platform-runtime">平台运行壳</span>
        ) : null}
        {visibleShellKeys.includes("query-tool") ? (
          <span className="ivr-shell-chip ivr-shell-chip-query-tool">查询 Tool</span>
        ) : null}
        {visibleShellKeys.includes("knowledge-tool") ? (
          <span className="ivr-shell-chip ivr-shell-chip-knowledge-tool">RAG Tool</span>
        ) : null}
        {visibleShellKeys.includes("business-skill") ? (
          <span className="ivr-shell-chip ivr-shell-chip-business-skill">Business Skill</span>
        ) : null}
        {visibleShellKeys.includes("validation-tool") ? (
          <span className="ivr-shell-chip ivr-shell-chip-validation-tool">校验 Tool</span>
        ) : null}
      </div>

      <div className="ivr-flow-shell">
        <div
          className="ivr-flow-canvas"
          style={{ minWidth: `${canvasWidth}px`, height: `${canvasHeight}px` }}
        >
          {phases.map((phase, index) => (
            <div
              className="ivr-lane"
              key={phase}
              style={{
                top: `${CANVAS_TOP + index * LANE_HEIGHT - 16}px`,
                width: `${canvasWidth - CANVAS_LEFT * 2}px`
              }}
            >
              <span>{buildPhaseLabel(phase)}</span>
            </div>
          ))}

          {shellGroups.map((group) => (
            <div
              className={`ivr-shell-box ivr-shell-${group.shell.key}`}
              key={group.id}
              style={{
                left: `${group.x}px`,
                top: `${group.y}px`,
                width: `${group.width}px`,
                height: `${group.height}px`
              }}
            >
              <span>{group.shell.label}</span>
              <em>{group.shell.detail}</em>
            </div>
          ))}

          <svg
            aria-hidden="true"
            className="ivr-flow-lines"
            height={canvasHeight}
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            width={canvasWidth}
          >
            <defs>
              <marker
                id="ivr-arrow"
                markerHeight="8"
                markerWidth="8"
                orient="auto"
                refX="7"
                refY="4"
                viewBox="0 0 8 8"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" />
              </marker>
              <marker
                id="ivr-arrow-dashed"
                markerHeight="8"
                markerWidth="8"
                orient="auto"
                refX="7"
                refY="4"
                viewBox="0 0 8 8"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" />
              </marker>
            </defs>
            {defaultEdges.map((edge) => (
              <path
                className="ivr-edge-default"
                d={buildEdgePath(positions[edge.from], positions[edge.to])}
                key={`${edge.from}-${edge.to}`}
                markerEnd="url(#ivr-arrow)"
              />
            ))}
            {visibleConditionalEdges.map((edge, index) => (
              <path
                className="ivr-edge-conditional"
                d={buildEdgePath(positions[edge.from], positions[edge.to], (index % 3) + 1)}
                key={`${edge.from}-${edge.to}-${edge.when}`}
                markerEnd="url(#ivr-arrow-dashed)"
              />
            ))}
          </svg>

          {flowNodes.map(({ id, index, node }) => {
            const position = positions[id];
            return (
              <article
                className="ivr-node-card"
                key={id}
                style={{
                  left: `${position.x}px`,
                  top: `${position.y}px`,
                  width: `${CARD_WIDTH}px`,
                  height: `${CARD_HEIGHT}px`
                }}
              >
                <div className="ivr-node-topline">
                  <span>{index + 1}</span>
                  <em>{buildPhaseLabel(node.phase)}</em>
                </div>
                <strong>{formatNodeTitle(node)}</strong>
                <p>{buildNodeRemark(node)}</p>
              </article>
            );
          })}
        </div>
      </div>

      {visibleConditionalEdges.length > 0 || globalConditionalEdges.length > 0 ? (
        <div className="ivr-branch-list">
          {visibleConditionalEdges.map((edge) => (
            <div className="ivr-branch-item" key={`${edge.from}-${edge.to}-${edge.when}`}>
              <strong>{edge.from} -&gt; {edge.to}</strong>
              <p>{edge.description || "满足条件时按该分支跳转。"}</p>
              <span>{edge.when}</span>
            </div>
          ))}
          {globalConditionalEdges.map((edge) => (
            <div className="ivr-branch-item" key={`${edge.from}-${edge.to}-${edge.when}`}>
              <strong>{edge.from} -&gt; {edge.to}</strong>
              <p>{edge.description || "满足条件时按该分支跳转。"}</p>
              <span>{edge.when}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
