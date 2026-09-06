import { buildLoginRequest } from "../../services/contracts";

const app = getApp<any>();
Page({
  data: { error: "" },
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
  async bindPhone(event: any) {
    try {
      if (!app.globalData.sessionToken) throw new Error("请先完成微信登录");
      const phoneCode = String(event.detail?.code || "");
      if (!phoneCode) throw new Error("未取得手机号授权");
      const result = await app.globalData.api.bindPhoneCode(phoneCode, app.globalData.sessionToken);
      app.globalData.user = result.customer;
      wx.setStorageSync("user", result.customer);
      wx.showToast({ title: "手机号已绑定", icon: "success" });
    } catch (error: any) { this.setData({ error: error.message || "绑定失败" }); }
  }
});
