"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  FileText,
  LayoutDashboard,
  Menu,
  Settings,
  Shield,
  Users,
  Wallet,
  BarChart3,
  Scale,
  WifiOff,
  Wifi,
  Cloud,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/providers";
import { Button, cn } from "@/components/ui/primitives";
import { getDb } from "@/lib/db/database";

const NAV = [
  { href: "/", label: "لوحة التحكم", icon: LayoutDashboard },
  { href: "/transactions", label: "الحركات النقدية", icon: Banknote },
  { href: "/people", label: "الأشخاص", icon: Users },
  { href: "/invoices", label: "الفواتير", icon: FileText },
  { href: "/reconcile", label: "الجرد النقدي", icon: Scale },
  { href: "/reports", label: "التقارير", icon: BarChart3 },
  { href: "/backup", label: "النسخ الاحتياطي", icon: Shield },
  { href: "/settings", label: "الإعدادات", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { online, pendingUpdate, applyUpdate, settings, ready, syncStatus, triggerSync } = useApp();
  const [open, setOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => void getDb().outbox.count().then((count) => { if (live) setPendingCount(count); });
    load();
    window.addEventListener("egc:data-changed", load);
    const timer = window.setInterval(load, 5000);
    return () => { live = false; window.removeEventListener("egc:data-changed", load); window.clearInterval(timer); };
  }, []);

  return (
    <div className="app-safe-area min-h-dvh bg-cream text-ink">
      <aside className="app-sidebar fixed inset-y-0 right-0 z-30 hidden w-72 flex-col border-l border-forest-900/10 bg-forest-950 text-white lg:flex">
        <Brand />
        <nav className="flex-1 space-y-1 p-4">
          {NAV.map((item) => (
            <NavLink key={item.href} {...item} active={pathname === item.href} />
          ))}
        </nav>
        <p className="px-6 pb-6 text-xs text-white/50">حفظ محلي فوري — ومزامنة سحابية تلقائية.</p>
      </aside>

      {open ? (
        <div className="app-safe-overlay fixed inset-0 z-40 bg-forest-950/50 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="absolute inset-y-0 right-0 w-72 bg-forest-950 p-4 text-white" onClick={(e) => e.stopPropagation()}>
            <Brand />
            <nav className="mt-4 space-y-1">
              {NAV.map((item) => (
                <NavLink key={item.href} {...item} active={pathname === item.href} onClick={() => setOpen(false)} />
              ))}
            </nav>
          </aside>
        </div>
      ) : null}

      <div className="lg:pr-72">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-forest-900/10 bg-cream/90 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <Button variant="ghost" className="lg:hidden" onClick={() => setOpen(true)} aria-label="القائمة">
              <Menu />
            </Button>
            <div className="flex items-center gap-2 text-sm font-semibold">
              {online ? <Wifi className="h-4 w-4 text-forest-700" /> : <WifiOff className="h-4 w-4 text-warning" />}
              <span>{online ? "متصل" : "أوفلاين — الحفظ محلي"}</span>
            </div>

            {/* Cloud Auto-Sync Indicator */}
              <div className="flex items-center gap-2">
              <button
                onClick={() => { if (online) void triggerSync(); }}
                title="مزامنة سحابية مع قاعدة بيانات Vercel"
                className="flex items-center gap-1.5 rounded-xl border border-forest-900/10 bg-white/70 px-2.5 py-1 text-xs font-medium text-forest-900 hover:bg-white transition"
              >
                {syncStatus.state === "syncing" ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-lime-600" />
                    <span>مزامنة سحابية...</span>
                  </>
                ) : syncStatus.lastSyncTime ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-lime-500 animate-pulse" />
                    <span>سحابي متزامن ({syncStatus.lastSyncTime})</span>
                  </>
                ) : (
                  <>
                    <Cloud className="h-3.5 w-3.5 text-forest-700" />
                    <span>{syncStatus.state === "disabled" ? "المزامنة السحابية غير مفعّلة" : !online ? "أوفلاين" : syncStatus.state === "unavailable" ? syncStatus.errorMessage || "السيرفر غير متاح" : syncStatus.state === "error" ? syncStatus.errorMessage || "تعذرت المزامنة" : "مزامنة سحابية"}</span>
                  </>
                )}
                {pendingCount > 0 ? <span>({pendingCount} تعديلات معلّقة)</span> : null}
              </button>
              {online && (syncStatus.state === "error" || syncStatus.state === "unavailable") ? <Button variant="ghost" onClick={() => void triggerSync()} className="px-2">إعادة المحاولة</Button> : null}
              </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Wallet className="h-4 w-4" />
            {settings?.defaultCurrency ?? "ILS"}
          </div>
        </header>

        {pendingUpdate ? (
          <div className="flex items-center justify-between gap-3 bg-lime-400 px-4 py-3 text-forest-950">
            <p className="font-semibold">يتوفر تحديث للتطبيق. احفظ أي نموذج مفتوح ثم حدّث حتى لا تُفقد بيانات غير محفوظة.</p>
            <Button variant="primary" onClick={applyUpdate}>
              تحديث الآن
            </Button>
          </div>
        ) : null}

        <main className="mx-auto max-w-7xl px-4 py-6 animate-rise">{ready ? children : <Splash />}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-6">
      <img src="/logo.jpg" alt="Ever Green Agricultural Contractors" className="h-14 w-14 rounded-full bg-white object-cover" />
      <div>
        <p className="text-lg font-bold leading-tight">EverGreen CASH</p>
        <p className="text-xs text-lime-400">إدارة الصندوق</p>
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-2xl px-4 text-base font-semibold transition",
        active ? "bg-lime-500 text-forest-950" : "text-white/85 hover:bg-white/10",
      )}
    >
      <Icon className="h-5 w-5" />
      {label}
    </Link>
  );
}

function Splash() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <img src="/logo.jpg" alt="" className="h-28 w-28 rounded-full object-cover" />
      <p className="text-xl font-bold text-forest-900">جاري تجهيز بيانات الصندوق…</p>
    </div>
  );
}
