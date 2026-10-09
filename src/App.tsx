import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const queryClient = new QueryClient()
import HomeownerPortal from '@/pages/HomeownerPortal'
import MissionPage from '@/pages/MissionPage'
import FreeRoofCheckPage from '@/pages/FreeRoofCheckPage'
import { Suspense, lazy, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import AppShell from '@/components/AppShell'
import UpdateBanner from '@/components/UpdateBanner'
import HomePage from '@/pages/HomePage'
import InspectionsPage from '@/pages/InspectionsPage'
import NewInspectionPage from '@/pages/NewInspectionPage'
import InspectionPage from '@/pages/InspectionPage'
import LeadsPage from '@/pages/LeadsPage'
import SubdivisionPage from '@/pages/SubdivisionPage'
import StormOSPage from '@/pages/StormOSPage'
import TeamPage from '@/pages/TeamPage'
import PropertyPage from '@/pages/PropertyPage'
import LeadPage from '@/pages/LeadPage'
import EvidencePackagePage from '@/pages/EvidencePackagePage'
import EstimatePage from '@/pages/EstimatePage'
import MapPage from '@/pages/MapPage'
import SettingsPage from '@/pages/SettingsPage'
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
const ContentCalendarPage = lazy(() => import('@/pages/ContentCalendarPage'))
const SocialDashboardPage = lazy(() => import('@/pages/SocialDashboardPage'))
const AutonomyConfigView = lazy(() => import('@/features/social/components/AutonomyConfigView'))

import { SessionProvider, useSession } from '@/features/auth/session'
import { useSync } from '@/features/auth/useSync'
import { trackEvent } from '@/lib/analytics'

/** Mounted once so the outbox drains app-wide, wherever the rep happens to be. */
function SyncRunner() {
  useSync()
  return null
}

/** Old links (map markers, search, push notifications) used /lead/:id. */
function LegacyLeadRedirect() {
  const { id } = useParams()
  return <Navigate to={`/leads/${id ?? ''}`} replace />
}

function RouteAnalytics() {
  const location = useLocation()
  
  useEffect(() => {
    trackEvent('page_view', { path: location.pathname })
  }, [location])

  return null
}

function Bootstrapper({ children }: { children: React.ReactNode }) {
  const { ready } = useSession()
  if (!ready) {
    return (
      <div className="min-h-screen bg-bg-app flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-text-secondary">
          <div className="size-6 rounded-full border-2 border-brand-400 border-t-transparent animate-spin" />
          <p className="text-sm font-semibold tracking-wide">Loading account…</p>
        </div>
      </div>
    )
  }
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Bootstrapper>
          <RouteAnalytics />
          <SyncRunner />
          <UpdateBanner />
          <Suspense fallback={<div className="p-4 text-text-secondary text-sm">Loading...</div>}>
            <Routes>
              <Route path="/portal/:id" element={<HomeownerPortal />} />
              <Route path="/free-roof-check" element={<FreeRoofCheckPage />} />
              <Route path="*" element={
                <AppShell>
                  <Suspense fallback={<div className="p-4 text-text-secondary text-sm">Loading module...</div>}>
                    <Routes>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/mission" element={<MissionPage />} />
                      <Route path="/leads" element={<LeadsPage />} />
                        <Route path="/subdivisions/:name" element={<SubdivisionPage />} />
                      <Route path="/storm-os" element={<StormOSPage />} />
                      <Route path="/team" element={<TeamPage />} />
                      <Route path="/leads/:id" element={<LeadPage />} />
                      <Route path="/lead/:id" element={<LegacyLeadRedirect />} />
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
                      <Route path="/calendar" element={<ContentCalendarPage />} />
                      <Route path="/social-metrics" element={<SocialDashboardPage />} />
                      <Route path="/autonomy" element={<AutonomyConfigView />} />
                      <Route path="/settings" element={<SettingsPage />} />
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
        </Bootstrapper>
      </SessionProvider>
    </QueryClientProvider>
  )
}









