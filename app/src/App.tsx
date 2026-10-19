import { Routes, Route } from 'react-router'
import { Toaster } from "@/components/ui/sonner"
import AuthLayout from "./components/AuthLayout"
import Dashboard from "./pages/Dashboard"
import Sourcing from "./pages/Sourcing"
import Procurement from "./pages/Procurement"
import Inventory from "./pages/Inventory"
import Orders from "./pages/Orders"
import Shipping from "./pages/Shipping"
import Finance from "./pages/Finance"
import Settings from "./pages/Settings"
import Login from "./pages/Login"
import NotFound from "./pages/NotFound"

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<AuthLayout><Dashboard /></AuthLayout>} />
        <Route path="/sourcing" element={<AuthLayout><Sourcing /></AuthLayout>} />
        <Route path="/procurement" element={<AuthLayout><Procurement /></AuthLayout>} />
        <Route path="/inventory" element={<AuthLayout><Inventory /></AuthLayout>} />
        <Route path="/orders" element={<AuthLayout><Orders /></AuthLayout>} />
        <Route path="/shipping" element={<AuthLayout><Shipping /></AuthLayout>} />
        <Route path="/finance" element={<AuthLayout><Finance /></AuthLayout>} />
        <Route path="/settings" element={<AuthLayout><Settings /></AuthLayout>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  )
}
