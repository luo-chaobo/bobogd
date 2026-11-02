# 版本管理与宝塔发布

## 范围与当前状态

- GitHub 私有仓库：`luo-chaobo/bobogd`，生产代码主分支为 `main`。
- 2026-10-31 已将 `feature/platform-delivery` 合入 GitHub `main`，远端合并提交为 `743d1be`。旧 `main` 提交仍保留在合并历史中。
- 当前本地工作树仍为 `feature/platform-delivery` @ `bdaf44a`；本地 `main` 指向旧的独立提交，不应直接切换或重置后继续开发。要从新主线开始，使用单独的新检出目录：

```powershell
git clone --branch main https://github.com/luo-chaobo/bobogd.git D:\WMR\lcb\bobogd-main
```

- GitHub 更新不等于宝塔已部署。本次没有登录服务器或发布代码；线上当前版本未核验。
- 仓库 `package.json` 版本为 `0.2.0`，历史服务器记录为 `0.4.0`。发布前先从服务器核对真实运行版本，再决定版本号，不能直接沿用任一数字。

## 常规开发与版本记录

1. 从 GitHub `main` 同步最新代码，在功能分支开发。
2. 完成代码审查、语法检查和适用测试，确认工作区没有无关修改、生产数据、密钥或附件。
3. 提交功能分支并推送 GitHub；通过 Pull Request 合入 `main`。合并记录保留历史，查看旧版本不需要回退。
4. 每次准备生产发布时，以已合入 `main` 的提交为准，建立格式为 `bobo-vX.Y.Z-production` 的 Git 标签。版本号需先与实际线上版本和 `package.json` 对齐。

## 构建发布包

仓库脚本 `scripts/build-release.ps1` 只从 Git 标签生成发布包、清单和 SHA-256。要求工作区干净、标签存在、`package.json` 有版本号；脚本会拒绝数据库、上传、依赖缓存、密钥和运行时文件。

```powershell
git status --short
node --check server.js
node --test tests/*.test.js
$tag = 'bobo-vX.Y.Z-production'
git tag -a $tag -m "Release $tag"
git push origin $tag
powershell -ExecutionPolicy Bypass -File .\scripts\build-release.ps1 -Tag $tag
```

将生成的 ZIP、`release-manifest.json` 和 `.sha256` 一并保管。不要把整个工作目录、`data/`、`db/`、`public/uploads/`、`.env`、`ecosystem.config.js` 或 `node_modules/` 上传为发布包。微信小程序不随服务器包发布，需另经微信开发者工具上传、审核和发布。

## 宝塔发布边界

BOBO 历史架构为 Nginx → Node/PM2 单实例（fork，3000 端口）。发布目录约定：

```text
/www/wwwroot/bobogd/
  incoming/          待校验的 ZIP、清单和校验文件
  releases/          每个版本独立代码目录
  current -> releases/...
  shared/data/       生产运行数据
  shared/uploads/    生产附件
  ecosystem.config.js 服务器私有 PM2 配置
```

这一路径和进程关系来自 2026-10-01 服务器截图记录，发布前必须现场复核。先只读检查 `pm2 describe bobogd`、`readlink -f current`、共享目录链接和本机健康接口；不得输出 PM2 完整环境或私密配置。

每次发布前，备份生产 MySQL、`shared/data`、`shared/uploads`、私有 PM2 配置，并记录当前 release。将包上传到 `incoming/`，核对 SHA-256 和清单，在新的 release 目录解压；保留服务器配置，把新版本的 `data` 和 `public/uploads` 链接到共享目录，使用仓库锁文件安装生产依赖。不要让第二个 BOBO 实例连接生产数据库。

切换 `current` 到新 release 后，按现场 PM2 配置重启单实例。确认 PM2 实际 script/cwd 已指向 `current`，检查本机与正式域名健康、关键页面和日志；通过后执行 `pm2 save`。若失败，将 `current` 切回已记录的旧 release 并重启。

代码回滚不恢复数据库。数据库迁移或数据修复须另做兼容性评估、备份和维护计划；不得用本地数据库覆盖生产 MySQL。接单网站由另一台服务的 `future-machinery.service` 管理，须使用网站自身发布流程，不能套用 BOBO 的 PM2 操作。

详细服务器命令、健康验收和回滚步骤见 Obsidian 主档 [[04-技术文档/BOBO-线上更新操作手册]]。生产部署仅在用户明确授权后执行，并记录发布标签、提交、备份、验证结果和回滚点。
