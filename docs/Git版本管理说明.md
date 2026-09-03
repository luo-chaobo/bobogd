# Git 版本管理说明

以下命令均在 `website` 目录中执行。

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
git commit -m "说明本次改造内容"
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
git switch -c feature/改造名称
```

确认无误后再合并回 `main` 分支。
