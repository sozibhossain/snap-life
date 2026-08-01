import React from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { clerkAppearance } from "@/lib/clerkAppearance";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";

import Dashboard from "@/pages/dashboard";
import Users from "@/pages/users";
import AuditLog from "@/pages/audit";
import DevPage from "@/pages/dev";
import SettingsPage from "@/pages/settings";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import NotFound from "@/pages/not-found";
import { AdminGate } from "@/components/AdminGate";

// On localhost / 127.0.0.1, skip the host-derived proxy key — there's no
// `clerk.localhost` host to load clerk.browser.js from. Use the raw
// VITE_CLERK_PUBLISHABLE_KEY so Clerk loads its JS from its own CDN.
const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const isIpHost = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(window.location.hostname);
const clerkProxyEnv = import.meta.env.VITE_CLERK_PROXY_URL;
const useClerkProxy =
  !isLocalHost && !isIpHost && typeof clerkProxyEnv === "string" && clerkProxyEnv.length > 0;
const clerkPubKey = useClerkProxy
  ? publishableKeyFromHost(
      window.location.hostname,
      import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    )
  : import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = useClerkProxy ? clerkProxyEnv : undefined;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiBaseUrl =
  import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_UR ?? null;

setBaseUrl(apiBaseUrl);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function stripBase(p: string) {
  return basePath && p.startsWith(basePath) ? p.slice(basePath.length) || "/" : p;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

/**
 * Registers a Clerk session token getter with the shared API client so
 * every customFetch call sends `Authorization: Bearer <token>`. Clerk
 * dev instances store the session in localStorage (not cookies), so we
 * must attach the token explicitly — credentials: "include" alone is
 * not sufficient.
 */
function ClerkTokenSync() {
  const { getToken } = useAuth();

  React.useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => {
      setAuthTokenGetter(null);
    };
  }, [getToken]);

  return null;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ProtectedRoute({
  component: Component,
}: {
  component: React.ComponentType<Record<string, never>>;
}) {
  if (import.meta.env.VITE_TEST_BYPASS_AUTH === "true") {
    return <Component />;
  }
  return (
    <>
      <Show when="signed-in">
        <AdminGate>
          <Component />
        </AdminGate>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkTokenSync />
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
            <Route path="/feedback">
              <Redirect to="/" />
            </Route>
            <Route path="/users" component={() => <ProtectedRoute component={Users} />} />
            <Route path="/audit" component={() => <ProtectedRoute component={AuditLog} />} />
            <Route path="/dev" component={() => <ProtectedRoute component={DevPage} />} />
            <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={NotFound} />
          </Switch>
          <Toaster richColors closeButton position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
