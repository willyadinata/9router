// SPA router: one route per Next.js page. Server-wrapper props resolved here:
// - machineId is accepted-but-unused by the clients -> stubbed as ""
// - CLI_TOOLS[toolId] guard renders a local 404 (was `notFound()` server-side)
import { createBrowserRouter, Navigate, Outlet, Link, useRouteError, useParams } from "react-router-dom";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
import { DashboardLayout } from "@/shared/components";
import { CLI_TOOLS } from "@/shared/constants/cliTools";

import LoginPage from "@/app/login/page";
import CallbackPage from "@/app/callback/page";
import LandingPage from "@/app/landing/page";
import PricingSettingsPage from "@/app/dashboard/settings/pricing/page";
import EndpointPageClient from "@/app/(dashboard)/dashboard/endpoint/EndpointPageClient";
import ProvidersPage from "@/app/(dashboard)/dashboard/providers/page";
import ProviderNewPage from "@/app/(dashboard)/dashboard/providers/new/page";
import ProviderDetailPage from "@/app/(dashboard)/dashboard/providers/[id]/page";
import CombosPage from "@/app/(dashboard)/dashboard/combos/page";
import BasicChatPage from "@/app/(dashboard)/dashboard/basic-chat/page";
import ConsoleLogPage from "@/app/(dashboard)/dashboard/console-log/page";
import MediaWebPage from "@/app/(dashboard)/dashboard/media-providers/web/page";
import MediaComboDetailPage from "@/app/(dashboard)/dashboard/media-providers/combo/[id]/page";
import MediaKindPage from "@/app/(dashboard)/dashboard/media-providers/[kind]/page";
import MediaKindDetailPage from "@/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page";
import MitmPage from "@/app/(dashboard)/dashboard/mitm/page";
import ProfilePage from "@/app/(dashboard)/dashboard/profile/page";
import ProxyPoolsPage from "@/app/(dashboard)/dashboard/proxy-pools/page";
import PxpipePage from "@/app/(dashboard)/dashboard/pxpipe/page";
import QuotaPage from "@/app/(dashboard)/dashboard/quota/page";
import SkillsPage from "@/app/(dashboard)/dashboard/skills/page";
import TokenSaverPage from "@/app/(dashboard)/dashboard/token-saver/page";
import TranslatorPage from "@/app/(dashboard)/dashboard/translator/page";
import UsagePage from "@/app/(dashboard)/dashboard/usage/page";
import CliToolsPage from "@/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient";
import ToolDetailClient from "@/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient";

// Order: ThemeProvider > i18n provider > outlet (providers never consume router context)
function RootShell() {
  return (
    <ThemeProvider>
      <RuntimeI18nProvider>
        <Outlet />
      </RuntimeI18nProvider>
    </ThemeProvider>
  );
}

function DashboardShell() {
  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}

function Local404({ back = "/dashboard" }) {
  return (
    <div className="text-center py-20">
      <p className="text-text-muted">Not found</p>
      <Link to={back} className="text-primary mt-4 inline-block">
        Back
      </Link>
    </div>
  );
}

function RouteError() {
  const err = useRouteError();
  if (err && (err.digest === "NEXT_NOT_FOUND" || err?.status === 404)) {
    return <Local404 />;
  }
  if (err && err.digest === "NEXT_REDIRECT" && err.url) {
    return <Navigate to={err.url} replace />;
  }
  return (
    <div className="text-center py-20">
      <p className="text-text-muted">Something went wrong</p>
      <Link to="/dashboard" className="text-primary mt-4 inline-block">
        Back to Dashboard
      </Link>
    </div>
  );
}

function ToolDetailRoute() {
  const { toolId } = useParams();
  if (!CLI_TOOLS[toolId]) return <Local404 back="/dashboard/cli-tools" />;
  return <ToolDetailClient toolId={toolId} machineId="" />;
}

export const router = createBrowserRouter([
  {
    element: <RootShell />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Navigate to="/dashboard" replace /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/callback", element: <CallbackPage /> },
      { path: "/landing", element: <LandingPage /> },
      // No dashboard layout upstream (src/app/dashboard/*, outside the (dashboard) group)
      { path: "/dashboard/settings/pricing", element: <PricingSettingsPage /> },
      {
        path: "/dashboard",
        element: <DashboardShell />,
        children: [
          { index: true, element: <EndpointPageClient machineId="" /> },
          { path: "endpoint", element: <EndpointPageClient machineId="" /> },
          { path: "providers", element: <ProvidersPage /> },
          { path: "providers/new", element: <ProviderNewPage /> },
          { path: "providers/:id", element: <ProviderDetailPage /> },
          { path: "combos", element: <CombosPage /> },
          { path: "basic-chat", element: <BasicChatPage /> },
          { path: "console-log", element: <ConsoleLogPage /> },
          { path: "media-providers/web", element: <MediaWebPage /> },
          { path: "media-providers/combo/:id", element: <MediaComboDetailPage /> },
          { path: "media-providers/:kind", element: <MediaKindPage /> },
          { path: "media-providers/:kind/:id", element: <MediaKindDetailPage /> },
          { path: "mitm", element: <MitmPage /> },
          { path: "profile", element: <ProfilePage /> },
          { path: "proxy-pools", element: <ProxyPoolsPage /> },
          { path: "pxpipe", element: <PxpipePage /> },
          { path: "quota", element: <QuotaPage /> },
          { path: "skills", element: <SkillsPage /> },
          { path: "token-saver", element: <TokenSaverPage /> },
          { path: "translator", element: <TranslatorPage /> },
          { path: "usage", element: <UsagePage /> },
          { path: "cli-tools", element: <CliToolsPage machineId="" /> },
          { path: "cli-tools/:toolId", element: <ToolDetailRoute /> },
        ],
      },
      { path: "*", element: <Local404 /> },
    ],
  },
]);
