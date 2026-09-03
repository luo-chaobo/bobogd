# 宁波未来机械官网与快速接单平台

本地验收版本包含：

- 服务转化型中文官网与移动端固定咨询入口。
- 有图纸/无图纸询价、私有附件上传、5分钟重复提交保护。
- 客服后台认领、10分钟响应状态、报价版本、人工确认付款及审计日志。
- 正式订单创建、公开进度更新、订单号加手机号查询。
- 波波工单接口边界文档；一期不自动同步。
- 14个独立企业官网页面、独立快速下单平台，以及可由微信开发者工具导入的原生 TypeScript 小程序。
- 25秒真实工厂素材宣传片，支持移动端分段加载和拖动播放。

## 本地启动

需要 Node.js 24 或更新版本，不需要安装第三方包。

```powershell
$env:ADMIN_TOKEN = "至少32位随机后台令牌"
$env:ENABLE_WECHAT_MOCK = "1"
$env:ENABLE_PHONE_MOCK = "1"
& "C:\Users\luoch\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\src\server.js
```

打开 `http://127.0.0.1:8080/`；交易平台为 `http://127.0.0.1:8080/platform.html`；客服后台为 `http://127.0.0.1:8080/admin.html`。两个 mock 开关只能用于本地验收，公网环境不得启用。

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
- HTTPS反向代理、强后台认证、企业微信通知与短信/邮件降级服务。
- 生产数据库备份、监控、文件病毒扫描及对象存储。

当前后台令牌模型只适合本机内部验收。正式公网部署前必须升级为独立操作员账号、密码哈希、会话过期和角色权限；同时接入真实微信登录、微信手机号授权、订阅消息发送器、病毒扫描和短信/邮件兜底。
