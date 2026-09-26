# Git 版本管理说明

以下命令均在 `website` 目录中执行。

## 分支和提交约定

- `main` 始终保持可启动、测试通过，不直接提交未经验证的实验代码。
- 功能使用 `feat/<简短名称>`，修复使用 `fix/<简短名称>`，文档使用 `docs/<简短名称>`。
- 每次提交只包含一个可独立说明的改动，避免同时混入无关格式化。
- 提交信息使用 `feat:`、`fix:`、`docs:`、`test:`、`refactor:`、`chore:` 前缀。
- 合并前运行 `npm test` 或 README 中的纯 Node 测试命令。

任何 `.env`、私钥、数据库、客户附件、备份和生产配置都不得提交。提交前必须检查：

```powershell
git status --short
git diff --check
git diff --cached
```

## 查看当前状态和历史

```powershell
git status
git log --oneline --decorate -10
```

## 比较尚未提交的修改

```powershell
git diff
git diff -- public/index.html
```

## 保存一次网站改造

```powershell
git add -A
git commit -m "feat: 说明本次独立改造内容"
```

建议每完成一个可独立验收的改造就提交一次，不要把多项无关修改混在同一提交中。

## 比较两个历史版本

先用 `git log --oneline` 查找版本编号，再执行：

```powershell
git diff 旧版本编号..新版本编号
git diff 旧版本编号..新版本编号 -- public/index.html
```

## 恢复文件

恢复尚未提交的单个文件：

```powershell
git restore -- public/index.html
```

从指定历史版本恢复单个文件：

```powershell
git restore --source 版本编号 -- public/index.html
```

恢复前先运行 `git diff`，重要修改建议先提交。不要随意使用 `git reset --hard`。

## 建立改造分支

较大的改造可先建立分支：

```powershell
git switch -c feat/改造名称
```

确认无误后再合并回 `main` 分支。

## 发布版本

版本号遵循 `主版本.次版本.修订版本`：不兼容变化提升主版本，新功能提升次版本，兼容修复提升修订版本。发布前同步更新 `package.json` 和 `CHANGELOG.md`，测试通过后再创建带注释标签：

```powershell
git tag -a v0.2.1 -m "release: v0.2.1"
git push origin main --follow-tags
```

标签必须对应实际发布版本，不为尚未部署的工作区提前打标签。
