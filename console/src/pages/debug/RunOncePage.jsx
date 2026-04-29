import { useMemo, useState } from "react";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";

const scenePresets = {
  "payment-info-split": {
    label: "收款信息拆分",
    note: "默认示例走直模链路，通常最适合先验证前后端联调链路是否畅通。",
    tenantId: "tenant-a",
    userId: "user-a",
    bizParams: {
      rawText:
        "收款方：上海某某科技有限公司；开户行：中国银行上海浦东分行；账号：1234567890123456789"
    }
  },
  "sales-opportunity-advisor": {
    label: "销售机会推进建议（辅助链路）",
    note: "该场景依赖网关、上下文辅助器、模型工具和技能链路，适合验证运行时场景。",
    tenantId: "tenant-a",
    userId: "user-a",
    bizParams: {
      opportunityId: "2041340312877535232"
    }
  },
  "sales-opportunity-smart-entry": {
    label: "销售机会智能录入",
    note: "该场景是销售机会推进建议的独立复制场景，拥有自己的 skill、query 和可编辑资产文件。",
    tenantId: "tenant-a",
    userId: "user-a",
    bizParams: {
      opportunityId: "2041340312877535232",
      rawText:
        "客户确认这单属于招标已设计场景，推荐品牌可以替换，核心参数满足，投标时间改为2026-04-30，采购时间预计2026-05-20。"
    }
  },
  "sales-opportunity-advisor-directdb": {
    label: "销售机会推进建议（直连数据库）",
    note: "该场景依赖网关、直连数据库执行器、模型工具和技能链路，适合验证配置化第二业务。",
    tenantId: "tenant-a",
    userId: "user-a",
    bizParams: {
      opportunityId: "2041340312877535232"
    }
  },
  "special-custom-product-solution": {
    label: "特殊定制产品部方案",
    note: "该场景使用定制要求调用本地 RAG 检索相似片段，再生成产品部方案 JSON；需要 19104 RAG 服务可用。",
    tenantId: "tenant-a",
    userId: "user-a",
    bizParams: {
      specialCustomOrderNo: "TSDZ-20260428-001",
      customRequirement:
        "客户需要基于现有销售画像能力做一个特殊定制方案：支持按行业、区域和客户等级组合筛选，输出重点客户清单，并在页面展示推荐理由、最近拜访记录和下一步跟进建议。"
    }
  }
};

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function buildInitialFormState(scene = "payment-info-split") {
  const preset = scenePresets[scene];

  return {
    scene,
    tenantId: preset?.tenantId || "",
    userId: preset?.userId || "",
    bizParamsText: prettyJson(preset?.bizParams || {})
  };
}

function buildRequestBody({ scene, tenantId, userId, bizParams }) {
  const body = {
    scene,
    bizParams
  };

  const normalizedTenantId = tenantId.trim();
  const normalizedUserId = userId.trim();

  if (normalizedTenantId || normalizedUserId) {
    body.runtimeContext = {
      tenantId: normalizedTenantId || undefined,
      userId: normalizedUserId || undefined
    };
  }

  return body;
}

export function RunOncePage() {
  const [formState, setFormState] = useState(() =>
    buildInitialFormState("payment-info-split")
  );
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");
  const [lastRun, setLastRun] = useState(null);

  const selectedPreset = scenePresets[formState.scene];

  const requestPreview = useMemo(() => {
    try {
      const bizParams = JSON.parse(formState.bizParamsText);
      return prettyJson(
        buildRequestBody({
          scene: formState.scene,
          tenantId: formState.tenantId,
          userId: formState.userId,
          bizParams
        })
      );
    } catch {
      return "bizParams 不是合法 JSON，当前无法生成请求预览。";
    }
  }, [formState]);

  function updateField(field, value) {
    setFormState((current) => ({
      ...current,
      [field]: value
    }));
  }

  function applyPreset(scene) {
    setFormState(buildInitialFormState(scene));
    setLocalError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    let bizParams = null;
    try {
      bizParams = JSON.parse(formState.bizParamsText);
    } catch (error) {
      setLocalError(`bizParams JSON 解析失败：${error.message}`);
      return;
    }

    const requestBody = buildRequestBody({
      scene: formState.scene,
      tenantId: formState.tenantId,
      userId: formState.userId,
      bizParams
    });

    setSubmitting(true);
    const startedAt = Date.now();

    try {
      const response = await apiClient.runAgent(requestBody);
      setLastRun({
        requestBody,
        response,
        durationMs: Date.now() - startedAt,
        ranAt: new Date().toISOString()
      });
    } catch (error) {
      setLastRun({
        requestBody,
        response: {
          ok: false,
          status: 0,
          payload: {
            success: false,
            requestId: null,
            data: null,
            error: {
              code: "NETWORK_ERROR",
              message: error.message || "请求失败。",
              httpStatus: 0,
              stage: "console-submit",
              retryable: true,
              details: null
            }
          }
        },
        durationMs: Date.now() - startedAt,
        ranAt: new Date().toISOString()
      });
    } finally {
      setSubmitting(false);
    }
  }

  const responsePayload = lastRun?.response?.payload || null;
  const responseError = responsePayload?.error || null;

  return (
    <PageFrame
      eyebrow="调试"
      title="单次请求调试"
      description="本页始终调用真实 `POST /api/agent/run`，用于做最小联调、参数校验和错误定位。"
      actions={
        <div className="tag-list">
          <span className="tag tag-soft">真实接口：POST /api/agent/run</span>
          <span className="tag">不走模拟数据</span>
        </div>
      }
    >
      <div className="detail-grid">
        <section className="section-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">请求</p>
              <h4>请求表单</h4>
            </div>
            <button
              className="button-secondary"
              onClick={() => applyPreset(formState.scene)}
              type="button"
            >
              载入当前场景示例
            </button>
          </div>

          <form className="form-stack" onSubmit={handleSubmit}>
            <div className="field-group">
              <label htmlFor="scene">场景</label>
              <select
                className="field-input"
                id="scene"
                onChange={(event) => applyPreset(event.target.value)}
                value={formState.scene}
              >
                {Object.entries(scenePresets).map(([scene, preset]) => (
                  <option key={scene} value={scene}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <p className="field-help">{selectedPreset?.note}</p>
            </div>

            <div className="form-grid-two">
              <div className="field-group">
                <label htmlFor="tenantId">租户 ID</label>
                <input
                  className="field-input"
                  id="tenantId"
                  onChange={(event) => updateField("tenantId", event.target.value)}
                  placeholder="tenant-a"
                  type="text"
                  value={formState.tenantId}
                />
              </div>

              <div className="field-group">
                <label htmlFor="userId">用户 ID</label>
                <input
                  className="field-input"
                  id="userId"
                  onChange={(event) => updateField("userId", event.target.value)}
                  placeholder="user-a"
                  type="text"
                  value={formState.userId}
                />
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="bizParams">业务参数 JSON</label>
              <textarea
                className="field-input field-textarea"
                id="bizParams"
                onChange={(event) => updateField("bizParamsText", event.target.value)}
                spellCheck="false"
                value={formState.bizParamsText}
              />
              <p className="field-help">
                这里直接编辑业务参数对象，页面会自动拼成统一请求包。
              </p>
            </div>

            {localError ? (
              <div className="callout callout-error">
                <strong>本地校验失败</strong>
                <p>{localError}</p>
              </div>
            ) : null}

            <div className="button-row">
              <button className="button-primary" disabled={submitting} type="submit">
                {submitting ? "请求发送中..." : "发送真实请求"}
              </button>
            </div>
          </form>
        </section>

        <section className="section-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">预览</p>
              <h4>请求预览</h4>
            </div>
          </div>
          <div className="code-panel">
            <pre>{requestPreview}</pre>
          </div>
        </section>
      </div>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">响应</p>
            <h4>响应与错误信息</h4>
          </div>
          {lastRun ? (
            <span className="pill">{lastRun.durationMs} ms</span>
          ) : null}
        </div>

        {lastRun ? (
          <>
            <div className="response-summary">
              <div className="meta-block">
                <span className="meta-label">HTTP 状态</span>
                <span className="meta-value">{lastRun.response.status}</span>
              </div>
              <div className="meta-block">
                <span className="meta-label">是否成功</span>
                <span className="meta-value">
                  {String(Boolean(responsePayload?.success))}
                </span>
              </div>
              <div className="meta-block">
                <span className="meta-label">请求 ID</span>
                <span className="mono-text">
                  {responsePayload?.requestId || "-"}
                </span>
              </div>
              <div className="meta-block">
                <span className="meta-label">执行时间</span>
                <span className="meta-value">{lastRun.durationMs} ms</span>
              </div>
            </div>

            {responseError ? (
              <div className="callout callout-error">
                <strong>
                  {responseError.code || "REQUEST_FAILED"}
                </strong>
                <p>{responseError.message}</p>
              </div>
            ) : (
              <div className="callout callout-success">
                <strong>请求成功</strong>
                <p>已收到真实接口返回，可继续用这个页面做参数调试。</p>
              </div>
            )}

            <div className="detail-grid">
              <section className="section-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">提交内容</p>
                    <h4>实际提交请求</h4>
                  </div>
                </div>
                <div className="code-panel">
                  <pre>{prettyJson(lastRun.requestBody)}</pre>
                </div>
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">响应包</p>
                    <h4>原始响应</h4>
                  </div>
                </div>
                <div className="code-panel">
                  <pre>{prettyJson(responsePayload)}</pre>
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="empty-panel">
            <h4>还没有发起请求</h4>
            <p>先选择场景并提交一次真实 `/api/agent/run` 请求。</p>
          </div>
        )}
      </section>
    </PageFrame>
  );
}
