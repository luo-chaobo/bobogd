import { openProtectedPage } from "../../services/customer-auth";

const app = getApp<any>();

Page({
  order() { wx.switchTab({ url: "/pages/order-form/index" }); },
  orders() { openProtectedPage(app, "/pages/orders/index"); },
  onShareAppMessage() {
    return {
      title: "未来机械钣金服务｜有图无图都可沟通",
      path: "/pages/home/index",
      imageUrl: "/assets/brand/share-card.jpg"
    };
  },
  onShareTimeline() {
    return {
      title: "未来机械钣金服务｜非标钣金需求提交与进度查询",
      imageUrl: "/assets/brand/share-card.jpg"
    };
  }
});
