import { buildOrderDetailViewModel } from "../../services/status";

const app = getApp<any>();
Page({
  data: { order: { events: [], processes: [] } },
  orderId: 0,
  refreshTimer: null as ReturnType<typeof setInterval> | null,
  loading: false,
  onLoad(query: any) { this.orderId = Number(query.id); },
  onShow() {
    this.loadOrder();
    this.stopRefresh();
    this.refreshTimer = setInterval(() => this.loadOrder(true), 15000);
  },
  onHide() { this.stopRefresh(); },
  onUnload() { this.stopRefresh(); },
  async onPullDownRefresh() {
    await this.loadOrder(true);
    wx.stopPullDownRefresh();
  },
  stopRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  },
  async loadOrder(silent = false) {
    if (this.loading || !this.orderId) return;
    this.loading = true;
    try {
      const order = await app.globalData.api.getOrder(this.orderId, app.globalData.sessionToken);
      this.setData({ order: buildOrderDetailViewModel(order) });
    } catch (error: any) {
      if (!silent) wx.showToast({ title: error.message || "订单查询失败", icon: "none" });
    } finally {
      this.loading = false;
    }
  }
});
