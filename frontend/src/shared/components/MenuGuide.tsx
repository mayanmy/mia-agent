import { useState } from "react";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Collapse, Drawer, Steps } from "antd";

export type MenuGuideSection = {
  key: string;
  label: string;
  items: Array<{ name: string; description: string }>;
};

export type MenuGuideProps = {
  title: string;
  summary: string;
  tip: string;
  steps: Array<{ title: string; description: string }>;
  sections: MenuGuideSection[];
  buttonLabel?: string;
};

/** 各工作台菜单复用的新手指南入口；页面只提供自己的业务内容。 */
export function MenuGuide({
  title,
  summary,
  tip,
  steps,
  sections,
  buttonLabel = "使用指南"
}: MenuGuideProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button icon={<QuestionCircleOutlined />} onClick={() => setOpen(true)}>
        {buttonLabel}
      </Button>
      <Drawer
        open={open}
        placement="right"
        title={title}
        width="min(560px, 100vw)"
        onClose={() => setOpen(false)}
      >
        <div className="menuGuide">
          <Alert showIcon message={summary} type="info" />
          <section>
            <h3>快速上手</h3>
            <Steps direction="vertical" size="small" items={steps} />
          </section>
          <Collapse
            bordered={false}
            defaultActiveKey={[sections[0]?.key]}
            items={sections.map((section) => ({
              key: section.key,
              label: section.label,
              children: (
                <div className="menuGuideRows">
                  {section.items.map((item) => (
                    <div key={item.name}>
                      <strong>{item.name}</strong>
                      <span>{item.description}</span>
                    </div>
                  ))}
                </div>
              )
            }))}
          />
          <Alert showIcon message={tip} type="warning" />
        </div>
      </Drawer>
    </>
  );
}
