# 波波工单一期接口

双方仅通过服务端 HTTPS 联动，不使用看板 `viewerToken`。环境变量 `BOBO_INTEGRATION_SECRET` 必须使用同一份高强度随机密钥，并仅存放在服务器环境文件中。

## 签名

每次请求携带：

```http
Content-Type: application/json
X-Integration-Timestamp: <13位Unix毫秒>
X-Integration-Nonce: <随机UUID>
X-Integration-Signature: <hex HMAC-SHA256>
```

签名原文为 `timestamp + "." + nonce + "." + 原始请求体`。接收端允许五分钟时钟偏差，持久化保存 nonce 防重放。

## 未来机械创建波波工单

```http
POST /api/external/work-orders
```

请求包含核心必填字段 `externalOrderNumber`、`customer`、`phone`、`quantity` 和 `expectedDate`，以及选填字段 `description`、`material`、`dimensions`。选填字段未填写时发送空字符串，接收端必须按空值接受，不得因此拒绝建单。`externalOrderNumber` 是幂等键；首次响应 `201`，重复请求响应 `200`，均返回稳定的 `orderId` 与 `workOrderId`。创建的工单为“待排产”，不自动指定工序和人员。

## 波波回传公开进度

波波配置：

```text
FUTURE_WEBHOOK_URL=https://test.wljixie.com/api/integrations/bobo/events
BOBO_INTEGRATION_SECRET=<共享密钥>
```

测试环境只填写测试域名；生产切换必须单独确认。波波报工落库时为平台订单排入 `process.updated`，后台以同一 `eventId` 重试，重启后继续发送。请求包含 `eventId`、`sequence`、`workOrderId`、`externalOrderNumber`、`type`、`occurredAt` 和 `process`；工序只含 ID、序号、名称、状态和起止时间，不含员工、工时、成本。未来机械按 `eventId` 去重、按每个订单的 `sequence` 拒绝旧事件。


网站的订单号加手机号查询接口返回 `processes`，查询页面显示公开工序。历史报工不会自动重报；停掉本地波波服务后，可在波波目录运行 `node server.js --backfill-platform-order WL-20260915-0005`，只为该订单已有报工排入进度事件，重复执行不会重复入队。重启波波后查看本地 `data/db.json` 中 `platformWebhookEvents` 的 `status`；`delivered` 表示测试站已接受，`pending` 的 `lastError` 用于排障。若使用 MySQL 模式，不能使用此 JSON 回填命令。

## 联调原则

- 未来机械付款确认先落本地订单和同步任务；波波离线不阻塞付款确认。
- 双方失败任务按指数退避重试，应用重启后继续处理。
- 正式联调先使用 Hosts 或测试域名，不修改 `bobogd.wljixie.com`。
- 客户接口不得返回员工、工资、工时、设备、成本、内部备注、异常责任人或质检处置细节。
