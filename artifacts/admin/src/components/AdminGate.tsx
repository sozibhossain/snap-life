import React from "react";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";

import { getGetAdminMeQueryOptions } from "@workspace/api-client-react";

import { NotAuthorised } from "@/pages/not-authorised";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function errorStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function GateLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

function GateError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-muted/30 p-6"
      data-testid="admin-gate-error"
    >
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-background p-6 text-center shadow-sm">
        <h2 className="text-lg font-semibold">Couldn't verify access</h2>
        <p className="text-sm text-muted-foreground">
          We hit a problem talking to the server. This is usually temporary.
        </p>
        <Button onClick={onRetry} data-testid="admin-gate-retry">
          Try again
        </Button>
      </div>
    </div>
  );
}

export function AdminGate({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn } = useAuth();
  const [token, setToken] = React.useState<string | null>(null);

  // Fetch the Clerk session token as soon as the user is confirmed signed-in.
  // We do this once and store it in state so the query fires with a stable
  // Authorization header rather than relying on a module-level setter that
  // races with React Query's query scheduler.
  React.useEffect(() => {
    if (!isSignedIn) return;
    void getToken().then((t) => setToken(t));
  }, [isSignedIn, getToken]);

  const queryOptions = getGetAdminMeQueryOptions({
    request: token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined,
  });

  const { data, isLoading, error, refetch } = useQuery({
    ...queryOptions,
    enabled: token !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Show loading while we wait for the token or the query result.
  if (token === null || (isLoading && !data && !error)) {
    return <GateLoading />;
  }

  const status = errorStatus(error);

  if (status === 401 || status === 403) {
    return <NotAuthorised />;
  }

  if (error) {
    return <GateError onRetry={() => void refetch()} />;
  }

  if (!data?.isAdmin) {
    return <NotAuthorised />;
  }

  return <>{children}</>;
}

export default AdminGate;
