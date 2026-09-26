import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
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
import { SessionProvider } from '@/features/auth/session'
import { useSync } from '@/features/auth/useSync'
import { trackEvent } from '@/lib/analytics'

/** Mounted once so the outbox drains app-wide, wherever the rep happens to be. */
function SyncRunner() {
  useSync()
  return null
}

function RouteAnalytics() {
  const location = useLocation()
  
  useEffect(() => {
    trackEvent('page_view', { path: location.pathname })
  }, [location])

  return null
}

export default function App() {
  return (
    <SessionProvider>
      <RouteAnalytics />
      <SyncRunner />
      <UpdateBanner />
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/lead/:id" element={<LeadPage />} />
          <Route path="/evidence/:id" element={<EvidencePackagePage />} />
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
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </SessionProvider>
  )
}
