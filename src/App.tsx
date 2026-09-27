import MemberPortal from '@/pages/MemberPortal'
import MissionPage from '@/pages/MissionPage'
import FreeRoofCheckPage from '@/pages/FreeRoofCheckPage'
import { Suspense, lazy, useEffect } from 'react'
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
import MapPage from '@/pages/MapPage'
import MorePage from '@/pages/MorePage'
import NotFoundPage from '@/pages/NotFoundPage'

// Lazy-loaded heavy/manager routes
const ManagerPage = lazy(() => import('@/pages/ManagerPage'))
const DiagnosticsPage = lazy(() => import('@/pages/DiagnosticsPage'))
const CostBookPage = lazy(() => import('@/pages/CostBookPage'))
const TrainingSimulatorPage = lazy(() => import('@/pages/TrainingSimulatorPage'))
const RouteHistoryPage = lazy(() => import('@/pages/RouteHistoryPage'))
const InboxPage = lazy(() => import('@/pages/InboxPage'))
const BrandBrainPage = lazy(() => import('@/pages/BrandBrainPage'))
const CreativeStudioPage = lazy(() => import('@/pages/CreativeStudioPage'))

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
      <Suspense fallback={<div className="p-4 text-text-secondary text-sm">Loading...</div>}>
        <Routes>
          <Route path="/demo/portal/:id" element={<MemberPortal />} />
          <Route path="/free-roof-check" element={<FreeRoofCheckPage />} />
          <Route path="*" element={
            <AppShell>
              <Suspense fallback={<div className="p-4 text-text-secondary text-sm">Loading module...</div>}>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/mission" element={<MissionPage />} />
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
                  <Route path="/inbox" element={<InboxPage />} />
                  <Route path="/brain" element={<BrandBrainPage />} />
                  <Route path="/studio" element={<CreativeStudioPage />} />
                  <Route path="/inspections" element={<InspectionsPage />} />
                  <Route path="/new" element={<NewInspectionPage />} />
                  <Route path="/inspection/:id" element={<InspectionPage />} />
                  <Route path="/map" element={<MapPage />} />
                  <Route path="/more" element={<MorePage />} />
                  <Route path="/training" element={<TrainingSimulatorPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </AppShell>
          } />
        </Routes>
      </Suspense>
    </SessionProvider>
  )
}




