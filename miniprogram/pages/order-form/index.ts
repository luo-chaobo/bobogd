import { buildInquiryPayload, selectAttachments, validateInquiryDraft } from "../../services/contracts";
import { getApiBaseUrl } from "../../config";
import { uploadAttachments } from "../../services/upload";

const app = getApp<any>();
const blankForm = { drawingMode: "无图纸，按描述沟通", contactName: "", phone: "", region: "", quantity: 1, expectedDate: "", description: "", material: "", dimensions: "" };
Page({
  data: { drawingModes: ["有图纸/模型", "有现场照片", "无图纸，按描述沟通"], form: blankForm, attachments: [], error: "", submitting: false },
  onLoad() { const draft = wx.getStorageSync("inquiryDraft"); if (draft) this.setData(draft); },
  input(event: any) { const field = event.currentTarget.dataset.field; this.setData({ [`form.${field}`]: event.detail.value }); },
  drawingMode(event: any) { this.setData({ "form.drawingMode": this.data.drawingModes[event.detail.value] }); },
  expectedDate(event: any) { this.setData({ "form.expectedDate": event.detail.value }); },
  appendFiles(files: any[]) { const selected = selectAttachments(files.map((file) => ({ name: file.name || file.tempFilePath.split("/").pop(), size: file.size, path: file.path || file.tempFilePath })), this.data.attachments);
    this.setData({ attachments: [...this.data.attachments, ...selected.accepted], error: selected.rejected[0]?.reason || "" }); },
  chooseImages() { wx.chooseMedia({ count: 9, mediaType: ["image"], success: (result) => this.appendFiles(result.tempFiles) }); },
  chooseFiles() { wx.chooseMessageFile({ count: 9, type: "file", success: (result) => this.appendFiles(result.tempFiles) }); },
  async saveDraft() { try { const stored = wx.getStorageSync("inquiryDraft") || {}; const payload = { ...buildInquiryPayload(this.data.form), state: "draft" }; const response = stored.id ? await app.globalData.api.updateInquiry(stored.id, payload, app.globalData.sessionToken) : await app.globalData.api.createInquiry(payload, app.globalData.sessionToken); wx.setStorageSync("inquiryDraft", { id: response.id || stored.id, form: this.data.form, attachments: this.data.attachments }); wx.showToast({ title: "草稿已保存", icon: "success" }); } catch (error: any) { this.setData({ error: error.message || "草稿保存失败" }); } },
  async submit() { const problem = validateInquiryDraft(this.data.form); if (problem) return this.setData({ error: problem.message });
    this.setData({ error: "", submitting: true });
    try { const attachments = await uploadAttachments(this.data.attachments, getApiBaseUrl(), app.globalData.sessionToken); const stored = wx.getStorageSync("inquiryDraft") || {}; const payload = { ...buildInquiryPayload(this.data.form), attachments, state: "submitted" }; const response = stored.id ? await app.globalData.api.updateInquiry(stored.id, payload, app.globalData.sessionToken) : await app.globalData.api.createInquiry(payload, app.globalData.sessionToken); wx.removeStorageSync("inquiryDraft"); wx.showModal({ title: "需求已提交", content: `需求编号：${response.inquiryNumber || "待分配"}`, showCancel: false, success: () => wx.navigateTo({ url: "/pages/requirements/index" }) });
    } catch (error: any) { this.setData({ error: error.message || "提交失败，请稍后重试" }); } finally { this.setData({ submitting: false }); } }
});
