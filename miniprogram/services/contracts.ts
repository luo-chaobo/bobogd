export interface SelectedAttachment {
  name: string;
  path: string;
  size: number;
}

export interface InquiryDraft {
  drawingMode: string;
  contactName?: string;
  phone?: string;
  region?: string;
  quantity?: number | string;
  expectedDate?: string;
  description?: string;
  material?: string;
  dimensions?: string;
  attachments?: SelectedAttachment[];
}

const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "dxf", "dwg", "step", "stp", "zip"]);
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 9;

export function buildLoginRequest(code: string, mockCode = "") {
  const verifiedCode = mockCode.trim() || code.trim();
  if (!verifiedCode) throw new Error("微信登录凭证缺失");
  return { code: verifiedCode, mock: Boolean(mockCode.trim()) };
}

export function normalizePhone(value: string | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("86") && digits.length === 13 ? digits.slice(2) : digits;
}

export function validateInquiryDraft(input: InquiryDraft) {
  const required: Array<[keyof InquiryDraft, string]> = [
    ["contactName", "请填写联系人"],
    ["phone", "请填写手机号"],
    ["region", "请填写所在区域"],
    ["quantity", "请填写数量"],
    ["expectedDate", "请选择期望交期"],
    ["description", "请描述加工需求"]
  ];
  for (const [field, message] of required) {
    if (String(input[field] || "").trim() === "") return { field, message };
  }
  if (!/^1\d{10}$/.test(normalizePhone(input.phone))) return { field: "phone", message: "请输入正确的11位手机号" };
  if (!Number.isInteger(Number(input.quantity)) || Number(input.quantity) < 1) return { field: "quantity", message: "数量必须为正整数" };
  return null;
}

export function buildInquiryPayload(input: InquiryDraft) {
  return {
    drawingMode: input.drawingMode,
    contactName: String(input.contactName || "").trim(),
    phone: normalizePhone(input.phone),
    region: String(input.region || "").trim(),
    quantity: Number(input.quantity),
    expectedDate: String(input.expectedDate || ""),
    description: String(input.description || "").trim(),
    material: String(input.material || "").trim(),
    dimensions: String(input.dimensions || "").trim(),
    attachments: input.attachments || []
  };
}

export function selectAttachments(files: SelectedAttachment[], existing: SelectedAttachment[] = []) {
  const accepted: SelectedAttachment[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  for (const file of files) {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_EXTENSIONS.has(extension)) rejected.push({ name: file.name, reason: "附件格式不支持" });
    else if (file.size > MAX_ATTACHMENT_SIZE) rejected.push({ name: file.name, reason: "单个附件不能超过20MB" });
    else if (existing.length + accepted.length >= MAX_ATTACHMENTS) rejected.push({ name: file.name, reason: "最多选择9个附件" });
    else accepted.push(file);
  }
  return { accepted, rejected };
}
