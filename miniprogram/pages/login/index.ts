import { bindCustomerPhone, returnAfterAuthorization } from "../../services/customer-auth";

const app = getApp<any>();
Page({
  data: { error: "", redirect: "/pages/profile/index", authorizing: false },
  onLoad(options: any) {
    const redirect = options.redirect ? decodeURIComponent(String(options.redirect)) : "/pages/profile/index";
    this.setData({ redirect: redirect.startsWith("/") ? redirect : "/pages/profile/index" });
  },
  async authorize(event: any) {
    const phoneCode = String(event.detail?.code || "");
    if (!phoneCode) return this.setData({ error: "您已取消手机号授权，仍可返回首页继续浏览" });
    this.setData({ error: "", authorizing: true });
    try {
      await bindCustomerPhone(app, phoneCode);
      returnAfterAuthorization(this.data.redirect);
    } catch (error: any) { this.setData({ error: error.message || "授权未完成，请稍后重试" }); }
    finally { this.setData({ authorizing: false }); }
  },
  browse() { wx.switchTab({ url: "/pages/home/index" }); }
});
