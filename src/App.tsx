import { Route, Routes } from 'react-router-dom'
import AppShell from '@/components/AppShell'
import UpdateBanner from '@/components/UpdateBanner'
import HomePage from '@/pages/HomePage'
import InspectionsPage from '@/pages/InspectionsPage'
import NewInspectionPage from '@/pages/NewInspectionPage'
import InspectionPage from '@/pages/InspectionPage'
import LeadsPage from '@/pages/LeadsPage'
import EstimatePage from '@/pages/EstimatePage'
import CostBookPage from '@/pages/CostBookPage'
import NotFoundPage from '@/pages/NotFoundPage'
import { SessionProvider } from '@/features/auth/session'
import { useSync } from '@/features/auth/useSync'

/** Mounted once so the outbox drains app-wide, wherever the rep happens to be. */
function SyncRunner() {
  useSync()
  return null
}

export default function App() {
  return (
    <SessionProvider>
      <SyncRunner />
      <UpdateBanner />
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/estimate" element={<EstimatePage />} />
          <Route path="/estimate/:id" element={<EstimatePage />} />
          <Route path="/costs" element={<CostBookPage />} />
          <Route path="/inspections" element={<InspectionsPage />} />
          <Route path="/new" element={<NewInspectionPage />} />
          <Route path="/inspection/:id" element={<InspectionPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </SessionProvider>
  )
}
