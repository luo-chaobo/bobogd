import { withStatusText } from "../../services/status";

const app = getApp<any>();
Page({
  data: {
    scope: "active", items: [], total: 0, page: 1, pageSize: 20, keyword: "", startDate: "", endDate: "", loading: false, error: ""
  },
  onShow() { this.load(true); },
  async load(reset = false) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true, error: "" });
    try {
      const result = await app.globalData.api.getOrders({
        scope: this.data.scope,
        keyword: this.data.keyword,
        startDate: this.data.startDate,
        endDate: this.data.endDate,
        page,
        pageSize: this.data.pageSize
      }, app.globalData.sessionToken);
      const items = result.items.map((item: any) => ({ ...withStatusText(item), completedDate: item.completedAt ? item.completedAt.slice(0, 10) : "" }));
      this.setData({ items: reset ? items : [...this.data.items, ...items], total: result.total, page: page + 1 });
    } catch (error: any) {
      this.setData({ items: reset ? [] : this.data.items, error: error.message || "订单加载失败" });
    } finally { this.setData({ loading: false }); }
  },
  switchScope(event: any) {
    const scope = event.currentTarget.dataset.scope;
    if (scope === this.data.scope) return;
    this.setData({ scope, items: [], total: 0, page: 1, keyword: "", startDate: "", endDate: "" }, () => this.load(true));
  },
  keyword(event: any) { this.setData({ keyword: event.detail.value }); },
  startDate(event: any) { this.setData({ startDate: event.detail.value }); },
  endDate(event: any) { this.setData({ endDate: event.detail.value }); },
  search() { this.load(true); },
  clearFilters() { this.setData({ keyword: "", startDate: "", endDate: "" }, () => this.load(true)); },
  loadMore() { if (this.data.items.length < this.data.total) this.load(false); },
  detail(event: any) { wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` }); },
  repurchase(event: any) {
    const orderId = Number(event.currentTarget.dataset.id);
    if (!orderId) return wx.showToast({ title: "订单信息无效，请刷新后重试", icon: "none" });
    wx.setStorageSync("repurchaseSourceOrderId", orderId);
    wx.switchTab({
      url: "/pages/order-form/index",
      fail: () => {
        wx.removeStorageSync("repurchaseSourceOrderId");
        wx.showToast({ title: "复购页面打开失败，请稍后重试", icon: "none" });
      }
    });
  }
});
