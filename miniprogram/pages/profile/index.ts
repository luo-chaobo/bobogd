import { SERVICE_PHONE, SUBSCRIPTION_TEMPLATE_IDS, WECHAT_WORK_CORP_ID, WECHAT_WORK_KF_URL, WECHAT_WORK_QR_IMAGE } from "../../config";
import { isBoundCustomer, openProtectedPage } from "../../services/customer-auth";
const app = getApp<any>();
Page({
  data: { user: {}, supportHint: "" },
  onShow() { this.setData({ user: app.globalData.user || {} }); },
  requirements() { openProtectedPage(app, "/pages/requirements/index"); },
  orders() { openProtectedPage(app, "/pages/orders/index"); },
  legal() { wx.navigateTo({ url: "/pages/legal/index" }); },
  website() { wx.navigateTo({ url: "/pages/website/index" }); },
  async subscribe() { if (!isBoundCustomer(app)) return openProtectedPage(app, "/pages/profile/index");
    if (!SUBSCRIPTION_TEMPLATE_IDS.length) return wx.showToast({ title: "订阅模板待配置", icon: "none" });
    try { const result = await wx.requestSubscribeMessage({ tmplIds: SUBSCRIPTION_TEMPLATE_IDS }); const accepted = SUBSCRIPTION_TEMPLATE_IDS.filter((id) => result[id] === "accept"); if (accepted.length) await app.globalData.api.saveSubscriptions(accepted, app.globalData.sessionToken); wx.showToast({ title: accepted.length ? `已增加${accepted.length}次订单提醒` : "未授权提醒", icon: "none" }); } catch { wx.showToast({ title: "订阅授权未完成", icon: "none" }); } },
  support() {
    const phone = () => SERVICE_PHONE ? wx.makePhoneCall({ phoneNumber: SERVICE_PHONE, fail: () => this.setData({ supportHint: `请拨打 ${SERVICE_PHONE}` }) }) : this.setData({ supportHint: "企业微信客服链接、二维码和服务电话均待上线配置。" });
    const qr = () => WECHAT_WORK_QR_IMAGE ? wx.previewImage({ urls: [WECHAT_WORK_QR_IMAGE], fail: phone }) : phone();
    if (!WECHAT_WORK_KF_URL) return qr();
    wx.openCustomerServiceChat({ extInfo: { url: WECHAT_WORK_KF_URL }, corpId: WECHAT_WORK_CORP_ID, fail: qr });
  }
});
