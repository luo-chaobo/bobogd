import { buildLoginRequest } from "./contracts";

export function isBoundCustomer(app: any) {
  return Boolean(app.globalData.sessionToken && app.globalData.user?.phone);
}

export async function ensureCustomerSession(app: any) {
  if (app.globalData.sessionToken) return app.globalData.user;
  const login = await wx.login();
  const mockCode = wx.getStorageSync("mockWechatCode") || "";
  const result = await app.globalData.api.login(buildLoginRequest(login.code, mockCode));
  app.globalData.sessionToken = result.sessionToken;
  app.globalData.user = result.customer;
  wx.setStorageSync("sessionToken", result.sessionToken);
  wx.setStorageSync("user", result.customer);
  return result.customer;
}

export async function bindCustomerPhone(app: any, phoneCode: string) {
  if (!phoneCode) throw new Error("未取得手机号授权");
  await ensureCustomerSession(app);
  const result = await app.globalData.api.bindPhoneCode(phoneCode, app.globalData.sessionToken);
  app.globalData.user = result.customer;
  wx.setStorageSync("user", result.customer);
  return result.customer;
}

export function openProtectedPage(app: any, url: string) {
  if (isBoundCustomer(app)) return wx.navigateTo({ url });
  return wx.navigateTo({ url: `/pages/login/index?redirect=${encodeURIComponent(url)}` });
}

export function returnAfterAuthorization(url: string) {
  const target = url.startsWith("/") ? url : "/pages/profile/index";
  const tabPages = ["/pages/home/index", "/pages/order-form/index", "/pages/profile/index"];
  if (tabPages.includes(target)) return wx.switchTab({ url: target });
  return wx.redirectTo({ url: target });
}
