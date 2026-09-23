const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "dxf", "dwg", "step", "stp", "zip"]);
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 5;
const MAX_TOTAL_ATTACHMENT_SIZE = 40 * 1024 * 1024;
const PUBLIC_STATUS_DICTIONARY = Object.freeze({
  inquiry: ["draft", "submitted", "claimed", "ordered"],
  order: ["awaiting_payment", "awaiting_schedule", "paid", "production", "quality", "ready", "shipped", "completed"],
  paymentRule: { productionRequiresConfirmedPayment: true }
});

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

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("86") && digits.length === 13 ? digits.slice(2) : digits;
}

function validateInquiry(input) {
  const required = [
    ["drawingMode", "请选择资料情况"],
    ["contactName", "请填写联系人"],
    ["phone", "请填写手机号"],
    ["region", "请填写所在区域"],
    ["quantity", "请填写数量"],
    ["expectedDate", "请选择期望交期"],
    ["description", "请描述加工需求"]
  ];
  for (const [field, message] of required) {
    if (input[field] === undefined || input[field] === null || String(input[field]).trim() === "") {
      return { field, message };
    }
  }
  if (!/^1\d{10}$/.test(normalizePhone(input.phone))) {
    return { field: "phone", message: "请输入正确的11位手机号" };
  }
  if (!Number.isInteger(Number(input.quantity)) || Number(input.quantity) < 1) {
    return { field: "quantity", message: "数量必须为正整数" };
  }
  const attachments = input.attachments || [];
  if (attachments.length > MAX_ATTACHMENT_COUNT) return { field: "attachments", message: "附件最多5个" };
  let totalSize = 0;
  for (const attachment of attachments) {
    const extension = String(attachment.name || "").split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return { field: "attachments", message: "附件格式不支持" };
    }
    const size = actualAttachmentSize(attachment);
    if (size > MAX_ATTACHMENT_SIZE) {
      return { field: "attachments", message: "单个附件不能超过20MB" };
    }
    totalSize += size;
  }
  if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE) return { field: "attachments", message: "附件总大小不能超过40MB" };
  return null;
}

function actualAttachmentSize(attachment) {
  return typeof attachment.content === "string" ? Buffer.from(attachment.content, "base64").length : Number(attachment.size);
}

function canConfirmPayment(order) {
  return order.quoteStatus === "confirmed" && order.paymentStatus === "unpaid";
}

function canEnterProduction(order) {
  if (Number.isFinite(Number(order.verifiedAmount)) && Number.isFinite(Number(order.startAmount))) {
    return Number(order.verifiedAmount) >= Number(order.startAmount);
  }
  return order.paymentStatus === "paid" && ["paid", "awaiting_schedule", "production", "quality", "ready", "shipped", "completed"].includes(order.status);
}

function canShip(order) {
  return Number(order.verifiedAmount) >= Number(order.totalAmount);
}

function validatePublicEventTitle(value) {
  const title = String(value || "");
  if (title.length > 120) return "公开说明不能超过120个字符";
  if (/[\u0000-\u001F\u007F]/.test(title)) return "公开说明不能包含控制字符";
  return null;
}

function publicOrder(order) {
  return {
    orderNumber: order.orderNumber,
    contactName: order.contactName,
    status: order.status,
    statusText: ORDER_STATUS_TEXT[order.status] || "状态更新中",
    events: order.events || []
  };
}

module.exports = {
  ALLOWED_EXTENSIONS,
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_SIZE,
  ORDER_STATUS_TEXT,
  actualAttachmentSize,
  PUBLIC_STATUS_DICTIONARY,
  canConfirmPayment,
  canEnterProduction,
  canShip,
  normalizePhone,
  publicOrder,
  validatePublicEventTitle,
  validateInquiry
};
