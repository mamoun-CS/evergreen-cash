export default function OfflinePage() {
  return (
    <main dir="rtl" className="flex min-h-dvh items-center justify-center bg-cream p-6 text-center text-forest-950">
      <section className="max-w-md rounded-3xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold">أنت غير متصل بالإنترنت</h1>
        <p className="mt-3 text-muted">افتح التطبيق بعد عودة الاتصال لتحميل الصفحة المطلوبة، وستبقى بياناتك المحلية محفوظة.</p>
      </section>
    </main>
  );
}
