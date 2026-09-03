export interface ApiRequestOptions {
  url: string;
  method: "GET" | "POST";
  data?: unknown;
  token: string;
}

export type ApiRequest = (options: ApiRequestOptions) => Promise<any>;

export interface ApiClientOptions {
  baseUrl: string;
  request?: ApiRequest;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

function wxRequest(options: ApiRequestOptions): Promise<any> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: options.url,
      method: options.method,
      data: options.data,
      header: options.token ? { Authorization: `Bearer ${options.token}` } : {},
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else reject(response.data || { message: "服务请求失败" });
      },
      fail: reject
    });
  });
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const request = options.request || wxRequest;
  const call = (path: string, method: "GET" | "POST", data?: unknown, token = "") => request({ url: `${baseUrl}${path}`, method, data, token });

  return {
    login: (data: { code: string; mock: boolean }) => call("/api/auth/wechat/login", "POST", data),
    bindPhone: (phone: string, verificationProof: string, token: string) => call("/api/customer/phone-binding", "POST", { phone, verificationProof }, token),
    createInquiry: (data: unknown, token: string) => call("/api/customer/inquiries", "POST", data, token),
    getRequirement: (id: number, token: string) => call(`/api/customer/inquiries/${id}`, "GET", undefined, token),
    updateInquiry: (id: number, data: unknown, token: string) => call(`/api/customer/inquiries/${id}`, "POST", data, token),
    supplementInquiry: (id: number, data: unknown, token: string) => call(`/api/customer/inquiries/${id}/supplements`, "POST", data, token),
    getRequirements: (token: string) => call("/api/customer/inquiries", "GET", undefined, token),
    getOrders: (token: string) => call("/api/customer/orders", "GET", undefined, token),
    getOrder: (id: number, token: string) => call(`/api/customer/orders/${id}`, "GET", undefined, token),
    saveSubscriptions: (types: string[], token: string) => call("/api/customer/subscriptions", "POST", { types }, token)
  };
}
