import { Route, Routes } from 'react-router-dom'
import AppShell from '@/components/AppShell'
import UpdateBanner from '@/components/UpdateBanner'
import HomePage from '@/pages/HomePage'
import InspectionsPage from '@/pages/InspectionsPage'
import NewInspectionPage from '@/pages/NewInspectionPage'
import InspectionPage from '@/pages/InspectionPage'
import LeadsPage from '@/pages/LeadsPage'
import PropertyPage from '@/pages/PropertyPage'
import LeadPage from '@/pages/LeadPage'
import EvidencePackagePage from '@/pages/EvidencePackagePage'
import EstimatePage from '@/pages/EstimatePage'
import CostBookPage from '@/pages/CostBookPage'
import DiagnosticsPage from '@/pages/DiagnosticsPage'
import ManagerPage from '@/pages/ManagerPage'
import RouteHistoryPage from '@/pages/RouteHistoryPage'
import NotFoundPage from '@/pages/NotFoundPage'
import MapPage from '@/pages/MapPage'
import MorePage from '@/pages/MorePage'
import TrainingSimulatorPage from '@/pages/TrainingSimulatorPage'
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
          <Route path="/lead/:id" element={<LeadPage />} />`r`n          <Route path="/evidence/:id" element={<EvidencePackagePage />} />
          <Route path="/property/:addressKey" element={<PropertyPage />} />
          <Route path="/estimate" element={<EstimatePage />} />
          <Route path="/estimate/:id" element={<EstimatePage />} />
          <Route path="/costs" element={<CostBookPage />} />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="/manager" element={<ManagerPage />} />
          <Route path="/routes" element={<RouteHistoryPage />} />
          <Route path="/inspections" element={<InspectionsPage />} />
          <Route path="/new" element={<NewInspectionPage />} />
          <Route path="/inspection/:id" element={<InspectionPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/training" element={<TrainingSimulatorPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </SessionProvider>
  )
}

