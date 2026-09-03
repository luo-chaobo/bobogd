import { getApiBaseUrl } from "./config";
import { createApiClient } from "./services/api";

App({
  globalData: {
    api: createApiClient({ baseUrl: getApiBaseUrl() }),
    sessionToken: wx.getStorageSync("sessionToken") || "",
    user: wx.getStorageSync("user") || null
  }
});
