const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  submitted: "待受理",
  new: "待受理",
  claimed: "已受理",
  ordered: "已转订单",
  paid: "已付款",
  awaiting_payment: "待付款",
  awaiting_schedule: "待排产",
  production: "生产中",
  in_progress: "生产中",
  quality: "质检中",
  ready: "待交付",
  shipped: "已发货",
  completed: "已完成",
  pending: "待开始"
};

const PROCESS_STATUS_KEYS: Record<string, string> = {
  "待开始": "pending",
  "进行中": "in_progress",
  "已完成": "completed"
};

export function statusText(value: unknown) {
  const status = String(value || "").trim();
  if (PROCESS_STATUS_KEYS[status]) return status;
  return STATUS_LABELS[status.toLowerCase()] || "状态更新中";
}

export function withStatusText<T extends { status?: unknown; state?: unknown }>(item: T) {
  const value = item.state === "draft" ? item.state : item.status || item.state;
  return { ...item, statusText: statusText(value) };
}

export function formatPublicDateTime(value: unknown) {
  if (!value) return "等待更新";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "等待更新";
  const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${chinaTime.getUTCFullYear()}-${pad(chinaTime.getUTCMonth() + 1)}-${pad(chinaTime.getUTCDate())} ${pad(chinaTime.getUTCHours())}:${pad(chinaTime.getUTCMinutes())}`;
}

export function buildOrderDetailViewModel(order: any) {
  const processes = (order.processes || []).map((process: any, index: number) => {
    const status = String(process.status || "").trim();
    const completed = status === "completed" || status === "已完成";
    const time = completed ? process.completedAt : process.startedAt;
    return {
      ...withStatusText(process),
      sequenceText: String(process.sequence || index + 1).padStart(2, "0"),
      statusKey: PROCESS_STATUS_KEYS[status] || status.toLowerCase() || "pending",
      displayTime: `${completed ? "完成于" : "开始于"} ${formatPublicDateTime(time)}`
    };
  });
  const events = (order.events || []).map((event: any) => ({ ...withStatusText(event), displayTime: formatPublicDateTime(event.occurredAt) }));
  return { ...withStatusText(order), processes, events };
}
