import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AdminShell } from './components/layout/AdminShell';
import { DashboardPage } from './pages/DashboardPage';
import { MarketFinderPage } from './pages/MarketFinderPage';
import { NewAccountPage } from './pages/NewAccountPage';
import { UploadPage } from './pages/UploadPage';
import { RiskProfilePage } from './pages/RiskProfilePage';
import { ReviewPage } from './pages/ReviewPage';
import { SubmissionAssistantPage } from './pages/SubmissionAssistantPage';
import { CarrierAppetitePage } from './pages/CarrierAppetitePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminAppetiteUpdatesPage } from './pages/AdminAppetiteUpdatesPage';
import { AdminFeedbackPage } from './pages/AdminFeedbackPage';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/market-finder', element: <MarketFinderPage /> },
      { path: '/analytics', element: <AnalyticsPage /> },
      { path: '/accounts/new', element: <NewAccountPage /> },
      { path: '/accounts/:accountId/upload', element: <UploadPage /> },
      { path: '/accounts/:accountId/risk-profile', element: <RiskProfilePage /> },
      { path: '/accounts/:accountId/review', element: <ReviewPage /> },
      { path: '/accounts/:accountId/submission-assistant', element: <SubmissionAssistantPage /> },
      { path: '/accounts/:accountId/carrier-appetite', element: <CarrierAppetitePage /> },
    ],
  },
  {
    // Deliberately separate from AppShell — no broker Sidebar/TopBar. Reachable via a small,
    // discreet link in the broker Sidebar's footer (see Sidebar.tsx) or by going to /admin
    // directly. Real Supabase Auth + admin_users/RLS is the actual authorization boundary (see
    // AdminAuthGate and supabase/migrations), not the absence of a prominent nav item.
    element: <AdminShell />,
    children: [
      { path: '/admin', element: <AdminDashboardPage /> },
      { path: '/admin/appetite-updates', element: <AdminAppetiteUpdatesPage /> },
      { path: '/admin/feedback', element: <AdminFeedbackPage /> },
    ],
  },
]);
