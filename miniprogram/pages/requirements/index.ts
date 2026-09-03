const app = getApp<any>();
Page({ data: { items: [] }, async onShow() { try { this.setData({ items: await app.globalData.api.getRequirements(app.globalData.sessionToken) }); } catch { this.setData({ items: [] }); } } });
