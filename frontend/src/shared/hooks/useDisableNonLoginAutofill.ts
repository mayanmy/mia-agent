import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

const IGNORED_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "file",
  "hidden",
  "image",
  "radio",
  "reset",
  "submit"
]);

/**
 * 为非登录页面的原生表单控件补齐禁用凭据填充标记。
 *
 * Ant Design 的 Select、Pagination 等组件会在运行时创建内部 input，单靠业务组件上的
 * autoComplete 无法覆盖；MutationObserver 用于同步处理这些延迟挂载的控件。
 */
export function useDisableNonLoginAutofill() {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    if (pathname === "/login") return;

    const applyPolicy = (root: ParentNode) => {
      if (root instanceof HTMLFormElement) {
        disableFormAutofill(root);
      }
      if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) {
        disableControlAutofill(root);
      }

      root.querySelectorAll("form").forEach(disableFormAutofill);
      root.querySelectorAll("input, textarea").forEach((element) => {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          disableControlAutofill(element);
        }
      });
    };

    applyPolicy(document.body);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLElement) {
          applyPolicy(record.target);
          continue;
        }
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) applyPolicy(node);
        });
      }
    });
    observer.observe(document.body, {
      attributeFilter: ["autocomplete"],
      attributes: true,
      childList: true,
      subtree: true
    });

    return () => observer.disconnect();
  }, [pathname]);
}

function disableFormAutofill(form: HTMLFormElement) {
  if (form.closest('[data-allow-autofill="true"]')) return;
  setAttributeIfNeeded(form, "autocomplete", "off");
  setAttributeIfNeeded(form, "data-form-type", "other");
}

function disableControlAutofill(control: HTMLInputElement | HTMLTextAreaElement) {
  if (control.closest('[data-allow-autofill="true"]')) return;
  if (control instanceof HTMLInputElement && IGNORED_INPUT_TYPES.has(control.type)) return;

  // one-time-code 比 off 更能避免 Chromium 把普通搜索框启发式识别成用户名输入框。
  const autocomplete =
    control instanceof HTMLInputElement && control.type === "password"
      ? "new-password"
      : "one-time-code";
  setAttributeIfNeeded(control, "autocomplete", autocomplete);

  // 同时屏蔽常见第三方密码管理器；浏览器原生密码管理器仍以 autocomplete 为准。
  setAttributeIfNeeded(control, "data-1p-ignore", "true");
  setAttributeIfNeeded(control, "data-lpignore", "true");
  setAttributeIfNeeded(control, "data-bwignore", "true");
  setAttributeIfNeeded(control, "data-form-type", "other");
}

function setAttributeIfNeeded(element: Element, name: string, value: string) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
