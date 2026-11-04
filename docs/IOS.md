# تطبيق EverGreen CASH على iOS

## المتطلبات

- جهاز Mac مدعوم عليه Xcode حديث، وNode.js مطابق لإصدار المشروع، وCocoaPods عند طلبه من Xcode.
- حساب Apple Developer للتوقيع والتوزيع على TestFlight.
- لا يحتاج تشغيل التطبيق إلى خادم ويب. ملفات Next.js المصدّرة تُضمّن محلياً داخل التطبيق.

## بناء التطبيق وتشغيله على iPad أو iPhone

من مجلد المشروع على Mac:

```bash
npm ci
npm run build:native
npm run cap:sync
npm run cap:open
```

يفعّل `build:native` static export لـ Next.js، يستبعد Route Handlers الخاصة بالويب مؤقتاً، ويوقف إعدادات `instant` المتعارضة مع تعطيل Cache Components. يعيد السكربت الملفات وإعداد TypeScript إلى حالتها الأصلية بعد البناء. ينتج البناء مجلد `out/`؛ ثم ينسخه Capacitor إلى مشروع iOS.

في Xcode اختر هدف **App** وجهاز iPad أو iPhone، واضبط **Signing & Capabilities → Team**، ثم شغّل التطبيق. يدعم المشروع الاتجاهين الأفقي والعمودي على iPad. عند تغيير ملفات الويب أعد `build:native` ثم `cap:sync` قبل تشغيل التطبيق مجدداً.

لتجديد الأيقونة وشاشة البداية بعد تغيير الصور المصدر:

```bash
npx @capacitor/assets generate --ios --iconBackgroundColor "#0f3d2e" --splashBackgroundColor "#0f3d2e"
npm run cap:sync
```

مدخلات الأيقونة والشعار محفوظة في `assets/`، ومأخوذة من `public/icon-512.png` و`public/logo.jpg`.

## التوزيع عبر TestFlight

1. افتح المشروع في Xcode على Mac، واختر Team وBundle Identifier `com.evergreen.cash`.
2. ارفع رقم الإصدار ورقم البناء عند كل إصدار جديد.
3. اختر **Any iOS Device (arm64)** ثم **Product → Archive**.
4. من Organizer اختر **Distribute App → App Store Connect → Upload**.
5. بعد اكتمال المعالجة في App Store Connect، أضف مجموعة مختبرين داخل TestFlight وشارك دعوة الاختبار.

## تفعيل المزامنة اختيارياً

التطبيق الأصلي لا يرسل طلبات شبكة للمزامنة عندما لا يكون عنوان API مضبوطاً. لتفعيلها، حدّد `NEXT_PUBLIC_API_BASE_URL` عند تنفيذ `build:native`، مثلاً عنوان نشر HTTPS الذي يستضيف API الويب، ثم أعد البناء والمزامنة. هذا العنوان ليس مفتاحاً سرياً. يجب أن يضبط الخادم `SYNC_API_KEY` ورابط قاعدة البيانات، وأن يُدخل المستخدم بيانات المزامنة وعبارة المرور في التطبيق. تسمح Route Handlers بأصل `capacitor://localhost` وبـ `http://localhost` للتطوير.

لا تضع مفاتيح أو كلمات مرور في `capacitor.config.ts` أو ملفات الواجهة. إذا لم تضبط عنوان API، تبقى البيانات محلية ويظهر تنبيه تصدير ملف `.egc` دورياً من شاشة النسخ الاحتياطي.

## تجربة أوفلاين يدوية

1. ثبّت التطبيق على iPad وافتحه مرة مع الإنترنت لإتمام أول تشغيل، ثم فعّل وضع الطيران.
2. افتح لوحة التحكم، الحركات، الأشخاص، الفواتير، المطابقة، التقارير، النسخ الاحتياطي، والإعدادات.
3. أضف حركة نقدية وفاتورة، أغلق التطبيق بالكامل، ثم افتحه مجدداً وتأكد من بقاء البيانات.
4. أنشئ PDF وCSV ونسخة `.egc`؛ يجب أن تعرض المشاركة ورقة مشاركة iOS.
5. استعد ملف `.egc` من تطبيق Files وتحقق من ظهور معاينة النسخة قبل التأكيد.
6. أوقف وضع الطيران، وإذا فعّلت عنوان API فتحقق من عودة حالة المزامنة.

## ما تم التحقق منه وما بقي

- تم بناء static export محلياً، وتوليد مشروع iOS عبر `npx cap add ios`، وإنشاء الأيقونة وشاشة البداية، ونجح `npx cap sync ios`.
- هذا التحقق تم على Windows؛ لم يتوفر Xcode أو iOS Simulator هنا، لذلك لم يُنفذ بناء Xcode أو اختبار جهاز فعلي أو رفع TestFlight. يلزم إجراء خطوات Xcode وتجربة الأوفلاين أعلاه على Mac/iPad قبل اعتبارها معتمدة.
- لم تُحذف ملفات Cairo المكررة. `public/fonts/Cairo-Regular.ttf` مطابق بايتياً لثلاثة ملفات تحت `src/lib/pdf/fonts/` باسم Regular وBold وVariable؛ أما `public/fonts/Cairo-Bold.ttf` فمختلف. توجد أيضاً ملفات WOFF ضمن حزمة `@fontsource/cairo` لتنسيق واجهة الويب.
