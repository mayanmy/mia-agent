import { useState } from "react";
import { App as AntdApp, Button, Form, Input } from "antd";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { login } from "./auth.api";
import { useAuth } from "./AuthProvider";
import "./auth.less";

/** 登录页只处理凭证提交，登录态持久化和刷新由 AuthProvider 统一负责。 */
export function LoginPage() {
  const { message } = AntdApp.useApp();
  const { status, completeLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);

  if (status === "authenticated") {
    return <Navigate replace to="/agents" />;
  }

  /**
   * 提交邮箱密码并保存短期登录态。
   *
   * 登录成功后优先回到被路由守卫拦截的原页面；未记录来源时统一进入 Agent 管理页。
   */
  async function handleFinish(values: { email: string; password: string }) {
    setSubmitting(true);

    try {
      const response = await login(values.email, values.password);
      completeLogin(response);
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(from || "/agents", { replace: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="loginPage">
      <section className="loginPanel" aria-label="Mia 登录">
        <div className="loginBrand">
          <img src="/mia-logo.png" alt="Mia" className="brandLogo" />
          <div>
            <div className="brandName">Mia</div>
            <div className="brandMeta">AI Agent 平台</div>
          </div>
        </div>
        <h1>登录工作台</h1>
        <p>使用团队账号访问 Agent、知识库和模型配置。</p>
        <Form
          data-allow-autofill="true"
          layout="vertical"
          requiredMark={false}
          onFinish={handleFinish}
        >
          <Form.Item
            label="邮箱"
            name="email"
            rules={[
              { required: true, message: "请输入邮箱" },
              { type: "email", message: "邮箱格式不正确" }
            ]}
          >
            <Input autoComplete="email" placeholder="name@example.com" size="large" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password autoComplete="current-password" placeholder="请输入密码" size="large" />
          </Form.Item>
          <Button block htmlType="submit" loading={submitting} size="large" type="primary">
            登录
          </Button>
        </Form>
      </section>
    </main>
  );
}
