import { useEffect, useState } from "react";
import { Alert, App as AntdApp, Button, Form, Input, Spin } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

import { acceptInvitation, validateInvitation, type InvitationValidation } from "./auth.api";
import { useAuth } from "./AuthProvider";
import "./auth.less";

const passwordRules = [
  { required: true, message: "请输入密码" },
  { min: 8, message: "密码至少需要 8 位" },
  {
    validator: async (_: unknown, value: string | undefined) => {
      if (!value || (/[a-zA-Z]/u.test(value) && /[0-9]/u.test(value))) {
        return;
      }

      throw new Error("密码需要同时包含字母和数字");
    }
  }
];

/** 成员通过管理员发送的一次性链接设置首个密码并激活工作台账号。 */
export function ActivateInvitationPage() {
  const { message } = AntdApp.useApp();
  const { completeLogin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [invitation, setInvitation] = useState<InvitationValidation | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  /**
   * 页面加载时先向服务端校验链接。
   *
   * Token 是一次性凭证，不能只依靠前端是否存在 query 参数判断有效性；服务端会同时检查
   * 哈希、有效期、撤销和已使用状态。
   */
  useEffect(() => {
    let disposed = false;

    async function loadInvitation() {
      if (!token) {
        setValidationError("邀请链接无效或已过期");
        setLoading(false);
        return;
      }

      setLoading(true);
      setValidationError(null);

      try {
        const result = await validateInvitation(token);
        if (!disposed) {
          setInvitation(result);
        }
      } catch (error) {
        if (!disposed) {
          setValidationError(error instanceof Error ? error.message : "邀请链接无效或已过期");
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    void loadInvitation();
    return () => {
      disposed = true;
    };
  }, [token]);

  /** 激活成功后复用统一登录态入口，确保 Access Token 只驻留在内存。 */
  async function handleFinish(values: { password: string; confirmPassword: string }) {
    setSubmitting(true);

    try {
      const response = await acceptInvitation(token, values.password);
      completeLogin(response);
      message.success("账号已激活");
      navigate(response.user.role === "ADMIN" ? "/agents" : "/chat", { replace: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "账号激活失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="loginPage">
      <section className="loginPanel" aria-label="激活 Mia 账号">
        <div className="loginBrand">
          <div className="brandMark">M</div>
          <div>
            <div className="brandName">Mia</div>
            <div className="brandMeta">AI Agent 平台</div>
          </div>
        </div>
        <h1>激活团队账号</h1>
        {loading ? (
          <div className="activationLoading">
            <Spin />
          </div>
        ) : validationError || !invitation ? (
          <Alert message={validationError || "邀请链接无效或已过期"} showIcon type="error" />
        ) : (
          <>
            <p>
              {invitation.displayName}，请为 {invitation.email} 设置登录密码。
            </p>
            <Form layout="vertical" requiredMark={false} onFinish={handleFinish}>
              <Form.Item label="密码" name="password" rules={passwordRules}>
                <Input.Password
                  autoComplete="new-password"
                  placeholder="至少 8 位，包含字母和数字"
                  size="large"
                />
              </Form.Item>
              <Form.Item
                dependencies={["password"]}
                label="确认密码"
                name="confirmPassword"
                rules={[
                  { required: true, message: "请再次输入密码" },
                  ({ getFieldValue }) => ({
                    validator: async (_: unknown, value: string | undefined) => {
                      if (!value || getFieldValue("password") === value) {
                        return;
                      }

                      throw new Error("两次输入的密码不一致");
                    }
                  })
                ]}
              >
                <Input.Password
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  size="large"
                />
              </Form.Item>
              <Button block htmlType="submit" loading={submitting} size="large" type="primary">
                激活并进入工作台
              </Button>
            </Form>
          </>
        )}
      </section>
    </main>
  );
}
