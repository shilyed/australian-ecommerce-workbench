import { Toaster } from "@/components/ui/sonner"
import { AppRoutes } from "./app/routes"

export default function App() {
  return (
    <>
      <AppRoutes />
      <Toaster richColors position="top-right" />
    </>
  )
}
