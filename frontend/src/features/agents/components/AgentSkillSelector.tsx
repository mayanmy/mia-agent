import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined } from "@ant-design/icons";
import { Button, Empty, Select } from "antd";

import type { SkillOption } from "../../skills/api";

type AgentSkillSelectorProps = {
  skills: SkillOption[];
  value: string[];
  onChange: (skillIds: string[]) => void;
};

/** 维护 Skill 的显式顺序；按钮同时支持键盘，避免顺序调整只依赖拖拽。 */
export function AgentSkillSelector({ skills, value, onChange }: AgentSkillSelectorProps) {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const available = skills.filter((skill) => !value.includes(skill.id));

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="agentSkillSelector">
      <Select
        allowClear
        showSearch
        value={undefined}
        optionFilterProp="label"
        placeholder="添加已启用的 Skill"
        options={available.map((skill) => ({
          label: `${skill.name} · revision ${skill.revision}`,
          value: skill.id
        }))}
        onChange={(skillId) => skillId && onChange([...value, skillId])}
      />
      {value.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未绑定 Skill" />
      ) : (
        <ol className="agentSkillList">
          {value.map((skillId, index) => {
            const skill = byId.get(skillId);
            return (
              <li key={skillId}>
                <div>
                  <strong>{skill?.name ?? "已停用或归档的 Skill"}</strong>
                  <small>
                    {skill
                      ? `${skill.description || "无描述"} · revision ${skill.revision}`
                      : skillId}
                  </small>
                </div>
                <span>
                  <Button
                    aria-label="上移 Skill"
                    disabled={index === 0}
                    icon={<ArrowUpOutlined />}
                    size="small"
                    onClick={() => move(index, -1)}
                  />
                  <Button
                    aria-label="下移 Skill"
                    disabled={index === value.length - 1}
                    icon={<ArrowDownOutlined />}
                    size="small"
                    onClick={() => move(index, 1)}
                  />
                  <Button
                    aria-label="移除 Skill"
                    danger
                    icon={<DeleteOutlined />}
                    size="small"
                    onClick={() => onChange(value.filter((id) => id !== skillId))}
                  />
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
