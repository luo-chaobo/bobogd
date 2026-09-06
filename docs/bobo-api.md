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

请求包含 `externalOrderNumber`、`customer`、`phone`、`quantity`、`expectedDate`、`description` 和 `material`。`externalOrderNumber` 是幂等键；首次响应 `201`，重复请求响应 `200`，均返回稳定的 `orderId` 与 `workOrderId`。创建的工单为“待排产”，不自动指定工序和人员。

## 波波回传公开进度

波波配置：

```text
FUTURE_WEBHOOK_URL=https://order.wljixie.com/api/integrations/bobo/events
BOBO_INTEGRATION_SECRET=<共享密钥>
```

请求包含 `eventId`、`sequence`、`workOrderId`、`externalOrderNumber`、`type`、`occurredAt`、`status` 和可选的 `process`。公开事件包括 `process.updated`、`quality.ready`、`shipment.ready`、`shipment.shipped` 与 `delivery.completed`。未来机械按 `eventId` 去重、按 `sequence` 拒绝旧事件，只保存工序 ID、序号、名称、状态和起止时间。

## 联调原则

- 未来机械付款确认先落本地订单和同步任务；波波离线不阻塞付款确认。
- 双方失败任务按指数退避重试，应用重启后继续处理。
- 正式联调先使用 Hosts 或测试域名，不修改 `bobogd.wljixie.com`。
- 客户接口不得返回员工、工资、工时、设备、成本、内部备注、异常责任人或质检处置细节。
