# 宁波未来机械官网与快速接单平台

本地验收版本包含：

- 服务转化型中文官网与移动端固定咨询入口。
- 有图纸/无图纸询价、私有附件上传、5分钟重复提交保护。
- 企业微信扫码运营后台、六类业务导航、九项待办指标、完整询价详情、报价版本和实名审计日志。
- 确认报价后生成未付款正式订单；收款登记、超级管理员核验、定金排产门槛、尾款发货门槛和 PNG 收据留痕。
- 履约中与已完成订单分区检索、公开进度更新、订单号加手机号查询。
- 波波工单接口边界文档；一期不自动同步。
- 14个独立企业官网页面、独立快速下单平台，以及可由微信开发者工具导入的原生 TypeScript 小程序。
- 25秒真实工厂素材宣传片，支持移动端分段加载和拖动播放。

## 产品与协作文档

- [仓库交接](Handoff.md)：本仓库范围、已验证版本、阻塞与下一步。
- [系统目录](docs/product/system-catalog.md)：各产品与基础设施的职责、依赖和状态。
- [架构索引](docs/architecture/README.md)：仓库内架构资料的入口。
- [数据分析访问契约](docs/data/analytics-access.md)：一期脱敏导出和二期数据访问边界。
- [API 文档](docs/bobo-api.md)：与波波工单的服务端 HTTPS 接口边界。
- [部署文档](docs/order-subdomain.md)：`order.wljixie.com` 的上线映射约束。
- [Obsidian 产品主档](D:\Obsidian\未来机械\未来机械)：跨系统产品、路线图和协作记录；Git 是本仓库技术事实主档。

## 本地启动

需要 Node.js 24 或更新版本，不需要安装第三方包。

```powershell
$env:ADMIN_TOKEN = "仅供本地紧急兼容的令牌"
$env:ENABLE_LEGACY_ADMIN_TOKEN = "1"
$env:ENABLE_WECHAT_MOCK = "1"
$env:ENABLE_PHONE_MOCK = "1"
& "C:\Users\luoch\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\src\server.js
```

打开 `http://127.0.0.1:8080/`；交易平台为 `http://127.0.0.1:8080/platform.html`；客服后台为 `http://127.0.0.1:8080/admin.html`。本地旧令牌只用于兼容 API 测试，正式公网必须设置 `ENABLE_LEGACY_ADMIN_TOKEN=0` 并配置企业微信参数。两个 mock 开关只能用于本地验收，公网环境不得启用。

正式上线时建议由 `order.wljixie.com` 独立展示交易平台，官网仍使用 `wljixie.com`。反向代理、证书和接口同源配置见 `docs/order-subdomain.md`，本地阶段不执行 DNS 或云端部署。

小程序使用微信开发者工具导入 `miniprogram/`。开发环境 API 默认为 `http://127.0.0.1:8089`；体验版和正式版地址必须在 `miniprogram/config.ts` 中替换为已备案的 HTTPS 域名。

数据默认保存到 `data/website.sqlite`，上传文件保存到 `private/uploads/`。这两个目录不能由 Web 服务器直接公开。

## 测试

```powershell
& "C:\Users\luoch\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --experimental-strip-types --test .\test\*.test.js
```

## 上线前必须补齐

- 企业微信二维码、正式联系电话、详细地址、营业时间和备案号。
- 经授权的工厂、设备、质检和产品案例照片。
- 正式报价条款、隐私政策、服务规则和付款说明。
- 企业微信应用 Secret、两位超级管理员 UserId、企业微信通知与短信/邮件降级服务。
- 生产数据库备份、监控、文件病毒扫描及对象存储。

客服后台已切换为企业微信扫码登录、服务端会话和角色权限；旧后台令牌默认关闭。正式公网仍需接入真实小程序微信登录、微信手机号授权、订阅消息发送器、病毒扫描和短信/邮件兜底。
