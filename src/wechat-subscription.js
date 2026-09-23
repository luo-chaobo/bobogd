const ORDER_STATUS_TEXT = Object.freeze({
  awaiting_payment: "待付款",
  awaiting_schedule: "待排产",
  paid: "已付款",
  production: "生产中",
  quality: "质检中",
  ready: "待配送",
  shipped: "配送中",
  completed: "已送达"
});

function chinaDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

function templateFields(content) {
  const fields = new Map();
  const pattern = /([^\n{]+?)\{\{([a-z_]+\d+)\.DATA\}\}/g;
  for (const match of String(content || "").matchAll(pattern)) fields.set(match[1].trim(), match[2]);
  return fields;
}

function subscriptionData(content, payload, timestamp) {
  const fields = templateFields(content);
  const values = {
    订单号: String(payload.orderNumber || "").slice(0, 32),
    订单状态: ORDER_STATUS_TEXT[payload.status] || String(payload.statusText || payload.status || "状态更新").slice(0, 5),
    更新时间: chinaDateTime(payload.occurredAt || timestamp),
    备注: String(payload.title || "订单进度已更新").slice(0, 20)
  };
  return Object.fromEntries(Object.entries(values).filter(([label]) => fields.has(label)).map(([label, value]) => [fields.get(label), { value }]));
}

function createWechatSubscriptionSender(options) {
  let templateContent = "";
  return async (job) => {
    if (!options.templateId) throw new Error("微信订阅消息模板ID未配置");
    if (!job.openid) throw new Error("客户微信身份不存在");
    const accessToken = await options.getAccessToken();
    if (!templateContent) {
      const response = await options.fetch(`https://api.weixin.qq.com/wxaapi/newtmpl/gettemplate?access_token=${encodeURIComponent(accessToken)}`);
      const result = await response.json();
      const template = result.data?.find((item) => item.priTmplId === options.templateId);
      if (!response.ok || result.errcode || !template?.content) throw new Error(result.errmsg || "订阅消息模板详情获取失败");
      templateContent = template.content;
    }
    const body = {
      touser: job.openid,
      template_id: options.templateId,
      page: `/pages/order-detail/index?id=${job.entityId}`,
      miniprogram_state: options.state,
      lang: "zh_CN",
      data: subscriptionData(templateContent, job.payload, options.now().toISOString())
    };
    const response = await options.fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok || result.errcode) throw new Error(result.errmsg || "微信订阅消息发送失败");
  };
}

module.exports = { chinaDateTime, createWechatSubscriptionSender, subscriptionData, templateFields };
