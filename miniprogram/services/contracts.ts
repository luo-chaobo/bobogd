export interface SelectedAttachment {
  name: string;
  path: string;
  size: number;
  sizeText?: string;
}

export interface InquiryDraft {
  drawingMode: string;
  contactName?: string;
  phone?: string;
  region?: string;
  address?: string;
  quantity?: number | string;
  expectedDate?: string;
  description?: string;
  material?: string;
  dimensions?: string;
  process?: string;
  technicalRequirements?: string;
  attachments?: SelectedAttachment[];
}

const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "dxf", "dwg", "step", "stp", "zip"]);
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_SIZE = 40 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

export function formatFileSize(bytes: number) {
  const size = Math.max(0, Number(bytes) || 0);
  const unitSize = size < 1024 * 1024 ? 1024 : 1024 * 1024;
  const unit = unitSize === 1024 ? "KB" : "MB";
  return `${Number((size / unitSize).toFixed(2))} ${unit}`;
}

export function removeAttachmentAt<T>(files: T[], index: number) {
  return files.filter((_, currentIndex) => currentIndex !== index);
}

export function buildLoginRequest(code: string, mockCode = "") {
  const verifiedCode = mockCode.trim() || code.trim();
  if (!verifiedCode) throw new Error("微信登录凭证缺失");
  return { code: verifiedCode, mock: Boolean(mockCode.trim()) };
}

export function normalizePhone(value: string | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("86") && digits.length === 13 ? digits.slice(2) : digits;
}

export function validateInquiryDraft(input: InquiryDraft, options: { phoneRequired?: boolean } = {}) {
  const phoneRequired = options.phoneRequired !== false;
  const required: Array<[keyof InquiryDraft, string]> = [
    ["contactName", "请填写联系人"],
    ["region", "请填写所在区域"],
    ["quantity", "请填写数量"],
    ["expectedDate", "请选择期望交期"],
    ["description", "请描述加工需求"]
  ];
  if (phoneRequired) required.splice(1, 0, ["phone", "请填写手机号"]);
  for (const [field, message] of required) {
    if (String(input[field] || "").trim() === "") return { field, message };
  }
  if (phoneRequired && !/^1\d{10}$/.test(normalizePhone(input.phone))) return { field: "phone", message: "请输入正确的11位手机号" };
  if (!Number.isInteger(Number(input.quantity)) || Number(input.quantity) < 1) return { field: "quantity", message: "数量必须为正整数" };
  return null;
}

export function buildInquiryPayload(input: InquiryDraft) {
  return {
    drawingMode: input.drawingMode,
    contactName: String(input.contactName || "").trim(),
    phone: normalizePhone(input.phone),
    region: String(input.region || "").trim(),
    address: String(input.address || "").trim(),
    quantity: Number(input.quantity),
    expectedDate: String(input.expectedDate || ""),
    description: String(input.description || "").trim(),
    material: String(input.material || "").trim(),
    dimensions: String(input.dimensions || "").trim(),
    process: "",
    technicalRequirements: "",
    attachments: input.attachments || []
  };
}

export function selectAttachments(files: SelectedAttachment[], existing: SelectedAttachment[] = []) {
  const accepted: SelectedAttachment[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  let totalSize = existing.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_EXTENSIONS.has(extension)) rejected.push({ name: file.name, reason: "附件格式不支持" });
    else if (file.size > MAX_ATTACHMENT_SIZE) rejected.push({ name: file.name, reason: "单个附件不能超过20MB" });
    else if (existing.length + accepted.length >= MAX_ATTACHMENTS) rejected.push({ name: file.name, reason: "最多选择5个附件" });
    else if (totalSize + file.size > MAX_TOTAL_ATTACHMENT_SIZE) rejected.push({ name: file.name, reason: "附件总大小不能超过40MB" });
    else {
      accepted.push(file);
      totalSize += file.size;
    }
  }
  return { accepted, rejected };
}
