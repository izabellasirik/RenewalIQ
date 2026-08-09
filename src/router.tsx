import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { MarketFinderPage } from './pages/MarketFinderPage';
import { NewAccountPage } from './pages/NewAccountPage';
import { UploadPage } from './pages/UploadPage';
import { RiskProfilePage } from './pages/RiskProfilePage';
import { ReviewPage } from './pages/ReviewPage';
import { SubmissionAssistantPage } from './pages/SubmissionAssistantPage';
import { CarrierAppetitePage } from './pages/CarrierAppetitePage';
import { AnalyticsPage } from './pages/AnalyticsPage';

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
]);
