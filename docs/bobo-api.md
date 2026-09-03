# 波波工单一期接口边界

已确认现有系统：

- 后台基础地址：`https://bobogd.wljixie.com/`
- 移动看板路径：`https://bobogd.wljixie.com/tv.html?mobile=1`

看板访问令牌属于敏感凭据，不写入官网代码、数据库或文档。正式联调使用独立服务端令牌，不复用浏览器 `viewerToken`。

## 建议的波波工单接口

波波工单服务端确认接口后，再启用以下适配器；一期官网不调用这些地址。

### 鉴权

```http
Authorization: Bearer <BOBO_SERVICE_TOKEN>
Content-Type: application/json
```

### 创建工单

```http
POST /api/external/work-orders
```

```json
{
  "source": "wljixie-website",
  "externalOrderNumber": "WL-20260829-0001",
  "customer": "王先生",
  "phone": "13812345678",
  "quantity": 2,
  "expectedDate": "2026-09-10",
  "description": "制作设备不锈钢防护罩",
  "material": "304不锈钢"
}
```

波波工单返回稳定的 `workOrderId`。官网保存该ID用于幂等重试，不把内部工序与成本公开给客户。

### 同步公开节点

```http
POST /api/integrations/bobo/events
```

```json
{
  "workOrderId": "bobo-id",
  "externalOrderNumber": "WL-20260829-0001",
  "status": "production",
  "title": "已进入生产",
  "occurredAt": "2026-08-29T10:00:00.000Z",
  "signature": "hmac-sha256"
}
```

只接受白名单状态：`production`、`quality`、`ready`、`completed`。请求使用时间戳、随机数和HMAC签名防止伪造与重放。

## 启用条件

- 波波工单提供稳定的服务端API、鉴权方式和测试环境。
- 双方确认字段、状态映射、幂等键、超时与重试策略。
- 联调验证失败时不阻断官网询价、付款确认或人工更新进度。
