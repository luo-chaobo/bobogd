const app = getApp<any>();
Page({ data: { items: [] }, async onShow() { try { this.setData({ items: await app.globalData.api.getOrders(app.globalData.sessionToken) }); } catch { this.setData({ items: [] }); } }, detail(event: any) { wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` }); } });
