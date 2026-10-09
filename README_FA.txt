GFTSH 10 Wallet Observer — بسته اصلاح‌شده

محتویات:
- gftsh_10_wallet_observer.mjs: نسخه اصلاح‌شده Worker
- .github/workflows/gftsh_10_wallet_observer.yml: فایل فعال Workflow در مسیر استاندارد GitHub
- gftsh_10_wallet_observer.yml: کپی قابل مشاهده برای موبایل (برای مشاهده/کپی؛ فایل فعال همان نسخه داخل .github/workflows است)

اصلاح اصلی: قبل از پردازش کیف‌پول‌ها، ساختار state.wallets و alertedOpenPositionKeys اعتبارسنجی و در صورت نیاز مقداردهی اولیه می‌شود. شمارنده موفقیت کیف‌پول‌ها نیز فقط پس از پردازش موفق افزایش می‌یابد.

نام نمایشی Workflow همان «GFTSH 10 Wallet Observer» است. نام فایل Worker و Workflow حفظ شده است. زمان‌بندی اصلی همان cron: 2-59/10 * * * * (هر ۱۰ دقیقه، با offset دقیقه ۲) است.

نصب: Worker را در ریشه مخزن جایگزین کنید و Workflow را در مسیر .github/workflows/gftsh_10_wallet_observer.yml جایگزین کنید. Secrets/Variables فعلی محیط production را تغییر ندهید.
