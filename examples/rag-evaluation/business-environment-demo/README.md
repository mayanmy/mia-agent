# 营商服务 RAG 小型回归集

这是一个可闭环运行的 Mia 示例包，包含一份自编知识库文档和 22 条评估用例。

## 数据选择说明

主题参考国务院《优化营商环境条例》中适合 RAG 检索的公开原则，例如平等服务、政务公开、一次性告知、在线办理、涉企收费目录、随机检查和意见征集。示例手册是为测试重新编写的虚构材料，不应作为现实法律或办事依据。

参考来源：

- 国家互联网信息办公室转载的[《优化营商环境条例》全文](https://www.cac.gov.cn/2019-10/24/c_1573449009280962.htm?from=groupmessage)
- 国家行政法规库中的[《优化营商环境条例》](https://xzfg.moj.gov.cn/front/law/detail?LawID=447&Query=%E7%9F%A5%E8%AF%86%E4%BA%A7%E6%9D%83)

## 文件

- `knowledge/营商服务操作手册.md`：上传到 Mia 知识库的唯一文档。
- `dataset/evaluation-cases.template.jsonl`：包含占位文档 UUID 的数据集模板。
- `prepare-dataset.mjs`：将占位 UUID 替换为上传后生成的真实文档 ID。

## 闭环操作

1. 在 Mia 创建知识库“营商服务回归测试”，上传 `knowledge/营商服务操作手册.md`。
2. 等待文档状态变为“已索引”。
3. 从知识库文档列表或接口响应复制该文档的 UUID。
4. 在本目录运行：

   ```bash
   node prepare-dataset.mjs <真实文档UUID>
   ```

5. 在“评估数据集”创建数据集并导入生成的 `dataset/evaluation-cases.ready.jsonl`。
6. 检查预览应为 22 条有效、0 条错误，然后冻结版本。
7. 创建 Baseline：Top K = 5，不设置分数阈值。
8. 创建 Candidate：Top K = 8，分数阈值可从 0.45 开始。
9. 在运行报告中检查 Recall@5、HitRate@5、MRR、空召回率、成功率和 P95 延迟，并选择 Baseline 对比。

## 为什么先标注文档 ID

切片 ID 会随切分配置变化，不适合作为第一轮示例包中的静态值。文档 ID 在一次知识库索引生命周期内稳定，足以验证文档级 HitRate 和 Recall。后续若要测试精确 Chunk 召回，可从 RAG Trace 中复制稳定的 Chunk ID，补入 `expected_chunk_ids` 后创建新的数据集版本。

## 样本构成

- 事实题：办理事项、时限、渠道和材料。
- 多条件题：监管、投诉和规则发布。
- 易混淆题：允许与禁止、一般监管与重点监管。
- 不可回答题：贷款利率、采购评分、专利费用和数据保存年限。

当前基础运行会对有文档标注的 18 条样本计算检索指标；4 条不可回答样本用于人工检查拒答表现。LLM 裁判上线后，可直接使用已有 `expected_answer` 计算正确性、忠实度和拒答准确率。
