import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import AuthLayout from "@/components/AuthLayout";
import { LoadingPanel } from "@/components/workbench/States";
import NotFoundPage from "./NotFoundPage";

const OverviewPage = lazy(() => import("@/features/overview/OverviewPage"));
const OrdersPage = lazy(() => import("@/features/orders/OrdersPage"));
const FulfillmentPage = lazy(
  () => import("@/features/fulfillment/FulfillmentPage")
);
const CatalogPage = lazy(() => import("@/features/catalog/CatalogPage"));
const PurchasingPage = lazy(
  () => import("@/features/purchasing/PurchasingPage")
);
const SourcingPage = lazy(() => import("@/features/sourcing/SourcingPage"));
const FinancePage = lazy(() => import("@/features/finance/FinancePage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const LoginPage = lazy(() => import("@/features/auth/LoginPage"));

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingPanel />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <AuthLayout>
              <OverviewPage />
            </AuthLayout>
          }
        />
        <Route
          path="/orders"
          element={
            <AuthLayout>
              <OrdersPage />
            </AuthLayout>
          }
        />
        <Route
          path="/shipping"
          element={
            <AuthLayout>
              <FulfillmentPage mode="shipping" />
            </AuthLayout>
          }
        />
        <Route
          path="/after-sales"
          element={
            <AuthLayout>
              <FulfillmentPage mode="after-sales" />
            </AuthLayout>
          }
        />
        <Route
          path="/inventory"
          element={
            <AuthLayout>
              <CatalogPage />
            </AuthLayout>
          }
        />
        <Route
          path="/procurement"
          element={
            <AuthLayout>
              <PurchasingPage />
            </AuthLayout>
          }
        />
        <Route
          path="/sourcing"
          element={
            <AuthLayout>
              <SourcingPage />
            </AuthLayout>
          }
        />
        <Route
          path="/finance"
          element={
            <AuthLayout>
              <FinancePage />
            </AuthLayout>
          }
        />
        <Route
          path="/settings"
          element={
            <AuthLayout>
              <SettingsPage />
            </AuthLayout>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
