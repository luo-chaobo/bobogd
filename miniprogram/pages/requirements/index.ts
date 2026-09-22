import { withStatusText } from "../../services/status";

const app = getApp<any>();
Page({ data: { items: [] }, async onShow() { try { const items = await app.globalData.api.getRequirements(app.globalData.sessionToken); this.setData({ items: items.map(withStatusText) }); } catch { this.setData({ items: [] }); } } });
