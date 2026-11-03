"use client";

import { useEffect, useState } from "react";
import { formatMinorGrouped } from "@/lib/money";
import { formatDateAr } from "@/lib/time";
import { getCurrency } from "@/lib/currencies";
import { dashboardSummary } from "@/lib/services/financeService";
import { Card, Button, EmptyState } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  ShieldCheck,
  ShieldAlert,
  PlusCircle,
  FileText,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type FilterPeriod = "today" | "week" | "month" | "all";
type DashboardData = Awaited<ReturnType<typeof dashboardSummary>>;

export function DashboardScreen() {
  const { bump } = useApp();
  const [period, setPeriod] = useState<FilterPeriod>("month");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const now = new Date();
      let fromIso: string | undefined;

      if (period === "today") {
        fromIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      } else if (period === "week") {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        fromIso = d.toISOString();
      } else if (period === "month") {
        fromIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      }

      try {
        const summary = await dashboardSummary(fromIso);
        if (!cancelled) {
          setData(summary);
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [period, bump]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-lg font-bold text-forest-900">جاري تحميل بيانات لوحة التحكم...</p>
      </div>
    );
  }

  const currency = getCurrency(data?.currency || "ILS");
  const exp = currency.exponent;

  // Prepare chart data from recent transactions
  const chartData = (data?.transactions || [])
    .slice()
    .reverse()
    .map((tx) => ({
      date: formatDateAr(tx.occurredAt).slice(5),
      amount: Number(tx.amountMinor) / (10 ** exp),
      type: tx.type,
    }));

  return (
    <div className="space-y-6">
      {/* Top Banner / Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-forest-900 sm:text-3xl">لوحة التحكم المالية</h1>
          <p className="text-sm text-muted">صندوق مقاولات إيفر غرين — نظرة شاملة وفورية</p>
        </div>

        {/* Quick Date Filters */}
        <div className="flex items-center gap-1 rounded-2xl bg-white p-1 border border-forest-900/10 shadow-sm">
          {(
            [
              { id: "today", label: "اليوم" },
              { id: "week", label: "أسبوع" },
              { id: "month", label: "الشهر" },
              { id: "all", label: "الكل" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => setPeriod(item.id)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                period === item.id
                  ? "bg-forest-900 text-white"
                  : "text-forest-900 hover:bg-forest-900/5"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Cash Balance */}
        <Card className="bg-forest-950 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white/70">الرصيد النقدي الحالي</span>
            <div className="rounded-xl bg-forest-900 p-2.5 text-lime-400">
              <Wallet className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-3xl font-extrabold tracking-tight text-lime-400">
              {currency.symbol} {formatMinorGrouped(data?.cash ?? 0n, exp)}
            </p>
            <p className="mt-1 text-xs text-lime-300/80">حقيقي ومطابق للسجل المالي</p>
          </div>
        </Card>

        {/* Period Income */}
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted">مقبوضات الفترة</span>
            <div className="rounded-xl bg-forest-50 p-2.5 text-forest-700">
              <TrendingUp className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold text-forest-900">
              {currency.symbol} {formatMinorGrouped(data?.incomeRange ?? 0n, exp)}
            </p>
            <p className="mt-1 text-xs text-muted">إجمالي المقبوضات: {formatMinorGrouped(data?.incomeAll ?? 0n, exp)}</p>
          </div>
        </Card>

        {/* Period Expenses */}
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted">مصروفات الفترة</span>
            <div className="rounded-xl bg-red-50 p-2.5 text-danger">
              <TrendingDown className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold text-forest-900">
              {currency.symbol} {formatMinorGrouped(data?.expenseRange ?? 0n, exp)}
            </p>
            <p className="mt-1 text-xs text-muted">إجمالي المصروفات: {formatMinorGrouped(data?.expenseAll ?? 0n, exp)}</p>
          </div>
        </Card>

        {/* Outstanding Advances */}
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted">سلف معلقة في الذمة</span>
            <div className="rounded-xl bg-amber-50 p-2.5 text-warning">
              <UserCheck className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold text-warning">
              {currency.symbol} {formatMinorGrouped(data?.outstanding ?? 0n, exp)}
            </p>
            <p className="mt-1 text-xs text-muted">لم يتم تسويتها أو استردادها بعد</p>
          </div>
        </Card>
      </div>

      {/* Backup Status Alert */}
      {data?.dirtySince ? (
        <div className="flex items-center justify-between rounded-3xl bg-amber-500/10 border border-amber-500/20 p-4 text-amber-900">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-amber-600 shrink-0" />
            <div>
              <p className="font-bold text-sm">توجد تعديلات محلية غير منسوخة احتياطياً</p>
              <p className="text-xs text-amber-800">
                آخر نسخة احتياطية ناجحة: {data.lastBackupAt ? formatDateAr(data.lastBackupAt) : "لم يتم النسخ بعد"}
              </p>
            </div>
          </div>
          <Link href="/backup">
            <Button variant="secondary" className="text-xs py-2 px-3">
              نسخ الآن
            </Button>
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-3xl bg-forest-900/5 border border-forest-900/10 p-3 text-xs text-forest-900">
          <ShieldCheck className="h-5 w-5 text-forest-700 shrink-0" />
          <span>البيانات مؤمنة ومطابقة لآخر نسخة احتياطية مشفرة.</span>
        </div>
      )}

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link href="/transactions?new=income" className="w-full">
          <Button variant="primary" className="w-full py-4 text-sm font-bold shadow-md">
            <PlusCircle className="h-5 w-5 ml-1 text-lime-400" />
            قبض نقدي
          </Button>
        </Link>
        <Link href="/transactions?new=expense" className="w-full">
          <Button variant="secondary" className="w-full py-4 text-sm font-bold shadow-sm">
            <TrendingDown className="h-5 w-5 ml-1 text-danger" />
            صرف نقدي
          </Button>
        </Link>
        <Link href="/transactions?new=advance" className="w-full">
          <Button variant="secondary" className="w-full py-4 text-sm font-bold shadow-sm">
            <UserCheck className="h-5 w-5 ml-1 text-warning" />
            سلفة شخصية/مشتريات
          </Button>
        </Link>
        <Link href="/invoices?new=1" className="w-full">
          <Button variant="lime" className="w-full py-4 text-sm font-bold shadow-sm">
            <FileText className="h-5 w-5 ml-1" />
            فاتورة جديدة
          </Button>
        </Link>
      </div>

      {/* Financial Activity Chart & Recent Transactions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Chart Column */}
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-forest-900">نشاط الحركة النقدية</h2>
            <span className="text-xs text-muted">آخر الحركات المسجلة</span>
          </div>
          {chartData.length > 1 ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCash" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#14532d" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="#14532d" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#5c6b62" }} />
                  <YAxis tick={{ fontSize: 12, fill: "#5c6b62" }} />
                  <Tooltip
                    formatter={(val) => [`${currency.symbol} ${String(val)}`, "المبلغ"]}
                    contentStyle={{ borderRadius: "16px", direction: "rtl", border: "1px solid #ddd" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#14532d"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorCash)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-muted">
              سجل المزيد من الحركات لعرض المخطط البياني التفاعلي
            </div>
          )}
        </Card>

        {/* Recent Invoices Column */}
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-forest-900">أحدث الفواتير</h2>
            <Link href="/invoices" className="text-xs font-semibold text-forest-700 hover:underline">
              عرض الكل
            </Link>
          </div>
          <div className="space-y-3">
            {(data?.invoices || []).length > 0 ? (
              (data?.invoices || []).map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-2xl bg-cream/50 p-3 border border-forest-900/5 text-sm"
                >
                  <div>
                    <p className="font-bold text-forest-900">{inv.customerName}</p>
                    <p className="text-xs text-muted">{inv.invoiceNumber} • {formatDateAr(inv.issuedAt)}</p>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-forest-900">
                      {currency.symbol} {formatMinorGrouped(BigInt(inv.grandTotalMinor), exp)}
                    </p>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        inv.paymentStatus === "paid"
                          ? "bg-forest-100 text-forest-800"
                          : inv.paymentStatus === "partial"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-danger"
                      }`}
                    >
                      {inv.paymentStatus === "paid" ? "مدفوعة" : inv.paymentStatus === "partial" ? "جزئي" : "غير مدفوعة"}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-sm text-muted">لا توجد فواتير حديثة</p>
            )}
          </div>
        </Card>
      </div>

      {/* Recent Transactions List */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-forest-900">آخر الحركات النقدية</h2>
          <Link href="/transactions" className="text-xs font-semibold text-forest-700 hover:underline">
            عرض جميع الحركات
          </Link>
        </div>
        {(data?.transactions || []).length > 0 ? (
          <div className="divide-y divide-forest-900/10">
            {(data?.transactions || []).map((tx) => {
              const isIncome = tx.type === "income" || tx.type === "advance_refund";
              const isExpense = tx.type === "expense" || tx.type === "advance_given";
              return (
                <div key={tx.id} className="flex items-center justify-between py-3.5">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                        isIncome
                          ? "bg-forest-100 text-forest-800"
                          : isExpense
                          ? "bg-red-50 text-danger"
                          : "bg-amber-50 text-warning"
                      }`}
                    >
                      {isIncome ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="font-bold text-forest-900">{tx.description}</p>
                      <p className="text-xs text-muted">
                        {tx.referenceNumber} • {formatDateAr(tx.occurredAt)}
                        {tx.category ? ` • ${tx.category}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="text-left">
                    <p
                      className={`font-bold text-base ${
                        isIncome ? "text-forest-800" : isExpense ? "text-danger" : "text-forest-900"
                      }`}
                    >
                      {isIncome ? "+" : isExpense ? "-" : ""}
                      {currency.symbol} {formatMinorGrouped(BigInt(tx.amountMinor), exp)}
                    </p>
                    <span className="text-xs text-muted">{tx.status === "reversed" ? "معكوسة" : "معتمدة"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="لا توجد حركات مسجلة" hint="سجل قبضاً أو صرفاً نقدياً للبدء في تشغيل الصندوق." />
        )}
      </Card>
    </div>
  );
}
