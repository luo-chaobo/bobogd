import { buildLoginRequest } from "../../services/contracts";

const app = getApp<any>();
Page({
  data: { error: "", phone: "" },
  async login() {
    try {
      const login = await wx.login();
      const mockCode = wx.getStorageSync("mockWechatCode") || "";
      const result = await app.globalData.api.login(buildLoginRequest(login.code, mockCode));
      app.globalData.sessionToken = result.sessionToken;
      app.globalData.user = result.customer;
      wx.setStorageSync("sessionToken", result.sessionToken);
      wx.setStorageSync("user", result.customer);
      wx.switchTab({ url: "/pages/home/index" });
    } catch (error: any) { this.setData({ error: error.message || "登录未完成，请稍后重试" }); }
  },
  phoneInput(event: any) { this.setData({ phone: event.detail.value }); },
  async bindPhone() {
    try {
      const environment = wx.getAccountInfoSync().miniProgram.envVersion;
      if (environment !== "develop") throw new Error("正式手机号授权尚待微信主体认证后接入");
      const result = await app.globalData.api.bindPhone(this.data.phone, `mock:${this.data.phone}`, app.globalData.sessionToken);
      app.globalData.user = result.customer;
      wx.setStorageSync("user", result.customer);
      wx.showToast({ title: "手机号已绑定", icon: "success" });
    } catch (error: any) { this.setData({ error: error.message || "绑定失败" }); }
  }
});
