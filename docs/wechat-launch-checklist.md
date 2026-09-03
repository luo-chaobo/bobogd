# 微信小程序上线审核清单

## 必填配置

- [ ] 将 `miniprogram/project.config.json` 的 `touristappid` 换成真实小程序 AppID；当前值仅用于微信开发者工具游客导入。
- [ ] 在 `miniprogram/config.ts` 设置 HTTPS 生产 API 地址；`http://127.0.0.1:8089` 只允许开发者工具本地验收。
- [ ] 在小程序后台配置合法 request/uploadFile 域名，并完成 HTTPS、备案和业务域名核验。
- [ ] 配置 `SUBSCRIPTION_TEMPLATE_IDS`；模板内容需仅覆盖订单/需求的必要通知。
- [ ] 配置企业微信客服 URL、Corp ID、二维码及服务电话；三者至少一个可用，并现场验证降级顺序。
- [ ] 用法务确认版替换隐私政策和用户协议页面文案，完成小程序后台隐私保护指引。

## 后端联调契约

小程序与当前本地后端已按以下接口对齐；微信真实 code 换会话、手机号授权解密和订阅消息发送仍未完成真实环境联调。

| 接口 | 方法 | 作用 | 最小返回 |
| --- | --- | --- | --- |
| `/api/auth/wechat/login` | POST | 服务端以 `code` 换取小程序用户会话；当前仅接受开发 mock 格式 `mock:<openid>` | `sessionToken`, `customer` |
| `/api/customer/phone-binding` | POST | 已登录客户手动绑定经过校验的手机号 | `customer` |
| `/api/wechat/uploads` | POST multipart | 上传单个附件，鉴权、病毒扫描、私有存储 | `id`, `name`, `size` |
| `/api/customer/inquiries` | POST/GET | 保存草稿或提交需求、读取当前客户需求 | `id`, `inquiryNumber`, `state` / 数组 |
| `/api/customer/orders` | GET | 返回当前客户订单 | 数组 |
| `/api/customer/orders/:id` | GET | 返回当前客户订单的公开节点 | `orderNumber`, `status`, `events` |
| `/api/customer/subscriptions` | POST | 保存客户已授权的提醒开关，不直接发送消息 | `enabled` |

## 审核与验收

- [ ] 真机验证微信登录、手机号授权拒绝/同意、会话失效和重新登录；本项目未宣称已联调。
- [ ] 使用本地 mock code 验收仅限开发环境，不得在生产 API 启用。
- [ ] 验证有图、无图、DXF/STEP/ZIP、多附件、超 20 MiB、超 9 个附件等分支。
- [ ] 验证草稿保存、提交失败重试、需求列表、订单公开节点及未找到订单提示。
- [ ] 验证订阅消息授权被拒绝、模板未配置和实际发送回执；本项目未接入微信支付。
- [ ] 验证企业微信客服入口、二维码预览、电话降级，且不暴露敏感凭据。
