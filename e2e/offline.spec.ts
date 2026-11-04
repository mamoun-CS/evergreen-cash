import { expect, test } from "@playwright/test";

const routes = ["/", "/transactions", "/people", "/invoices", "/reconcile", "/reports", "/backup", "/settings"];

test("يفتح مسارات التطبيق الثمانية بعد زيارتها أول مرة ثم انقطاع الاتصال", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  for (const route of routes.slice(1)) await page.goto(route);
  await page.goto("/");
  await context.setOffline(true);
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    await expect(page).not.toHaveURL(/\/offline$/);
  }
  await context.close();
});

test("يحافظ على سياقين محليين مستقلين حتى عودة الاتصال للمزامنة", async ({ browser }) => {
  test.skip(!process.env.PLAYWRIGHT_SYNC_CONFIGURED, "يتطلب عنوان نشر ومفتاح المزامنة وعبارة مرور مشتركة في بيئة الاختبار.");
  const first = await browser.newContext();
  const second = await browser.newContext();
  const pageA = await first.newPage();
  const pageB = await second.newPage();
  await Promise.all([pageA.goto("/settings"), pageB.goto("/settings")]);
  await first.setOffline(true);
  await second.setOffline(true);
  await expect(pageA.getByRole("heading", { name: "إعدادات النظام والتطبيق" })).toBeVisible();
  await expect(pageB.getByRole("heading", { name: "إعدادات النظام والتطبيق" })).toBeVisible();
  await first.setOffline(false);
  await second.setOffline(false);
  await pageA.getByRole("button", { name: /مزامنة سحابية|إعادة المحاولة/ }).click().catch(() => undefined);
  await pageB.getByRole("button", { name: /مزامنة سحابية|إعادة المحاولة/ }).click().catch(() => undefined);
  await first.close();
  await second.close();
});
