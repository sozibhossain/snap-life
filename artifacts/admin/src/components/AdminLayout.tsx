import React from "react";
import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import {
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  Users,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  BarChart3,
} from "lucide-react";
import { PollingIndicator } from "./PollingIndicator";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Feedback now lives inside the Dashboard's tabbed surface, so the sidebar
// only exposes the two top-level pages.
const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/users", label: "Users", icon: Users },
  { path: "/community-insights", label: "Community Insights", icon: BarChart3 },
  { path: "/audit", label: "Audit Log", icon: ClipboardList },
  { path: "/dev", label: "Dev & Testing", icon: FlaskConical },
  { path: "/settings", label: "Settings", icon: Settings },
];

/**
 * The sidebar body — shared between the always-visible desktop `<aside>`
 * and the mobile slide-in drawer (`<Sheet>`), so navigation, the user
 * chip, and Sign Out stay identical on every screen size. `onNavigate`
 * lets the mobile drawer close itself after a link is tapped.
 */
function SidebarBody({
  currentPath,
  onNavigate,
}: {
  currentPath: string;
  onNavigate?: () => void;
}) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [signOutOpen, setSignOutOpen] = React.useState(false);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border/50 shrink-0">
        <img
          src={`${basePath}/logo-icon.png`}
          alt="SNAP Life Logo"
          className="h-8 w-8 rounded-md object-cover mr-3"
        />
        <span className="font-semibold text-lg tracking-tight">Admin</span>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              currentPath === item.path
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <item.icon className="h-4 w-4" aria-hidden={true} />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-sidebar-border/50 shrink-0">
        <div className="flex items-center gap-3 px-3 py-2 mb-2 text-sm text-sidebar-foreground/80">
          {user?.hasImage && user.imageUrl ? (
            <img
              src={user.imageUrl}
              alt=""
              className="w-8 h-8 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground shrink-0">
              {user?.primaryEmailAddress?.emailAddress
                ?.charAt(0)
                .toUpperCase() || "A"}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {user?.fullName || user?.primaryEmailAddress?.emailAddress}
            </p>
            <p className="truncate text-[11px] text-sidebar-foreground/60">
              Administrator
            </p>
          </div>
        </div>
        <button
          onClick={() => setSignOutOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign Out
        </button>
      </div>

      <AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll need to sign in again to get back into the SNAP Life
              admin cockpit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, stay</AlertDialogCancel>
            <AlertDialogAction onClick={() => signOut()}>
              Yes, sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Compact profile chip for the top header: avatar (Clerk image or initial),
 * name, and role. Everyone who reaches this layout is past <AdminGate>, so
 * the role is always "Administrator".
 */
function HeaderUser() {
  const { user } = useUser();
  const name =
    user?.fullName || user?.primaryEmailAddress?.emailAddress || "Admin";

  return (
    <div className="flex items-center gap-2.5">
      <div className="hidden sm:flex flex-col items-end leading-tight">
        <span className="text-sm font-medium text-foreground truncate max-w-[180px]">
          {name}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          Administrator
        </span>
      </div>
      {user?.hasImage && user.imageUrl ? (
        <img
          src={user.imageUrl}
          alt=""
          className="h-9 w-9 rounded-full object-cover border border-border shrink-0"
        />
      ) : (
        <div className="h-9 w-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold shrink-0">
          {name.charAt(0).toUpperCase() || "A"}
        </div>
      )}
    </div>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const stripBase = (p: string) => {
    return basePath && p.startsWith(basePath)
      ? p.slice(basePath.length) || "/"
      : p;
  };
  const currentPath = stripBase(location);

  return (
    <div className="h-screen bg-background flex w-full overflow-hidden">
      {/* Desktop sidebar — hidden below md, where the drawer takes over. */}
      <aside className="w-64 border-r bg-sidebar text-sidebar-foreground hidden md:flex shrink-0">
        <SidebarBody currentPath={currentPath} />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 flex items-center justify-between px-4 md:px-8 border-b bg-card shrink-0">
          {/* Mobile: hamburger + logo. Hidden on md+ where the sidebar shows. */}
          <div className="flex items-center gap-2 md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Open navigation menu"
                  className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-64 max-w-[80%] bg-sidebar text-sidebar-foreground border-sidebar-border/50 p-0"
              >
                {/* Radix Dialog requires a title for screen readers. */}
                <SheetTitle className="sr-only">Navigation menu</SheetTitle>
                <SidebarBody
                  currentPath={currentPath}
                  onNavigate={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <img
              src={`${basePath}/logo-icon.png`}
              alt="SNAP Life Logo"
              className="h-8 w-8 rounded-md object-cover"
            />
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3 sm:gap-4">
            <PollingIndicator />
            <div className="h-8 w-px bg-border hidden sm:block" />
            <HeaderUser />
          </div>
        </header>

        <div className="flex-1 overflow-auto bg-muted/30">
          <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
