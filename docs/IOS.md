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

تم تجهيز Workflow باسم `ios-testflight` في `codemagic.yaml` للبناء على عامل macOS في Codemagic. يستخدم Xcode الأحدث المتاح، ويمر عبر `npm ci` ثم بناء الويب والتحويل الثابت الخاص بالتطبيق ثم `npx cap sync ios`، ويخرج IPA موقّعاً ويرفعه إلى App Store Connect. رقم البناء يُضبط من عدّاد مشروع Codemagic.

### الإعداد المطلوب مرة واحدة في حسابات Apple وCodemagic

1. يلزم اشتراك Apple Developer Program فعّال، وصلاحية مدير الفريق في Codemagic لإعداد التكامل وملفات التوقيع.
2. في App Store Connect افتح **Users and Access → Integrations → App Store Connect API**، وأنشئ API Key مخصصاً لـ Codemagic بصلاحية **App Manager**. نزّل ملف `.p8` واحفظه بمكان آمن؛ لا تضعه في GitHub أو المشروع ولا ترسله في المحادثة.
3. في Codemagic افتح **Team settings → Team integrations → Developer Portal**، وأضف المفتاح باستخدام Issuer ID وKey ID وملف `.p8`. اسم التكامل في YAML حالياً `AppStoreConnect`؛ يجب أن يكون اسم المفتاح نفسه في Codemagic، أو غيّر قيمة `integrations.app_store_connect` لتطابق الاسم الذي حفظته هناك.
4. تأكد أن App ID مسجل ومفعّل في Apple Developer بحزمة `com.evergreen.cash`. ينشئ Workflow شهادة **Apple Distribution** وملف **App Store provisioning profile** أو يجلبهما من Apple تلقائياً. لتفويض إنشاء الشهادة، أنشئ مفتاح RSA خاصاً على جهازك (مثلاً من Git Bash في مجلد خارج المشروع باستخدام `openssl genrsa -traditional -out evergreen-ios-distribution.key 2048`). في Codemagic أضف متغير البيئة `CERTIFICATE_PRIVATE_KEY` ضمن مجموعة `ios_signing_credentials`، واجعل قيمته محتوى ملف المفتاح كاملاً وحدده كـ **Secret**. لا ترفع الملف أو محتواه إلى GitHub ولا ترسله في المحادثة. لا يحتاج هذا المسار إلى رفع ملف `.p12` أو ملف provisioning يدوياً إلى المستودع.
5. أضف التطبيق في App Store Connect إذا لم يكن موجوداً، وأكمل بياناته الأساسية. اختياريّاً، أضف رقم Apple ID الرقمي للتطبيق كمتغير بيئة `APP_STORE_APPLE_ID` في إعدادات تطبيق Codemagic (ليس سراً) ليقرأ Workflow آخر رقم بناء مرفوع ويختار رقماً أعلى؛ بدونه يستخدم عدّاد Codemagic. أول رفع يجب أن يتوافق مع إصدار التطبيق `1.0`.
6. ارفع `codemagic.yaml` إلى GitHub، أضف المستودع إلى Codemagic، واختر Workflow `ios-testflight` وشغّله. لا حاجة إلى Mac محلي. بعد المعالجة، وزّع النسخة من TestFlight على المختبرين.

يستخدم Workflow أمر `app-store-connect fetch-signing-files` مع `--create` ليجلب أو ينشئ ملفات التوقيع من Apple عند البناء، ثم يطبقها على هدف Xcode. هذا يتجاوز البحث عن ملف محفوظ مسبقاً في Codemagic الذي كان سبب رسالة `No matching profiles found`. إذا استمرت الرسالة، تحقق أن التكامل يملك وصول Developer Portal، وأن App ID مسجل، وأن `CERTIFICATE_PRIVATE_KEY` Secret موجود في مجموعة `ios_signing_credentials`.

لا تُضف مفاتيح API أو ملفات `.p8` أو شهادات `.p12` أو كلمات مرور إلى المستودع. إعدادات المزامنة الخاصة بالخادم، إن استُخدمت، تُعرّف كمتغيرات بيئة في Codemagic؛ `NEXT_PUBLIC_API_BASE_URL` عنوان عام فقط، أما المفاتيح فتبقى أسراراً ولا تُضمّن في بناء العميل.

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
- تم إعداد Codemagic لبناء المشروع على macOS، لكن لم يُنفذ بناء Xcode أو IPA فعلي من هذه البيئة؛ لا يتوفر Xcode على Windows. يلزم إعداد حساب Apple وCodemagic أعلاه وتشغيل Workflow حتى يمكن تأكيد نجاح توقيع IPA ورفعه إلى TestFlight.
- لم يُحذف أو يُعطّل أي مسار Offline Storage أو Dexie أو PDF أو Backup/Restore ضمن إعدادات البناء. بناء الويب الاعتيادي يسبق بناء التصدير الأصلي في Workflow.
- لم تُحذف ملفات Cairo المكررة. `public/fonts/Cairo-Regular.ttf` مطابق بايتياً لثلاثة ملفات تحت `src/lib/pdf/fonts/` باسم Regular وBold وVariable؛ أما `public/fonts/Cairo-Bold.ttf` فمختلف. توجد أيضاً ملفات WOFF ضمن حزمة `@fontsource/cairo` لتنسيق واجهة الويب.
