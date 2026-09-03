const app = getApp<any>();
Page({ data: { order: { events: [] } }, async onLoad(query: any) { try { this.setData({ order: await app.globalData.api.getOrder(Number(query.id), app.globalData.sessionToken) }); } catch (error: any) { wx.showToast({ title: error.message || "订单查询失败", icon: "none" }); } } });
