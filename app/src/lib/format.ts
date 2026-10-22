export const money = (value: string | number | null | undefined, currency = "AUD") => {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
};

export const numberFmt = (value: number | null | undefined) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value ?? 0);

export const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "不适用" : `${(value * 100).toFixed(2)}%`;

export const dateTime = (value: Date | string | null | undefined) => {
  if (!value) return "未提供";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Australia/Sydney",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
};

export const dateOnly = (value: Date | string | null | undefined) => {
  if (!value) return "未提供";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
};

export const inputDateTime = (value?: Date | string | null) => {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const labels: Record<string, string> = {
  manual_confirm: "人工确认",
  system_controlled: "系统主控",
  orders: "订单",
  listings: "刊登",
  refunds: "退款",
  shipments: "发货",
  inventory: "库存",
  candidate: "候选",
  sample_evaluation: "样品评估",
  pending_decision: "待决策",
  adopted: "采用",
  rejected: "淘汰",
  paused: "暂缓",
  pending: "待确认",
  assess: "继续评估",
  approved: "业务确认可售",
  rejected_compliance: "不适售",
  active: "启用",
  inactive: "停用",
  draft: "草稿",
  ready: "待发布",
  publishing: "发布中",
  published: "在售",
  unpublished: "已下架",
  not_created: "未创建",
  ordered: "已下单",
  closed: "已关闭",
  cancelled: "已取消",
  none: "无",
  partial: "部分",
  full: "全部",
  unpaid: "未付款",
  paid: "已付款",
  partial_refund: "部分退款",
  refunded: "全额退款",
  unknown: "待确认",
  matching: "待匹配",
  shortage: "缺货",
  picking: "待拣货",
  packing: "待打包",
  awaiting_dispatch: "待交运",
  fulfilled: "履约结束",
  out_of_scope: "超出试点",
  unshipped: "未发货",
  open: "处理中",
  normal: "正常",
  delayed: "延迟",
  failed: "失败",
  auth_invalid: "授权失效",
  incomplete: "待补充",
  estimated: "预估",
  verified: "已核实",
  refund_only: "退款不退货",
  return_refund: "退货退款",
  reship: "补发",
  cancel_assist: "取消协助",
  dispute: "平台争议",
  processing: "处理中",
  waiting_external: "等待外部动作",
  confirmed: "已核对",
  awaiting: "等待退货",
  received: "已收到",
  pending_inspection: "待质检",
  qualified: "质检合格",
  defective: "残次隔离",
  dispatched: "已交运",
  platform_pending: "平台待核对",
  platform_confirmed: "平台已更新",
  platform_failed: "平台回传失败",
  not_connected: "未授权",
  authorized: "已授权",
  expired: "已过期",
  revoked: "已撤销",
  queued: "排队中",
  running: "执行中",
  succeeded: "成功",
  retrying: "待重试",
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低",
  operations: "运营/采购",
  fulfillment: "履约",
  finance: "财务核对",
  admin: "管理员",
  reconciled: "已核对",
  discrepancy: "有差异",
};

export const label = (value: string | null | undefined) => (value ? labels[value] ?? value : "—");

export const routeForBusiness = (type: string, id?: number) => {
  if (type === "order") return `/orders?queue=all&focus=${id ?? ""}`;
  if (type === "purchase") return `/procurement?focus=${id ?? ""}`;
  if (type === "after_sales") return `/after-sales?focus=${id ?? ""}`;
  if (type === "sku") return `/inventory?focus=${id ?? ""}`;
  if (type === "candidate") return `/sourcing?focus=${id ?? ""}`;
  return "/settings";
};
