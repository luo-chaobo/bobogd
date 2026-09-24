import { buildOrderDetailViewModel } from "../../services/status";

const app = getApp<any>();
Page({
  data: { order: { events: [], processes: [] }, lastUpdated: "", refreshing: false },
  orderId: 0,
  refreshTimer: null as ReturnType<typeof setTimeout> | null,
  loading: false,
  visible: false,
  onLoad(query: any) { this.orderId = Number(query.id); },
  onShow() {
    this.visible = true;
    this.stopRefresh();
    this.loadOrder().finally(() => this.scheduleRefresh());
  },
  onHide() { this.visible = false; this.stopRefresh(); },
  onUnload() { this.visible = false; this.stopRefresh(); },
  async onPullDownRefresh() {
    await this.refreshNow();
    wx.stopPullDownRefresh();
  },
  async refreshNow() {
    this.stopRefresh();
    this.setData({ refreshing: true });
    await this.loadOrder(true);
    this.setData({ refreshing: false });
    this.scheduleRefresh();
  },
  scheduleRefresh() {
    this.stopRefresh();
    if (!this.visible) return;
    this.refreshTimer = setTimeout(async () => {
      await this.loadOrder(true);
      this.scheduleRefresh();
    }, 10000);
  },
  stopRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  },
  async loadOrder(silent = false) {
    if (this.loading || !this.orderId) return;
    this.loading = true;
    try {
      const order = await app.globalData.api.getOrder(this.orderId, app.globalData.sessionToken, Date.now());
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const lastUpdated = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      this.setData({ order: buildOrderDetailViewModel(order), lastUpdated });
    } catch (error: any) {
      if (!silent) wx.showToast({ title: error.message || "订单查询失败", icon: "none" });
    } finally {
      this.loading = false;
    }
  }
});
