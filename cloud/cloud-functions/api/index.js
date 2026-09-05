// 微信云开发云函数入口模板。
// 当前项目的本地 server.js 已经实现完整接口。
// 正式接入微信云开发时，可以把 /api/* 路由拆到这里，或将该云函数作为统一 API 网关。

exports.main = async (event, context) => {
  return {
    ok: true,
    message: "非标钣金工单系统云函数模板已就绪",
    event,
    openid: context.OPENID,
  };
};

