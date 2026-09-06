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
ADMIN_TOKEN=<至少32位随机字符串>
DATABASE_PATH=/srv/wljixie/website/data/website.sqlite
UPLOAD_DIR=/srv/wljixie/website/private/uploads
BOBO_BASE_URL=https://bobogd.wljixie.com
BOBO_INTEGRATION_SECRET=<双方共享的高强度随机密钥>
WECHAT_APP_ID=<未来机械小程序AppID>
WECHAT_APP_SECRET=<未来机械小程序Secret>
WECOM_WEBHOOK_URL=<企业微信机器人Webhook>
```

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
