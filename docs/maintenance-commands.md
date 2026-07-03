# 维护命令

本文件记录低频、一次性或生产修复类命令。它们不放入 `package.json`，避免把日常开发脚本和临时运维动作混在一起。

执行生产命令前，先确认：

- 已备份数据库或至少备份相关表。
- 先 dry-run，看清楚输出的 before/after。
- 优先按知识库小批量执行。
- 执行输出要保存成日志，方便审计和回滚。

## 修复历史文档文件名乱码

适用场景：

- 旧版本上传中文文件名后，`knowledge_documents.original_filename` 出现 `å`、`ç`、`æ` 等乱码。
- 只需要修复前端展示名，不修改磁盘物理文件名、`filename`、`storage_path`、chunk 或 embedding。

本地 dry-run：

```bash
node backend/scripts/fix-mojibake-document-filenames.mjs
```

本地执行修复：

```bash
node backend/scripts/fix-mojibake-document-filenames.mjs --apply
```

生产 dry-run 并保存日志：

```bash
NODE_ENV=production node backend/scripts/fix-mojibake-document-filenames.mjs > filename-fix-preview.log
```

生产按知识库 dry-run：

```bash
NODE_ENV=production node backend/scripts/fix-mojibake-document-filenames.mjs --knowledge-base-id=<id> > filename-fix-preview.log
```

生产按知识库执行修复并保存日志：

```bash
NODE_ENV=production node backend/scripts/fix-mojibake-document-filenames.mjs --knowledge-base-id=<id> --apply > filename-fix-apply.log
```

回滚说明：

- 该脚本只更新 `knowledge_documents.original_filename`。
- 如果误修，按执行日志里的 `before` 值写回即可。
- 因为不动磁盘文件和向量索引，所以回滚范围只影响前端展示名。
