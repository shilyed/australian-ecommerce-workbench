import {
  Boxes,
  ClipboardCheck,
  Gauge,
  Landmark,
  PackageSearch,
  RotateCcw,
  Settings,
  Ship,
  ShoppingCart,
} from "lucide-react";

export const menuItems = [
  { icon: Gauge, label: "今日经营", path: "/" },
  { icon: ClipboardCheck, label: "订单处理", path: "/orders" },
  { icon: Ship, label: "打包发货", path: "/shipping" },
  { icon: RotateCcw, label: "售后处理", path: "/after-sales" },
  { icon: Boxes, label: "商品与补货", path: "/inventory" },
  { icon: ShoppingCart, label: "采购与收货", path: "/procurement" },
  { icon: PackageSearch, label: "选品与供应商", path: "/sourcing" },
  { icon: Landmark, label: "利润与到账", path: "/finance" },
  { icon: Settings, label: "店铺与设置", path: "/settings" },
];
