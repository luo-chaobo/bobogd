# 线上宝塔 BOBO 服务器文件架构

核验日期：2026-11-13（Asia/Shanghai）  
来源：已登录宝塔文件管理器与终端的只读检查。未读取密钥配置内容，未修改或删除服务器文件。

## 当前运行位置

- BOBO 根目录：`/www/wwwroot/bobogd`
- `current` 符号链接指向：`/www/wwwroot/bobogd/releases/bobo-rows-rc7`
- Node 服务进程的实际工作目录和脚本路径均落在 `bobo-rows-rc7`。这是本次线上文件/进程检查结果，不等于已核验每个文件与 Git 提交完全一致。
- 根文件系统约 49 GB，总用量约 32 GB，可用约 16 GB（检查时约 68% 已用）。

## 目录结构

```text
/www/wwwroot/bobogd/
├── current -> releases/bobo-rows-rc7/       # 当前版本入口
├── releases/
│   ├── bobo-rows-rc7/                        # 当前运行版本
│   ├── bobo-rows-rc7-weapp-qr-hotfix/        # 其他版本目录
│   ├── bobo-v0.4.0-production-integration/   # 旧版本目录
│   ├── bobo-v0.4.0-production-integration-5c437af/
│   └── incoming/                              # 上传/暂存区
├── shared/
│   ├── uploads/
│   │   ├── drawings/                          # 约 137 MB
│   │   ├── previews/                          # 约 40 MB
│   │   └── thumbnails/
│   └── data/weapp-code-cache/                 # 约 338 MB
├── data/weapp-code-cache/                     # 约 203 MB，另一处同名缓存
├── public/                                    # 约 172 MB；含 public/uploads 约 171 MB
├── node_modules/                              # 约 60 MB
├── backups/                                   # 约 99 MB；可见预部署备份目录
├── db/                                        # 约 12 KB
├── cloud/                                     # 约 28 KB
├── docs/ / lib/ / miniprogram/ / scripts/     # 文档、后端模块、小程序、脚本
└── server.js / tv.js / ecosystem.config.js 等应用入口与配置文件

/www/server/data/
├── bobogd/                                    # 约 46 MB，BOBO 数据库目录
├── mysql/                                     # 约 12 MB，MySQL 系统数据
└── mysql-bin.000082 ... mysql-bin.000098      # 17 个 binlog，总计约 16.57 GiB
```

目录大小为本次 `du`/文件管理器检查时的近似值，不是长期配额或租户用量报表。应用根目录中的 release 与共享数据路径有链接/布局关系，不能将目录统计直接相加为去重后的真实存储。

## 超过 1 GB 的文件

MySQL 数据目录中共有 17 个顺序编号的 `mysql-bin` 文件，合计约 16.57 GiB：

- `mysql-bin.000082` 至 `mysql-bin.000097`：16 个文件，每个约 1 GB 以上。
- `mysql-bin.000098`：约 534 MB，低于 1 GB。
- `mysql-bin.index`：编号索引文件，体积很小。

Binlog 是 MySQL 的二进制变更日志，可用于主从复制、时间点恢复和故障恢复。它们位于服务器 MySQL 数据目录，属于整台数据库实例的空间占用，不是 BOBO 每个租户各自复制一份的应用文件，也不是可直接按普通文件删除的缓存。

**不要在文件管理器或 shell 中直接删除 binlog。** 清理前需由数据库管理员确认复制从库是否仍消费这些日志、时间点恢复目标和备份是否覆盖，再制定保留周期。应使用 MySQL 支持的过期策略或 `PURGE BINARY LOGS`，并先验证备份恢复方案。本次没有读取当前 MySQL 复制拓扑或在线保留配置，因此无法判断哪些日志现在可以清理。2026-10-27 的历史截图显示过 `expire_logs_days=10`，不能当作本次当前配置证据。

## 对 SaaS 存储的影响与可优化方向

当前快照中，最大的系统级占用是 MySQL binlog（约 16.57 GiB）。业务库目录 `bobogd` 约 46 MB；应用侧目录约 1.2 GB，其中共享目录约 523 MB，根 `data` 约 203 MB，`public` 约 172 MB。它们没有按租户拆分统计，不能据此估算每租户的实际空间。

| 项目 | 观察 | SaaS 方向 |
| --- | --- | --- |
| MySQL binlog | 服务器级约 16.57 GiB | 依据恢复目标、备份和复制需求确定全实例保留策略；不要把它误算成每租户容量 |
| `weapp-code-cache` | `data` 与 `shared/data` 下各有一份同名目录，约 203 MB 和 338 MB | 先从配置和代码确认活动路径、缓存键和可再生成性；确认后再统一缓存位置/清理策略，不能仅凭名称删除 |
| 图纸与预览 | 共享上传目录的图纸约 137 MB、预览约 40 MB | SaaS 采用带租户命名空间和授权元数据的对象存储；预览可在确认生成链路后考虑按需重建，原图需生命周期与备份策略 |
| `public/uploads` | 约 171 MB | 核实是否与共享上传内容重复及公开访问边界；不能盲目迁移或删除 |
| 发布版本 | 可见 RC7 和旧版 release | 发布目录供回滚使用；设定保留最近可回滚版本的策略，并在确认无引用后清理旧包 |
| `backups` | 约 99 MB | 确认备份内容、校验和异地副本及恢复演练后再设保留策略；不要为了省空间先删除 |

面向 SaaS，建议共享一份应用代码和依赖，不为每个租户复制完整 release、`node_modules` 或小程序代码；租户业务数据用数据库隔离设计管理，附件进入统一对象存储并以租户 ID 隔离、设配额和生命周期规则。数据库采用每租户独立库还是共享库应依据隔离要求和运维成本另行决策。MySQL binlog、应用日志和平台备份按服务/实例统一预算，不重复摊入每个租户的静态文件容量。

## 尚未核验

- 当前 `weapp-code-cache` 实际读写路径、两处缓存是否重复以及能否安全重建。
- `public/uploads` 与 `shared/uploads` 是否含重复文件、访问控制与备份恢复情况。
- MySQL 当前 binlog 保留设置、复制拓扑、可恢复时间点和备份一致性。
- 服务器上各租户的数据库/附件归属与实际容量；本次只能确认单租户生产目录和总量，不能证明 SaaS 租户间隔离已上线。
- PM2 生态配置中的环境变量、机密内容和当前运行进程的 Git commit 指纹。本次没有读取这些敏感值。

本次仅做线上只读核验并编写文档；没有删除 binlog、清理缓存、调整配置、重启服务或修改生产数据。
