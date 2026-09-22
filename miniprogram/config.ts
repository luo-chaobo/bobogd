export const DEVELOPMENT_API_BASE_URL = "https://test.wljixie.com";;
export const TRIAL_API_BASE_URL = "https://test.wljixie.com";
export const PRODUCTION_API_BASE_URL = "https://test.wljixie.com";
export const SUBSCRIPTION_TEMPLATE_IDS: string[] = ["tppDS_ZBA9nKXerDEzEVdd7dRHRH85W7QX4eL_U3zTA"];
export const WECHAT_WORK_CORP_ID = "wwcf524bec522394af";
export const WECHAT_WORK_KF_URL = "https://work.weixin.qq.com/kfid/kfc91b64c9e96963032";
export const WECHAT_WORK_QR_IMAGE = "/assets/images/wecom-customer-service-qr.png";
export const SERVICE_PHONE = "";
export const WEBSITE_URL = "https://test.wljixie.com";

export function getApiBaseUrl() {
  const environment = wx.getAccountInfoSync().miniProgram.envVersion;
  if (environment === "develop") return DEVELOPMENT_API_BASE_URL;
  if (environment === "trial") return TRIAL_API_BASE_URL;
  if (!PRODUCTION_API_BASE_URL) throw new Error("请先配置生产 API 地址");
  return PRODUCTION_API_BASE_URL;
}
