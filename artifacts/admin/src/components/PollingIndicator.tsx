import React from "react";
import { useIsFetching } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export function PollingIndicator({ className }: { className?: string }) {
  const isFetching = useIsFetching();

  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <div className="relative flex h-2 w-2">
        {isFetching > 0 && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
        )}
        <span className={cn("relative inline-flex rounded-full h-2 w-2", isFetching > 0 ? "bg-primary" : "bg-muted-foreground/30")}></span>
      </div>
      {isFetching > 0 ? "Syncing..." : "Live"}
    </div>
  );
}
