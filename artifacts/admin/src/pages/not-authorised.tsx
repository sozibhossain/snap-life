import React from "react";
import { useClerk } from "@clerk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert, LogOut } from "lucide-react";

export function NotAuthorised() {
  const { signOut } = useClerk();

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            Not authorised
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Your account doesn&rsquo;t have admin access to the SNAP Life
            cockpit. If you think this is a mistake, contact a SNAP Life
            administrator.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="outline" className="flex-1">
              <a href="/">Back to SNAP Life</a>
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => signOut()}
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default NotAuthorised;
