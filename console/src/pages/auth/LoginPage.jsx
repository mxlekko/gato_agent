import { useMemo, useState } from "react";
import { Button, Input, Message } from "@arco-design/web-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { authClient } from "../../services/authClient";

const DEFAULT_LOGIN_FORM = {
  username: "",
  password: ""
};

function resolveErrorMessage(response) {
  return response?.payload?.error?.message
    || response?.payload?.message
    || "登录失败，请检查账号和密码。";
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState(DEFAULT_LOGIN_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const redirectTo = useMemo(() => {
    const from = location.state?.from?.pathname;
    return from && from !== "/login" ? from : "/scenes";
  }, [location.state]);

  if (authClient.hasSession()) {
    return <Navigate to={redirectTo} replace />;
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const username = form.username.trim();
    const password = form.password.trim();

    if (!username || !password) {
      setError("请输入账号和密码。");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await authClient.login({ username, password });
      if (!response.ok || response.payload?.success === false) {
        setError(resolveErrorMessage(response));
        return;
      }

      Message.success("登录成功");
      navigate(redirectTo, { replace: true });
    } catch (caughtError) {
      setError(caughtError?.message || "登录请求失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <div className="brand-mark login-brand-mark" aria-hidden="true">
            <img src="/favicon.svg" alt="" />
          </div>
          <div>
            <h1 id="login-title">场景编排平台</h1>
            <p>管理员登录</p>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-field">
            <span>账号</span>
            <Input
              autoComplete="username"
              autoFocus
              onChange={(value) => updateField("username", value)}
              placeholder="请输入管理员账号"
              value={form.username}
            />
          </label>

          <label className="login-field">
            <span>密码</span>
            <Input.Password
              autoComplete="current-password"
              onChange={(value) => updateField("password", value)}
              placeholder="请输入管理员密码"
              value={form.password}
            />
          </label>

          {error ? <p className="login-error">{error}</p> : null}

          <Button
            className="login-submit"
            htmlType="submit"
            loading={submitting}
            long
            type="primary"
          >
            登录
          </Button>
        </form>
      </section>
    </main>
  );
}
