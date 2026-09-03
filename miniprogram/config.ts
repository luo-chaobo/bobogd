export const DEVELOPMENT_API_BASE_URL = "http://127.0.0.1:8089";
export const TRIAL_API_BASE_URL = "https://__REPLACE_WITH_TRIAL_API_HOST__";
export const PRODUCTION_API_BASE_URL = "";
export const SUBSCRIPTION_TEMPLATE_IDS: string[] = [];
export const WECHAT_WORK_KF_URL = "";
export const WECHAT_WORK_QR_IMAGE = "";
export const SERVICE_PHONE = "";

export function getApiBaseUrl() {
  const environment = wx.getAccountInfoSync().miniProgram.envVersion;
  if (environment === "develop") return DEVELOPMENT_API_BASE_URL;
  if (environment === "trial") return TRIAL_API_BASE_URL;
  if (!PRODUCTION_API_BASE_URL) throw new Error("请先配置生产 API 地址");
  return PRODUCTION_API_BASE_URL;
}
