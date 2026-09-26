# 协作规范

## 开始开发

1. 安装 Node.js 24。
2. 从 `main` 拉取最新代码并建立独立分支。
3. 复制 `.env.example` 为 `.env`，只填写本地或服务器私有配置。
4. 按 README 启动服务并运行全量测试。

项目不依赖第三方 npm 包，不提交 `node_modules`、运行数据或生成目录。

## 分支与提交

- 功能：`feat/<name>`
- 修复：`fix/<name>`
- 文档：`docs/<name>`
- 运维：`chore/<name>`

提交信息使用 `feat:`、`fix:`、`docs:`、`test:`、`refactor:` 或 `chore:`。一个提交只处理一个主题，并同时包含对应测试或文档。

## 提交前检查

```powershell
git status --short
git diff --check
node --experimental-strip-types --test --test-force-exit .\test\*.test.js
```

确认暂存内容后再提交：

```powershell
git diff --cached
git commit -m "feat: describe one verified change"
```

## 敏感信息

禁止提交以下内容：

- `.env` 和生产环境配置；
- 私钥、访问令牌、Webhook 密钥和云服务凭据；
- SQLite 数据库、客户附件和备份；
- 微信开发者工具的 `project.private.config.json`；
- 带有客户个人信息、报价或付款数据的调试样本。

如凭据曾进入 Git，即使后来删除也应视为泄露，必须先吊销和轮换，再清理历史。

## 合并与发布

拉取请求必须说明改动范围、验证命令和结果。自动测试通过并完成审阅后才能合并到 `main`。发布时同步更新 `package.json` 与 `CHANGELOG.md`，再创建对应的 `vX.Y.Z` 标签。
