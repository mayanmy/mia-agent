import { Card } from "antd";
import { ProviderTemplate } from "../types";

type ProviderMarketplaceProps = {
  templates: ProviderTemplate[];
  onCreateProvider: (template: ProviderTemplate) => void;
};

export function ProviderMarketplace({ templates, onCreateProvider }: ProviderMarketplaceProps) {
  return (
    <>
      <div className="marketplaceHeader">
        <h2>安装模型供应商</h2>
      </div>
      <div className="marketplaceGrid">
        {templates.map((template) => (
          <Card
            className="marketplaceCard"
            hoverable
            key={template.name}
            onClick={() => onCreateProvider(template)}
          >
            <div className="marketplaceCardHeader">
              <div className="marketplaceLogo" style={{ backgroundColor: template.accent }}>
                {template.logo}
              </div>
              <div>
                <strong>{template.name}</strong>
                <p>
                  {template.author} · ⇩ {template.downloads}
                </p>
              </div>
            </div>
            <p className="marketplaceDescription">{template.description}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
