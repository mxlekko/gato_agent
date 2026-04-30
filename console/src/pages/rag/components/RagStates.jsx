import { Alert, Button, Empty, Modal, Spin } from "@arco-design/web-react";

function errorMessage(error) {
  if (!error) {
    return "请求未完成。";
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || error.error?.message || "请求失败。";
}

export function RagLoadingState({ label = "加载中" }) {
  return (
    <div className="rag-state rag-state-loading" role="status">
      <Spin />
      <strong>{label}</strong>
    </div>
  );
}

export function RagErrorState({ error, onRetry }) {
  return (
    <Alert
      action={onRetry ? <Button size="mini" onClick={onRetry}>重试</Button> : null}
      className="rag-state-alert"
      content={errorMessage(error)}
      title="请求失败"
      type="error"
    />
  );
}

export function RagEmptyState({ title = "暂无数据", detail = "当前没有可展示的记录。" }) {
  return (
    <Empty className="rag-empty" description={`${title}。${detail}`} />
  );
}

export function RagStatusBanner({ status = "neutral", title, detail }) {
  const alertType = {
    success: "success",
    warning: "warning",
    error: "error",
    neutral: "info"
  }[status] || "info";

  return (
    <Alert className="rag-state-alert" content={detail} title={title} type={alertType} />
  );
}

export function RagConfirmDialog({
  open,
  title = "确认操作",
  detail,
  confirmLabel = "确认",
  cancelLabel = "取消",
  onConfirm,
  onCancel
}) {
  return (
    <Modal
      cancelText={cancelLabel}
      okText={confirmLabel}
      onCancel={onCancel}
      onOk={onConfirm}
      title={title}
      visible={open}
    >
      {detail ? <p className="modal-detail-text">{detail}</p> : null}
    </Modal>
  );
}
