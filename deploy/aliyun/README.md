# 阿里云ECS部署

## 推荐资源

- 中国内地ECS，绑定固定公网IP或EIP。
- 独立数据盘挂载到 `/srv/wljixie`，用于数据库、附件和备份。
- 安全组仅公开80和443；Node服务只监听 `127.0.0.1:8080`。
- Nginx负责HTTPS、主域名跳转、请求大小限制和安全响应头。
- 阿里云云解析DNS保留 `bobogd.wljixie.com` 当前记录；只切换 `@` 与 `www`。

## 环境文件

在 `/etc/wljixie/website.env` 设置：

```text
HOST=127.0.0.1
PORT=8080
ENABLE_LEGACY_ADMIN_TOKEN=0
ADMIN_TOKEN=
ADMIN_SESSION_SECRET=<至少32位高强度随机字符串>
WECOM_CORP_ID=<企业ID>
WECOM_AGENT_ID=1000002
WECOM_APP_SECRET=<未来机械客服工作台Secret，仅在服务器填写>
WECOM_REDIRECT_URI=https://test.wljixie.com/api/admin/auth/wecom/callback
WECOM_SUPER_ADMIN_USER_IDS=<罗朝波UserId>,<郑金波UserId>
DATABASE_PATH=/srv/wljixie/website/data/website.sqlite
UPLOAD_DIR=/srv/wljixie/website/private/uploads
BOBO_BASE_URL=https://bobogd.wljixie.com
BOBO_INTEGRATION_SECRET=<双方共享的高强度随机密钥>
WECHAT_APP_ID=<未来机械小程序AppID>
WECHAT_APP_SECRET=<未来机械小程序Secret>
WECHAT_SUBSCRIPTION_TEMPLATE_ID=tppDS_ZBA9nKXerDEzEVdd7dRHRH85W7QX4eL_U3zTA
WECHAT_MINIPROGRAM_STATE=trial
WECOM_WEBHOOK_URL=<企业微信机器人Webhook>
```

在企业微信应用中把授权回调域设置为 `test.wljixie.com`。`WECOM_SUPER_ADMIN_USER_IDS` 必须填写企业微信成员 UserId，不能填写姓名。测试站验收完成后再替换正式后台域名及回调地址。

## 测试域名迁移清单

`test.wljixie.com` 仅用于首期验收。切换正式后台域名时逐项处理，不能只修改 DNS：

1. DNS：新增正式域名解析，并保留测试域名直到回归完成。
2. Nginx 与证书：新增正式域名 `server_name`、证书和 HTTP 到 HTTPS 跳转；确认 `/admin.html`、`/api/admin/auth/*` 与 `/api/health` 正常代理。
3. 服务端环境：将 `WECOM_REDIRECT_URI` 改为 `https://<正式后台域名>/api/admin/auth/wecom/callback`，然后重启 `future-machinery.service`。`ADMIN_SESSION_SECRET`、企业微信 Secret 和超级管理员 UserId 不因换域名而重置。
4. 企业微信自建应用：把 OAuth 网页授权回调域改为正式后台域名；若企业微信要求归属认证，在正式域名根目录发布本次新生成的 `WW_verify_*.txt`，不能复用过期文件。
5. 企业微信企业可信 IP：服务器公网出口 IP 不变时继续使用 `47.99.105.37`；迁移服务器或出口 IP 后同步更新。
6. 小程序：若正式版 API 也随域名切换，更新 `miniprogram/config.ts` 的对应 API 地址，并在微信公众平台配置 request/upload/download 合法域名；开发与体验地址是否保留测试域名应分别决定。
7. 代码默认值：`src/server.js` 当前仍以测试站回调作为缺省值。正式部署必须显式设置 `WECOM_REDIRECT_URI`；发布前再决定是否把代码缺省值一并改为正式域名。
8. 测试与文档：测试用例可以继续使用测试域名作为固定夹具，不代表生产配置；同步 `.env.example`、本部署文档、Handoff 和产品主档。
9. 验收：用新二维码完成登录、角色、退出和 CSRF 回归；确认两位超级管理员及客服权限，并回归波波建单、同步、回调和公开进度。

测试域名当前还出现在 `.env.example`、`src/server.js`、`test/admin-auth.test.js`、`miniprogram/config.ts` 及本文件。线上另有 DNS、Nginx/证书、企业微信可信域名和验证文件配置，不能仅靠仓库搜索发现。

权限设置为仅服务管理员可读：

```bash
sudo chown root:wljixie /etc/wljixie/website.env
sudo chmod 640 /etc/wljixie/website.env
```

## 启动与反向代理

```bash
sudo cp deploy/aliyun/future-machinery.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now future-machinery
sudo cp deploy/aliyun/nginx-wljixie.conf /etc/nginx/conf.d/wljixie.conf
sudo nginx -t
sudo systemctl reload nginx
```

证书文件按Nginx配置放入 `/etc/nginx/ssl/wljixie.com/`。正式切换前先使用临时域名或本机Hosts验证。

## DNS切换

- `@`：A记录指向ECS公网IPv4。
- `www`：CNAME指向 `wljixie.com`，或A记录指向同一公网IPv4。
- 切换前48小时将TTL调整到600秒。
- 不修改 `bobogd` 记录，确保波波工单后台和看板持续可用。

## 备份

每天执行 `deploy/aliyun/backup.sh`，本机保留14天；生产环境还应把备份复制到私有OSS Bucket并启用生命周期策略。每月至少恢复验证一次。
