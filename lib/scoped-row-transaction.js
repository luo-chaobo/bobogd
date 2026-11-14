'use strict';
const { readRowState, withConsistentRowRead } = require('./row-state-reader');
const { applyRowChanges } = require('./row-state-writer');
const { lockOrder } = require('./business-store');
const { normalizeOrderNumber } = require('./order-financials');

const scopedWrites = {
  '/api/report': ['orders', 'workOrders', 'routes', 'reports', 'exceptions', 'platformWebhookEvents'],
  '/api/dispatch-board/report': ['orders', 'workOrders', 'routes', 'reports', 'exceptions', 'platformWebhookEvents'],
  '/api/external/work-orders': ['orders', 'workOrders', 'customers', 'integrationNonces'],
  '/api/platform-orders/confirm': ['orders', 'workOrders', 'routes', 'platformWebhookEvents'],
  '/api/platform-orders/sync-processes': ['orders', 'platformWebhookEvents'],
  '/api/orders/fulfillment': ['orders', 'platformWebhookEvents'],
  '/api/delivery-trips/start': ['orders', 'deliveries', 'deliveryTrips', 'platformWebhookEvents'],
  '/api/deliveries/release': ['orders', 'deliveries', 'deliveryTrips'],
  '/api/deliveries/complete': ['orders', 'deliveries', 'deliveryTrips', 'attachments', 'platformWebhookEvents'],
  '/api/upload': ['attachments'],
  '/api/dispatch-board/report-upload': ['attachments'],
  '/api/drawings/upload': ['drawings', 'attachments'],
  '/api/drawings/preview': ['drawings', 'attachments']
};

const scopedReads = new Set(['/api/external/health', '/api/me', '/api/audit-logs', '/api/tv-viewer-token', '/api/dispatch-board-token', '/api/report-context', '/api/dispatch-board/report-context', '/api/dashboard', '/api/tv-dashboard', '/api/mobile/completions', '/api/history/work-orders', '/api/history/exceptions', '/api/reports/management-export', '/api/deliveries/my', '/api/deliveries/available']);

function filter(where, ...params) {
  return { where, params };
}

const dashboardSections = {
  orders: {}, workOrders: {}, routes: {}, reports: {}, customers: {}, drawings: {}, processes: {},
  exceptions: filter("NOT (BINARY JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')) <=> BINARY '已解决')")
};

function ids(column, values) {
  return filter(`${column} IN (SELECT id FROM JSON_TABLE(?, '$[*]' COLUMNS (id VARCHAR(191) PATH '$')) AS selected)`, JSON.stringify([...new Set(values)]));
}

async function selectCompletions(connection, sections, { range, dateKey, includeItems }) {
  if (!range) return;
  const [rows] = await connection.query(`SELECT id, order_id AS orderId,
    CAST(JSON_ARRAY(JSON_EXTRACT(payload, '$.completedAt')) AS CHAR CHARACTER SET utf8mb4) AS dates
    FROM bobo_work_orders_v2 WHERE BINARY JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')) = BINARY '已完成'
    ORDER BY source_position`);
  const completed = rows.map(({ id, orderId, dates }) => ({ id, orderId, completedAt: JSON.parse(dates)[0] }));
  const missingDate = (item) => !item.completedAt || !dateKey(item.completedAt);
  const fallback = completed.filter(missingDate).map((item) => item.id);
  if (fallback.length) {
    const routeSelection = ids('work_order_id', fallback);
    const [routes] = await connection.execute(`SELECT work_order_id AS workOrderId,
      CAST(JSON_ARRAY(JSON_EXTRACT(payload, '$.completedAt'), JSON_EXTRACT(payload, '$.lastReportedAt')) AS CHAR CHARACTER SET utf8mb4) AS dates
      FROM bobo_routes_v2 WHERE ${routeSelection.where}
      AND BINARY JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')) = BINARY '已完成'`, routeSelection.params);
    const latest = new Map();
    for (const route of routes) {
      const [completedAt, lastReportedAt] = JSON.parse(route.dates);
      const value = completedAt || lastReportedAt;
      if (value && String(value) > String(latest.get(route.workOrderId) || '')) latest.set(route.workOrderId, value);
    }
    for (const item of completed) if (missingDate(item)) item.completedAt = latest.get(item.id) || '';
  }
  const selected = completed.filter((item) => {
    const key = dateKey(item.completedAt);
    return key && key >= range.from && key <= range.to;
  });
  if (!includeItems || !selected.length) return selected;
  const orderSelection = ids('id', selected.map((item) => item.orderId));
  const [orders] = await connection.execute(`SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.customerId')) AS customerId FROM bobo_orders_v2 WHERE ${orderSelection.where}`, orderSelection.params);
  sections.orders = orderSelection;
  sections.customers = ids('record_id', orders.map((item) => item.customerId).filter(Boolean));
  sections.workOrders = ids('order_id', selected.map((item) => item.orderId));
  return selected;
}

function jsonString(field) {
  return `JSON_UNQUOTE(JSON_EXTRACT(payload, '$.${field}'))`;
}

function utcReportWindow(from, to) {
  const start = new Date(`${from}T00:00:00+08:00`);
  const end = new Date(`${to}T00:00:00+08:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  const sqlDate = (value) => value.toISOString().slice(0, 23).replace('T', ' ');
  return [sqlDate(start), sqlDate(end)];
}

function selectManagementReport(sections, range) {
  if (!range) return;
  const window = utcReportWindow(range.from, range.to);
  sections.deletedUsers = {};
  sections.orderFinancialAccessUserIds = {};
  sections.reports = filter(`(created_at >= ? AND created_at < ?) OR id IN (
    SELECT ranked.id FROM (
      SELECT r.id, ROW_NUMBER() OVER (PARTITION BY r.route_id ORDER BY
        BINARY JSON_UNQUOTE(JSON_EXTRACT(r.payload, '$.createdAt')) DESC, r.source_position ASC) AS row_rank
      FROM bobo_reports_v2 r JOIN bobo_routes_v2 route ON route.id = r.route_id
      WHERE BINARY JSON_UNQUOTE(JSON_EXTRACT(route.payload, '$.status')) = BINARY '已完成'
    ) ranked WHERE ranked.row_rank = 1
  )`, ...window);
  sections.routes = filter(`BINARY ${jsonString('status')} = BINARY '已完成' OR id IN (
    SELECT route_id FROM bobo_reports_v2 WHERE created_at >= ? AND created_at < ?
  )`, ...window);
  sections.workOrders = filter(`id IN (
    SELECT work_order_id FROM bobo_routes_v2 WHERE BINARY ${jsonString('status')} = BINARY '已完成'
    UNION SELECT work_order_id FROM bobo_reports_v2 WHERE created_at >= ? AND created_at < ?
  )`, ...window);
  sections.orders = filter('id IN (SELECT w.order_id FROM bobo_work_orders_v2 w JOIN bobo_reports_v2 r ON r.work_order_id = w.id WHERE r.created_at >= ? AND r.created_at < ?)', ...window);
  sections.customers = filter(`record_id IN (
    SELECT JSON_UNQUOTE(JSON_EXTRACT(o.payload, '$.customerId')) FROM bobo_orders_v2 o
    JOIN bobo_work_orders_v2 w ON w.order_id = o.id JOIN bobo_reports_v2 r ON r.work_order_id = w.id
    WHERE r.created_at >= ? AND r.created_at < ?
  )`, ...window);
}

async function selectHistory(connection, sections, pathname, { filters, dateInRange, includeFeedback, matchWorkOrders }) {
  if (pathname === '/api/history/work-orders') {
    const candidates = filters.workOrderId ? filter('id = ?', filters.workOrderId) : {};
    const orderCandidates = filters.workOrderId
      ? filter('id IN (SELECT order_id FROM bobo_work_orders_v2 WHERE id = ?)', filters.workOrderId) : {};
    const heads = { workOrders: candidates, orders: orderCandidates, customers: {} };
    if (filters.workOrderId) {
      heads.customers = filter(`record_id IN (SELECT ${jsonString('customerId')} FROM bobo_orders_v2 WHERE ${orderCandidates.where})`, ...orderCandidates.params);
    }
    if (filters.dateType === 'completedAt' && (filters.from || filters.to)) {
      const orderFilter = filters.workOrderId ? 'work_order_id = ? AND ' : '';
      heads.routes = filter(orderFilter + "BINARY JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')) = BINARY '已完成'", ...(filters.workOrderId ? [filters.workOrderId] : []));
    }
    const state = await readRowState(connection, { sections: heads, trackChanges: false });
    const matched = matchWorkOrders(state, filters);
    const workOrderIds = matched.map((item) => item.id);
    const orderIds = matched.map((item) => item.orderId).filter(Boolean);
    sections.workOrders = ids('id', workOrderIds);
    sections.orders = ids('id', orderIds);
    sections.customers = ids('record_id', matched.map((item) => item.customerId).filter(Boolean));
    sections.deletedUsers = {};
    sections.exceptions = ids('work_order_id', workOrderIds);
    const drawingWorkOrders = ids(jsonString('workOrderId'), workOrderIds);
    const drawingOrders = ids(jsonString('orderId'), orderIds);
    const orphanDrawings = matched.some((item) => !item.orderId) ? " OR JSON_EXTRACT(payload, '$.orderId') IS NULL" : '';
    sections.drawings = filter(drawingWorkOrders.where + ' OR ' + drawingOrders.where + orphanDrawings, ...drawingWorkOrders.params, ...drawingOrders.params);
    const graph = ids('work_order_id', workOrderIds);
    const routeReferences = [
      'SELECT route_id FROM bobo_exceptions_v2 WHERE ' + graph.where,
      'SELECT ' + jsonString('issueRouteId') + ' FROM bobo_exceptions_v2 WHERE ' + graph.where
    ];
    const params = [...graph.params, ...graph.params, ...graph.params];
    if (includeFeedback) {
      sections.customerFeedbacks = ids(jsonString('workOrderId'), workOrderIds);
      routeReferences.push('SELECT ' + jsonString('routeId') + ' FROM raw_customer_feedbacks WHERE ' + sections.customerFeedbacks.where);
      params.push(...sections.customerFeedbacks.params);
    }
    sections.routes = filter(graph.where + ' OR id IN (' + routeReferences.join(' UNION ') + ')', ...params);
    return;
  }
  const [exceptions] = await connection.execute(`SELECT id, work_order_id AS workOrderId, route_id AS routeId,
    ${jsonString('createdAt')} AS createdAt FROM bobo_exceptions_v2
    WHERE (? = '' OR BINARY ${jsonString('status')} = BINARY ?)`, [filters.status, filters.status]);
  const candidates = exceptions.filter((item) => !filters.from || dateInRange(item.createdAt, filters.from, filters.to));
  sections.exceptions = ids('id', candidates.map((item) => item.id));
  sections.routes = ids('id', candidates.map((item) => item.routeId));
  sections.workOrders = ids('id', candidates.map((item) => item.workOrderId));
  const workOrders = sections.workOrders;
  sections.orders = filter(`id IN (SELECT order_id FROM bobo_work_orders_v2 WHERE ${workOrders.where})`, ...workOrders.params);
  sections.customers = filter(`record_id IN (SELECT ${jsonString('customerId')} FROM bobo_orders_v2 WHERE ${sections.orders.where})`, ...sections.orders.params);
  sections.attachments = filter(`BINARY ${jsonString('url')} IN (
    SELECT BINARY images.url FROM bobo_exceptions_v2
    JOIN JSON_TABLE(payload, '$.images[*]' COLUMNS (url TEXT PATH '$')) images
    WHERE ${sections.exceptions.where}
  )`, ...sections.exceptions.params);
}

async function selectDeliveries(connection, sections, pathname, userId, deliveryAccess) {
  const identity = await readRowState(connection, { sections, trackChanges: false });
  const user = identity.users.find((item) => item.id === userId && item.active);
  if (!deliveryAccess.canDrive(user)) return;
  let orderIds;
  if (pathname === '/api/deliveries/available') {
    const [candidates] = await connection.execute(`SELECT o.id FROM bobo_orders_v2 o
      WHERE BINARY JSON_UNQUOTE(JSON_EXTRACT(o.payload, '$.orderOrigin')) = BINARY 'platform'
      AND BINARY JSON_UNQUOTE(JSON_EXTRACT(o.payload, '$.sourceChannel')) IN (?, ?, ?)
      AND EXISTS (SELECT 1 FROM bobo_work_orders_v2 w WHERE w.order_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM bobo_work_orders_v2 w WHERE w.order_id = o.id AND (
        NOT (BINARY JSON_UNQUOTE(JSON_EXTRACT(w.payload, '$.status')) <=> BINARY '已完成')
        OR BINARY JSON_UNQUOTE(JSON_EXTRACT(w.payload, '$.creationStatus')) = BINARY 'pending'
      ))`, [...deliveryAccess.platformChannels]);
    orderIds = candidates.map((item) => item.id);
    sections.workOrders = ids('order_id', orderIds);
  } else {
    const status = `BINARY ${jsonString('status')} IN ('delivering', 'delivered')`;
    const selection = deliveryAccess.canSupervise(user)
      ? filter(status)
      : filter(`${status} AND BINARY ${jsonString('driverId')} = BINARY ?`, userId);
    const visible = await readRowState(connection, { sections: { deliveries: selection }, trackChanges: false });
    orderIds = visible.deliveries.map((item) => item.orderId).filter((value) => typeof value === 'string');
    sections.attachments = ids('record_id', visible.deliveries.flatMap((item) => item.proofAttachmentIds || []));
  }
  sections.deliveries = ids(`BINARY ${jsonString('orderId')}`, orderIds);
  sections.orders = ids('id', orderIds);
  sections.customers = filter(`record_id IN (SELECT ${jsonString('customerId')} FROM bobo_orders_v2 WHERE ${sections.orders.where})`, ...sections.orders.params);
  sections.users = {};
  sections.orderFinancialAccessUserIds = {};
}

function readScopedRows(pool, { pathname, userId, routeId, completions, reportRange, history, deliveryAccess, reportDashboard, bootstrapDashboard }, read) {
  return withConsistentRowRead(pool, async (connection) => {
    const sections = {};
    if (pathname !== '/api/external/health') sections.users = filter('record_id = ?', typeof userId === 'string' ? userId : '');
    let completed;
    if (pathname === '/api/deliveries/my' || pathname === '/api/deliveries/available') {
      await selectDeliveries(connection, sections, pathname, userId, deliveryAccess);
    } else if (pathname === '/api/reports/management-export' || pathname.startsWith('/api/history/')) {
      const identity = await readRowState(connection, { sections, trackChanges: false });
      const user = identity.users.find((item) => item.id === userId && item.active);
      if (pathname === '/api/reports/management-export' && reportRange && reportRange.canRead(user)) {
        sections.users = {};
        selectManagementReport(sections, reportRange);
      } else if (history && history.canRead(user)) {
        await selectHistory(connection, sections, pathname, { ...history, includeFeedback: history.canViewFeedback(user) });
        if (pathname === '/api/history/work-orders') sections.users = {};
      }
    } else if (pathname === '/api/mobile/completions') {
      completed = await selectCompletions(connection, sections, completions);
    } else if (pathname === '/api/dashboard' || pathname === '/api/tv-dashboard' || bootstrapDashboard) {
      Object.assign(sections, dashboardSections);
      if (bootstrapDashboard) {
        sections.reports = filter(`BINARY ${jsonString('reportType')} = BINARY 'quality'`);
      }
      sections.users = {};
      if (pathname === '/api/tv-dashboard') {
        sections.settings = {};
        sections.deletedUsers = {};
        if (reportDashboard) sections.orderFinancialAccessUserIds = {};
      } else {
        sections.orderFinancialAccessUserIds = {};
      }
    } else if (pathname === '/api/me') {
      sections.users = {};
      sections.orderFinancialAccessUserIds = {};
    } else if (pathname === '/api/audit-logs') {
      sections.users = {};
      sections.deletedUsers = {};
    } else if (pathname === '/api/qr/route/weapp.png') {
      sections.routes = filter('id = ?', routeId);
    } else if (['/api/report-context', '/api/dispatch-board/report-context'].includes(pathname) && userId && routeId) {
      const [[target]] = await connection.execute('SELECT w.order_id, r.work_order_id FROM bobo_routes_v2 r JOIN bobo_work_orders_v2 w ON w.id = r.work_order_id WHERE r.id = ?', [routeId]);
      if (target) {
        sections.orders = filter('id = ?', target.order_id);
        sections.workOrders = filter('id = ?', target.work_order_id);
        sections.routes = filter('work_order_id = ?', target.work_order_id);
        sections.reports = filter('route_id = ?', routeId);
      }
    }
    return read(await readRowState(connection, { sections, trackChanges: false }), connection, completed);
  });
}

async function withScopedRows(pool, action, shouldApply, { pathname, userId, body, reportId, inbound, platformChannels }) {
  const connection = await pool.getConnection();
  const rollbackFiles = [];
  let committing = false;
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    // The shared gate prevents races with legacy writers that rebuild the whole state.
    const exclusive = ['/api/external/work-orders', '/api/drawings/preview'].includes(pathname);
    const [gate] = await connection.query(`SELECT id FROM bobo_state_write_lock WHERE id = 1 FOR ${exclusive ? 'UPDATE' : 'SHARE'}`);
    if (gate.length !== 1) throw new Error('Missing state write lock');
    const sections = { users: filter('record_id = ?', typeof userId === 'string' ? userId : '') };
    const { routeId } = body;
    const proxyReport = pathname === '/api/dispatch-board/report';
    if (proxyReport && userId) {
      // A supervisor's submission ID is shared across orders, including legacy reports.
      await connection.execute('SELECT position FROM raw_users WHERE record_id = ? FOR UPDATE', [userId]);
      sections.users = {};
      sections.orderFinancialAccessUserIds = {};
    }
    const [targets] = (pathname === '/api/report' || (proxyReport && userId)) && typeof routeId === 'string' && routeId.length <= 80 ? await connection.execute(
      'SELECT w.order_id, r.work_order_id FROM bobo_routes_v2 r JOIN bobo_work_orders_v2 w ON w.id = r.work_order_id WHERE r.id = ?',
      [routeId]
    ) : [[]];
    const target = targets[0];
    if (target) {
      const order = await lockOrder(connection, target.order_id);
      const [[route]] = await connection.execute("SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.processName')) AS processName FROM bobo_routes_v2 WHERE id = ?", [routeId]);
      const quality = route?.processName === '质检';
      sections.orders = filter('id = ?', target.order_id);
      const platformOrder = order.orderOrigin === 'platform' && platformChannels.has(order.sourceChannel) && Boolean(order.externalOrderNumber);
      sections.workOrders = platformOrder ? filter('order_id = ?', target.order_id) : filter('id = ?', target.work_order_id);
      sections.routes = platformOrder
        ? filter('work_order_id IN (SELECT id FROM bobo_work_orders_v2 WHERE order_id = ?)', target.order_id)
        : filter('work_order_id = ?', target.work_order_id);
      sections.exceptions = filter('work_order_id = ?', target.work_order_id);
      if (quality) {
        sections.reports = filter('work_order_id = ?', target.work_order_id);
        sections.processes = {};
      } else if (reportId) {
        sections.reports = filter('id = ?', reportId);
      }
      if (proxyReport) {
        const duplicate = `BINARY ${jsonString('dispatchSubmissionId')} = BINARY ? AND BINARY ${jsonString('reporterId')} = BINARY ?`;
        const submissionId = String(body.submissionId || '');
        sections.reports = quality
          ? filter(`work_order_id = ? OR (${duplicate})`, target.work_order_id, submissionId, userId)
          : filter(duplicate, submissionId, userId);
      }
      if (platformOrder && reportId) sections.platformWebhookEvents = filter('event_id = ?', `bobo-report-${reportId}`);
    } else if (pathname === '/api/external/work-orders' && inbound) {
      await selectInbound(connection, sections, inbound);
    } else if (['/api/delivery-trips/start', '/api/deliveries/complete', '/api/deliveries/release'].includes(pathname)) {
      await selectDeliveryMutation(connection, sections, pathname, body);
    } else if (['/api/platform-orders/confirm', '/api/platform-orders/sync-processes', '/api/orders/fulfillment'].includes(pathname)) {
      await selectOrderMutation(connection, sections, pathname, body, platformChannels);
    } else if (pathname === '/api/drawings/preview' && typeof body.drawingId === 'string') {
      sections.drawings = filter('record_id = ?', body.drawingId);
      const [[drawing]] = await connection.execute("SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.url')) AS url FROM raw_drawings WHERE record_id = ? ORDER BY position LIMIT 1", [body.drawingId]);
      if (drawing) sections.attachments = filter("BINARY JSON_UNQUOTE(JSON_EXTRACT(payload, '$.url')) = BINARY ?", drawing.url);
    }
    const options = { sections, auditBuffer: true, writableSections: new Set([...scopedWrites[pathname], 'auditLogs']) };
    const state = await readRowState(connection, options);
    await action(state, rollbackFiles);
    if (shouldApply()) await applyRowChanges(connection, state, options);
    committing = true;
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (!committing) {
      for (const remove of rollbackFiles) remove();
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function selectInbound(connection, sections, { input, nonce }) {
  const [orders] = await connection.query(`SELECT id,
    CAST(JSON_ARRAY(JSON_EXTRACT(payload, '$.orderNo'), JSON_EXTRACT(payload, '$.externalOrderNumber')) AS CHAR CHARACTER SET utf8mb4) AS identifiers
    FROM bobo_orders_v2 ORDER BY source_position`);
  const normalized = normalizeOrderNumber(input.externalOrderNumber);
  const order = orders.find((item) => {
    const [orderNo, externalOrderNumber] = JSON.parse(item.identifiers);
    return externalOrderNumber === input.externalOrderNumber || normalizeOrderNumber(orderNo) === normalized;
  });
  if (order) {
    sections.orders = filter('id = ?', order.id);
    sections.workOrders = filter('order_id = ?', order.id);
    sections.routes = filter('work_order_id IN (SELECT id FROM bobo_work_orders_v2 WHERE order_id = ?)', order.id);
  } else {
    sections.customers = filter("BINARY JSON_UNQUOTE(JSON_EXTRACT(payload, '$.phone')) = BINARY ?", input.phone);
  }
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  sections.integrationNonces = filter(`BINARY JSON_UNQUOTE(JSON_EXTRACT(payload, '$.nonce')) = BINARY ?
    OR COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.createdAt')), 'null'), '') <= ?`, nonce, cutoff);
}

async function selectOrderMutation(connection, sections, pathname, body, platformChannels) {
  let orderId = body.orderId;
  if (pathname === '/api/platform-orders/sync-processes') {
    const [[order]] = await connection.execute(`SELECT id FROM bobo_orders_v2
      WHERE BINARY JSON_UNQUOTE(JSON_EXTRACT(payload, '$.externalOrderNumber')) = BINARY ?
        AND BINARY JSON_UNQUOTE(JSON_EXTRACT(payload, '$.orderOrigin')) = BINARY 'platform'
        AND BINARY JSON_UNQUOTE(JSON_EXTRACT(payload, '$.sourceChannel')) IN (?, ?, ?)
      ORDER BY source_position LIMIT 1`, [typeof body.orderNumber === 'string' ? body.orderNumber : '', ...platformChannels]);
    orderId = order?.id;
  }
  if (typeof orderId !== 'string' || !orderId || orderId.length > 80) return;
  const [[existing]] = await connection.execute('SELECT id FROM bobo_orders_v2 WHERE id = ?', [orderId]);
  if (!existing) return;
  await lockOrder(connection, orderId);
  sections.orders = filter('id = ?', orderId);
  sections.workOrders = filter('order_id = ?', orderId);
  if (pathname.startsWith('/api/platform-orders/')) {
    sections.routes = filter('work_order_id IN (SELECT id FROM bobo_work_orders_v2 WHERE order_id = ?)', orderId);
    if (pathname.endsWith('/confirm')) {
      sections.processes = {};
      sections.exceptions = filter('work_order_id IN (SELECT id FROM bobo_work_orders_v2 WHERE order_id = ?)', orderId);
    } else {
      sections.platformWebhookEvents = filter('event_id = ?', `bobo-report-sync-${orderId}-${body.requestId}`);
    }
  } else {
    sections.platformWebhookEvents = filter('event_id = ?', `bobo-shipment-${orderId}`);
  }
}

async function selectDeliveryMutation(connection, sections, pathname, body) {
  const starting = pathname === '/api/delivery-trips/start';
  const orderIds = starting
    ? [...new Set((Array.isArray(body.orderIds) ? body.orderIds : []).map(String).filter(Boolean))]
    : [String(body.orderId || '')];
  if (!orderIds.length || orderIds.some((id) => !id || id.length > 80)) return;
  for (const orderId of orderIds.slice().sort()) {
    await connection.execute('SELECT id FROM bobo_orders_v2 WHERE id = ? FOR UPDATE', [orderId]);
  }
  sections.orders = ids('id', orderIds);
  sections.workOrders = ids('order_id', orderIds);
  if (starting) {
    sections.deliveries = ids(`BINARY ${jsonString('orderId')}`, orderIds);
    sections.platformWebhookEvents = ids('event_id', orderIds.map((id) => `bobo-shipment-${id}`));
    return;
  }
  const [orderId] = orderIds;
  const orderPredicate = `BINARY ${jsonString('orderId')} = BINARY ?`;
  const [[delivery]] = await connection.execute(`SELECT ${jsonString('tripId')} AS tripId
    FROM raw_deliveries WHERE ${orderPredicate} ORDER BY position LIMIT 1`, [orderId]);
  if (!delivery) return;
  sections.deliveries = filter(orderPredicate, orderId);
  if (delivery.tripId && delivery.tripId !== 'null') {
    // A trip can span several orders. Lock it before checking sibling deliveries.
    await connection.execute('SELECT position FROM raw_delivery_trips WHERE record_id = ? FOR UPDATE', [delivery.tripId]);
    sections.deliveryTrips = filter('record_id = ?', delivery.tripId);
    sections.deliveries = filter(`${orderPredicate} OR BINARY ${jsonString('tripId')} = BINARY ?`, orderId, delivery.tripId);
  }
  if (pathname === '/api/deliveries/complete') sections.platformWebhookEvents = filter('event_id = ?', `bobo-delivery-${orderId}`);
}

module.exports = { readScopedRows, scopedReads, withScopedRows, scopedWrites };
