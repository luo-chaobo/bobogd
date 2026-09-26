import { buildInquiryPayload, formatFileSize, removeAttachmentAt, selectAttachments, validateInquiryDraft } from "../../services/contracts";
import { getApiBaseUrl } from "../../config";
import { uploadAttachments } from "../../services/upload";
import { bindCustomerPhone, isBoundCustomer } from "../../services/customer-auth";

const app = getApp<any>();
const blankForm = { drawingMode: "无图纸，按描述沟通", contactName: "", phone: "", region: "", address: "", quantity: 1, expectedDate: "", description: "", material: "", dimensions: "" };
Page({
  data: { drawingModes: ["有图纸/模型", "有现场照片", "无图纸，按描述沟通"], form: { ...blankForm }, attachments: [], sourceOrderId: 0, sourceOrderNumber: "", originalAttachments: [], reuseOriginalAttachments: true, loadingDraft: false, isBound: false, error: "", submitting: false },
  async onLoad(options: any) {
    const sourceOrderId = Number(options.sourceOrderId || 0);
    if (!sourceOrderId) {
      const draft = wx.getStorageSync("inquiryDraft");
      if (draft) this.setData({ ...draft, attachments: (draft.attachments || []).map((file: any) => ({ ...file, sizeText: formatFileSize(file.size) })) });
      return;
    }
    await this.loadRepurchaseDraft(sourceOrderId);
  },
  async loadRepurchaseDraft(sourceOrderId: number) {
    this.setData({ sourceOrderId, loadingDraft: true });
    try {
      const draft = await app.globalData.api.getRepurchaseDraft(sourceOrderId, app.globalData.sessionToken);
      this.setData({
        form: draft.form,
        sourceOrderNumber: draft.orderNumber,
        originalAttachments: draft.originalAttachments.map((file: any) => ({ ...file, sizeText: formatFileSize(file.size) })),
        attachments: [],
        reuseOriginalAttachments: true,
        error: ""
      });
    } catch (error: any) { this.setData({ error: error.message || "复购资料加载失败" }); }
    finally { this.setData({ loadingDraft: false }); }
  },
  onShow() {
    const user = app.globalData.user || {};
    const nextData: any = { isBound: isBoundCustomer(app) };
    if (user.phone) nextData["form.phone"] = user.phone;
    this.setData(nextData);
    const sourceOrderId = Number(wx.getStorageSync("repurchaseSourceOrderId") || 0);
    if (!sourceOrderId) return;
    wx.removeStorageSync("repurchaseSourceOrderId");
    this.loadRepurchaseDraft(sourceOrderId);
  },
  input(event: any) { const field = event.currentTarget.dataset.field; this.setData({ [`form.${field}`]: event.detail.value }); },
  drawingMode(event: any) { this.setData({ "form.drawingMode": this.data.drawingModes[event.detail.value] }); },
  expectedDate(event: any) { this.setData({ "form.expectedDate": event.detail.value }); },
  appendFiles(files: any[]) { const originalFiles = this.data.reuseOriginalAttachments ? this.data.originalAttachments.map((file: any) => ({ ...file, path: `original:${file.id}` })) : []; const selected = selectAttachments(files.map((file) => ({ name: file.name || file.tempFilePath.split("/").pop(), size: file.size, path: file.path || file.tempFilePath })), [...originalFiles, ...this.data.attachments]);
    const accepted = selected.accepted.map((file) => ({ ...file, sizeText: formatFileSize(file.size) }));
    this.setData({ attachments: [...this.data.attachments, ...accepted], error: selected.rejected[0]?.reason || "" }); },
  removeAttachment(event: any) { this.setData({ attachments: removeAttachmentAt(this.data.attachments, Number(event.currentTarget.dataset.index)), error: "" }); },
  reuseOriginalAttachments(event: any) { this.setData({ reuseOriginalAttachments: event.detail.value, error: "" }); },
  chooseImages() { wx.chooseMedia({ count: 5, mediaType: ["image"], success: (result) => this.appendFiles(result.tempFiles) }); },
  chooseFiles() { wx.showModal({
    title: "选择图纸文件",
    content: "PDF、DXF、DWG、STEP等图纸文件，请先发送至“文件传输助手”或任一微信聊天，再从聊天中选择。",
    confirmText: "前往选择",
    cancelText: "取消",
    success: (modal) => { if (!modal.confirm) return; wx.chooseMessageFile({ count: 5, type: "file", success: (result) => this.appendFiles(result.tempFiles) }); }
  }); },
  async authorizeAndSubmit(event: any) {
    const problem = validateInquiryDraft(this.data.form, { phoneRequired: false });
    if (problem) return this.setData({ error: problem.message });
    const code = event.detail?.code;
    if (!code) return this.setData({ error: "未授权手机号，您仍可继续浏览和修改需求。" });
    this.setData({ error: "", submitting: true });
    try {
      const user = await bindCustomerPhone(app, code);
      await new Promise<void>((resolve) => this.setData({ "form.phone": user.phone, isBound: true, submitting: false }, resolve));
      await this.submit();
    } catch (error: any) {
      this.setData({ error: error.message || "手机号授权未完成，请稍后重试", submitting: false });
    }
  },
  async submit() { const problem = validateInquiryDraft(this.data.form); if (problem) return this.setData({ error: problem.message });
    if (!isBoundCustomer(app)) return this.setData({ isBound: false, error: "请先授权手机号后提交需求。" });
    this.setData({ error: "", submitting: true });
    try { const attachments = await uploadAttachments(this.data.attachments, getApiBaseUrl(), app.globalData.sessionToken); const stored = wx.getStorageSync("inquiryDraft") || {}; const payload = { ...buildInquiryPayload(this.data.form), attachments, state: "submitted" }; const response = this.data.sourceOrderId
      ? await app.globalData.api.repurchaseOrder(this.data.sourceOrderId, { ...payload, reuseOriginalAttachments: this.data.reuseOriginalAttachments }, app.globalData.sessionToken)
      : stored.id ? await app.globalData.api.updateInquiry(stored.id, payload, app.globalData.sessionToken) : await app.globalData.api.createInquiry(payload, app.globalData.sessionToken); wx.removeStorageSync("inquiryDraft"); wx.showModal({ title: this.data.sourceOrderId ? "复购需求已提交" : "需求已提交", content: `需求编号：${response.inquiryNumber || "待分配"}`, showCancel: false, success: () => wx.navigateTo({ url: "/pages/requirements/index" }) });
    } catch (error: any) { this.setData({ error: error.message || "提交失败，请稍后重试" }); } finally { this.setData({ submitting: false }); } }
});
