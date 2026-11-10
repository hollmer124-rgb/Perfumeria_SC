import { useState } from "react";
import { Gem, Menu } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { appConfig } from "@/lib/app-config";
import { useActivePageTitle } from "@/hooks/use-active-page-title";
import { navigationGroups } from "@/features/navigation/navigation-items";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-xl border border-gold/25 bg-gold-soft text-gold">
        <Gem aria-hidden="true" size={19} strokeWidth={1.6} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-serif text-[1.04rem] font-semibold tracking-wide text-foreground">
          {appConfig.name}
        </span>
        <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Administración
        </span>
      </span>
    </div>
  );
}

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Navegación principal" className="space-y-6">
      {navigationGroups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {group.label}
          </h2>
          <ul className="space-y-1">
            {group.items.map(({ path, title, icon: Icon }) => (
              <li key={path}>
                <NavLink
                  to={path}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `group flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                      isActive
                        ? "bg-gold-soft text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        aria-hidden="true"
                        size={17}
                        strokeWidth={isActive ? 1.9 : 1.7}
                        className={
                          isActive
                            ? "text-gold"
                            : "text-muted-foreground group-hover:text-foreground"
                        }
                      />
                      <span>{title}</span>
                      {isActive ? (
                        <span
                          aria-hidden="true"
                          className="ml-auto size-1.5 rounded-full bg-gold"
                        />
                      ) : null}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-border bg-card lg:flex">
      <div className="flex h-[76px] items-center border-b border-border px-6">
        <Brand />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <NavigationLinks />
      </div>
      <div className="border-t border-border px-6 py-4">
        <p className="text-[11px] leading-5 text-muted-foreground">
          Interfaz inicial. Los módulos se habilitarán por fases.
        </p>
      </div>
    </aside>
  );
}

function MobileNavigation() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="border-transparent bg-transparent"
          aria-label="Abrir navegación"
        >
          <Menu aria-hidden="true" size={19} />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="left-0 top-0 h-dvh w-[min(21rem,calc(100vw-1rem))] max-w-none translate-x-0 translate-y-0 gap-0 rounded-none rounded-r-2xl p-0"
        aria-describedby="mobile-navigation-description"
      >
        <DialogHeader className="border-b border-border px-5 py-5">
          <DialogTitle>
            <Brand />
          </DialogTitle>
          <DialogDescription id="mobile-navigation-description">
            Navegación principal
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto px-4 py-6">
          <NavigationLinks onNavigate={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AppShell() {
  const pageTitle = useActivePageTitle();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />
      <div className="min-h-screen lg:pl-[264px]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur sm:px-7 lg:h-[76px] lg:px-10">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <div className="lg:hidden">
              <MobileNavigation />
            </div>
            <span className="truncate text-sm font-semibold tracking-tight">
              {pageTitle}
            </span>
            <span className="hidden h-4 w-px bg-border sm:block" />
            <span className="hidden text-xs text-muted-foreground sm:block">
              Panel de administración
            </span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-gold/20 bg-gold-soft px-2.5 py-1.5 text-[10px] font-medium text-foreground sm:px-3 sm:text-[11px]">
            <span className="size-1.5 rounded-full bg-gold" />
            Vista inicial
          </span>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-7 sm:px-7 sm:py-9 lg:px-10 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
