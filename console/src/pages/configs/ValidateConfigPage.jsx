import { useEffect, useState } from "react";
import { PageFrame } from "../../components/PageFrame";
import { apiClient } from "../../services/apiClient";

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function KeyValueList({ items }) {
  return (
    <div className="kv-grid">
      {items.map((item) => (
        <div className="meta-block" key={item.label}>
          <span className="meta-label">{item.label}</span>
          <span className="meta-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function IssueList({ issues = [] }) {
  if (issues.length === 0) {
    return (
      <div className="callout callout-success">
        <strong>当前没有校验问题</strong>
        <p>平台配置校验器返回 0 个问题，可以继续做编译预览。</p>
      </div>
    );
  }

  return (
    <div className="simple-list">
      {issues.map((issue, index) => (
        <div className="simple-list-row" key={`${issue.code}-${issue.file}-${index}`}>
          <div>
            <strong>{issue.code}</strong>
            <p>{issue.message}</p>
          </div>
          <span className="mono-text">{issue.file || "-"}</span>
        </div>
      ))}
    </div>
  );
}

export function ValidateConfigPage() {
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function runValidation() {
      setStatus("loading");
      setErrorMessage("");

      try {
        const response = await apiClient.validateConfigs({});
        if (!active) {
          return;
        }

        if (!response?.ok || response?.payload?.success === false) {
          setResult(null);
          setStatus("error");
          setErrorMessage(
            response?.payload?.error?.message || "配置校验失败。"
          );
          return;
        }

        setResult(response?.payload?.data || null);
        setStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        setResult(null);
        setStatus("error");
        setErrorMessage(error.message || "配置校验失败。");
      }
    }

    runValidation();

    return () => {
      active = false;
    };
  }, []);

  async function handleRerun() {
    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await apiClient.validateConfigs({});
      if (!response?.ok || response?.payload?.success === false) {
        setResult(null);
        setStatus("error");
        setErrorMessage(
          response?.payload?.error?.message || "配置校验失败。"
        );
        return;
      }

      setResult(response?.payload?.data || null);
      setStatus("ready");
    } catch (error) {
      setResult(null);
      setStatus("error");
      setErrorMessage(error.message || "配置校验失败。");
    }
  }

  const counts = result?.counts || {};
  const issues = Array.isArray(result?.issues) ? result.issues : [];

  return (
    <PageFrame
      eyebrow="配置"
      title="配置校验"
      description="触发真实平台校验器，先看校验结果、资源数量和阻塞问题，再决定是否进入编译预览。"
      actions={<span className="pill">真实接口：POST /api/console/configs/validate</span>}
    >
      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">校验</p>
            <h4>平台配置校验</h4>
          </div>
          <div className="button-row">
            <button
              className="button-primary"
              disabled={status === "loading"}
              onClick={handleRerun}
              type="button"
            >
              {status === "loading" ? "校验中..." : "重新校验"}
            </button>
          </div>
        </div>
        <p className="section-text">
          当前只开放受控的全量校验入口，不允许前端绕过平台规则做本地假校验。
        </p>
      </section>

      {status === "error" ? (
        <section className="section-card">
          <h4>校验失败</h4>
          <p className="muted-text">{errorMessage}</p>
        </section>
      ) : null}

      {result ? (
        <>
          <section className="stats-grid">
            <article className="stat-card">
              <span className="meta-label">校验结论</span>
              <strong>{result.valid ? "通过" : "未通过"}</strong>
              <p>{result.mode || "全量"}</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">问题数量</span>
              <strong>{result.issueCount ?? issues.length}</strong>
              <p>阻塞项和告警都在下方明细里。</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">业务技能</span>
              <strong>{counts.skills ?? "-"}</strong>
              <p>当前注册的业务技能数量。</p>
            </article>
            <article className="stat-card">
              <span className="meta-label">工具 / 查询</span>
              <strong>{`${counts.tools ?? "-"} / ${counts.queries ?? "-"}`}</strong>
              <p>{`模板=${counts.templates ?? "-"}`}</p>
            </article>
          </section>

          <section className="detail-grid">
            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">摘要</p>
                  <h4>结果摘要</h4>
                </div>
              </div>
              <KeyValueList
                items={[
                  { label: "校验模式", value: result.mode || "-" },
                  { label: "校验对象", value: result.subject || "平台注册表" },
                  { label: "模板", value: String(counts.templates ?? "-") },
                  { label: "业务技能", value: String(counts.skills ?? "-") }
                ]}
              />
              {result.valid ? (
                <div className="callout callout-success">
                  <strong>当前配置通过校验</strong>
                  <p>可以继续到编译预览页检查节点顺序、条件分支和覆盖点。</p>
                </div>
              ) : (
                <div className="callout callout-error">
                  <strong>存在待处理问题</strong>
                  <p>先修复阻塞项，再进入流程编译预览。</p>
                </div>
              )}
            </section>

            <section className="section-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">原始数据</p>
                  <h4>原始输出</h4>
                </div>
              </div>
              <div className="code-panel">
                <pre>{prettyJson(result)}</pre>
              </div>
            </section>
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                  <p className="eyebrow">问题</p>
                  <h4>校验明细</h4>
              </div>
              <span className="pill">{issues.length} 条</span>
            </div>
            <IssueList issues={issues} />
          </section>
        </>
      ) : null}

      {status === "loading" ? (
        <section className="section-card">
          <h4>正在校验</h4>
          <p className="muted-text">读取真实平台配置校验结果中。</p>
        </section>
      ) : null}
    </PageFrame>
  );
}
