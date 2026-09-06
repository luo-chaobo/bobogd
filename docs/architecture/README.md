# 架构文档索引

当前仓库以渐进方式整理架构资料，避免移动既有文档导致链接失效。

- [系统目录](../product/system-catalog.md)：系统职责、依赖与状态。
- [波波工单接口](../bobo-api.md)：签名、幂等、事件和公开数据边界。
- [接单平台子域名部署](../order-subdomain.md)：域名、Nginx、HTTPS 与回退约束。
- [微信上线审核](../wechat-launch-checklist.md)：微信配置、接口契约与验收清单。
- [架构与协作设计](../superpowers/specs/2026-09-06-product-knowledge-collaboration-design.md)：跨系统知识主档与图表管理规则。

## 可编辑架构图

`.drawio` 是唯一可编辑源文件，SVG 是由该源导出的确定性中间预览，PNG 由 SVG 使用本仓库脚本生成。图中“待线上验证”只表示尚未进行线上核验，不应视为生产部署完成。

| Diagram | Purpose | Required nodes |
| --- | --- | --- |
| `system-landscape` | Product and actor overview | customers, staff, website, mini-program, order platform, WeCom, Bobo, ECS, OSS |
| `deployment-and-data-flow` | Runtime and protected data flow | browsers, WeChat, Nginx, Node app, SQLite, private OSS, Bobo HTTPS integration, backup boundary |
| `product-update-loop` | Knowledge and version update process | explicit Skill, Obsidian, Handoff, Git verification, tests, review, commit |

| 图表 | 可编辑源 | 预览图 | 说明 |
| --- | --- | --- | --- |
| 系统全景 | [system-landscape.drawio](sources/system-landscape.drawio) | [system-landscape.png](images/system-landscape.png) | 产品、人员、入口与依赖边界。 |
| 部署与数据流 | [deployment-and-data-flow.drawio](sources/deployment-and-data-flow.drawio) | [deployment-and-data-flow.png](images/deployment-and-data-flow.png) | 已核验的本地实现边界与待线上验证的运行事实。 |
| 产品更新闭环 | [product-update-loop.drawio](sources/product-update-loop.drawio) | [product-update-loop.png](images/product-update-loop.png) | 知识、版本、验证、审阅与确认提交流程。 |

## 生成与一致性维护

要求：Windows PowerShell 5.1+ 和 Google Chrome（默认 `C:\Program Files\Google\Chrome\Application\chrome.exe`）。无需安装 Draw.io CLI。

在网站仓库根目录执行完整的 Draw.io → SVG → PNG 生成：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\render-architecture-diagrams.ps1
```

自定义路径（参数可包含空格）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\render-architecture-diagrams.ps1 -ChromePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ImageDirectory 'D:\Project With Spaces\docs\architecture\images'
```

脚本从 `ImageDirectory` 同级的 `sources` 目录读取全部 `.drawio`，按照节点坐标、颜色、文本、连接端口、路径控制点和标签偏移确定性生成 SVG，再由 Chrome 生成同名 PNG。SVG 固定 1600×900 画布，包含 title、desc、节点/边的无障碍标签；各颜色使用独立箭头 marker。每次均重新读取主源，不使用旧 SVG 回退。

本仓库采用明确的 Draw.io XML 子集：单页、未压缩、扁平节点（parent=1）、圆角矩形/纯文本、以 `<br>` 显式换行；有向边通过 `exitX/exitY/entryX/entryY` 固定端口，`Array as="points"` 指定折线，标签位于路径中点加 `mxPoint as="offset"`。不支持任意 mxGraph 图形、自动排版、嵌套容器或复杂 HTML；需要新增此类图形时，应先扩展并验证导出器。

每次变更只编辑 `.drawio`，随后运行脚本并逐张复核 PNG。不要手工维护 SVG 的第二份布局。图源现有 XML 的版本标记为 `24.7.17`，导出器不依赖 Desktop 版本。节点、边、文字、图例和日期均来自主源；重复运行生成的 SVG 应保持相同 SHA256。

PNG 与 SVG 先写入图片目录内的唯一临时子目录。确认 Chrome 成功退出、PNG 非空且尺寸为 1600×900 后，分别使用同卷文件原子替换更新正式文件；Chrome 缺失、渲染失败或图像无效时返回非零并保留该图的旧预览。每张图独立替换，不保证三张图作为整体事务提交。临时目录在验证路径范围后清理。

跨系统架构图和产品路线图在 Obsidian 产品主档维护；本仓库保留与实现相关的可编辑源、SVG 中间文件及 PNG 预览。
