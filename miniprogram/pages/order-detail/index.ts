import { buildOrderDetailViewModel } from "../../services/status";

const app = getApp<any>();
Page({ data: { order: { events: [], processes: [] } }, async onLoad(query: any) { try { const order = await app.globalData.api.getOrder(Number(query.id), app.globalData.sessionToken); this.setData({ order: buildOrderDetailViewModel(order) }); } catch (error: any) { wx.showToast({ title: error.message || "订单查询失败", icon: "none" }); } } });
