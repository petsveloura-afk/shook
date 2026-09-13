# 🛍️ פשפשוק — בוט מרקטפלייס לטלגרם (Yad2 Style)

בוט מודעות יד-שנייה מלא בעברית: אשף פרסום מודעות, ערוץ מכירות אוטומטי, מערכת אישור מודעות למנהלים, חיפוש וסינון, מועדפים, דירוג מוכרים ופאנל ניהול.

**Stack:** Node.js + Telegraf 4 + Supabase (PostgreSQL) · **עלות:** 0 ₪ · **ללא כרטיס אשראי** · **24/7**

---

## 📁 מבנה הפרויקט

```
pashpashuk/
├── api/
│   └── webhook.js              # Vercel Serverless — נקודת הקצה של טלגרם
├── scripts/
│   ├── setWebhook.js           # ניהול Webhook מהטרמינל
│   └── seed.js                 # בדיקת DB + זריעת קטגוריות
├── src/
│   ├── config/env.js           # טעינה וולידציה של משתני סביבה
│   ├── db/
│   │   ├── schema.sql          # כל טבלאות ה-PostgreSQL
│   │   └── supabase.js         # שכבת גישה לנתונים
│   ├── bot/
│   │   ├── index.js            # הרכבת הבוט, סשן ב-DB, ראוטרים
│   │   ├── keyboards.js        # כל המקלדות בעברית
│   │   ├── formatters.js       # עיצוב פוסטים וכרטיסים (HTML)
│   │   ├── publish.js          # פרסום/הקפצה/סימון נמכר בערוץ
│   │   ├── fsm/createAd.js     # אשף יצירת המודעה (FSM)
│   │   └── handlers/
│   │       ├── user.js         # תפריט, חיפוש, מועדפים, אזור אישי
│   │       └── admin.js        # מודרציה, שידור, קטגוריות, מטריקות
│   └── index.js                # ריצה מתמדת (Polling) + Health server
├── Dockerfile                  # Hugging Face Spaces / Railway
├── vercel.json                 # קונפיגורציית Vercel
└── .env.example
```

---

## 1️⃣ יצירת הבוט והערוצים (3 דקות)

1. **בוט:** פתח שיחה עם [@BotFather](https://t.me/BotFather) → `/newbot` → שמור את ה-**BOT_TOKEN** ואת שם המשתמש.
2. **ערוץ מכירות:** צור ערוץ חדש (ציבורי מומלץ) → הוסף את הבוט כ**אדמין** עם הרשאות *Post Messages*, *Edit Messages*, *Delete Messages*.
3. **קבוצת מנהלים:** צור קבוצה פרטית → הוסף את הבוט → כתוב בקבוצה `/id` וקבל את ה-**ADMIN_GROUP_ID** (מתחיל ב-`-100`).
4. **המזהה שלך:** בפרטי עם הבוט כתוב `/id` → זה ה-**ADMIN_IDS** שלך.
5. **מזהה הערוץ:** העבר (Forward) הודעה מהערוץ לבוט או השתמש ב-`@username` של הערוץ בתור **CHANNEL_ID**.

> 💡 אם הבוט עדיין לא מורם, אפשר לקבל את מזהה הערוץ גם דרך [@getidsbot](https://t.me/getidsbot).

---

## 2️⃣ הקמת מסד הנתונים ב-Supabase (2 דקות)

1. היכנס ל-[supabase.com](https://supabase.com) → **New Project** (Free tier, ללא כרטיס אשראי).
2. לאחר שהפרויקט עולה: **SQL Editor** → **New query** → הדבק את כל התוכן של `src/db/schema.sql` → **Run**.
3. ודא שנוצרו 7 טבלאות ו-12 קטגוריות:
   ```sql
   select count(*) from public.categories;  -- 12
   ```
4. **Project Settings → API** → העתק:
   - `Project URL` → **SUPABASE_URL**
   - `service_role` secret → **SUPABASE_SERVICE_ROLE_KEY**

> ⚠️ חובה `service_role` (ולא `anon`) — הטבלאות מוגנות ב-RLS והבוט צריך לעקוף אותו.

---

## 3️⃣ אפשרות A — פריסה ל-Vercel (Webhook, 3 דקות)

הדרך המומלצת: תגובה מיידית, אפס downtime, אפס עלות, ללא צורך ב-keepalive.

1. העלה את הפרויקט ל-GitHub:
   ```bash
   git init && git add . && git commit -m "Pashpashuk bot"
   git branch -M main
   git remote add origin https://github.com/USER/pashpashuk.git
   git push -u origin main
   ```
2. [vercel.com](https://vercel.com) → **Add New → Project** → Import מה-GitHub → **Deploy**.
3. **Settings → Environment Variables** → הוסף את כל המשתנים מ-`.env.example`:
   - `MODE=webhook`
   - `PUBLIC_URL=https://<הפרויקט-שלך>.vercel.app`
   - `WEBHOOK_SECRET` = מחרוזת אקראית ארוכה שתמציא
4. **Deployments → Redeploy** (כדי שהמשתנים ייטענו).
5. רשום את ה-Webhook בטלגרם — פתח בדפדפן:
   ```
   https://<הפרויקט-שלך>.vercel.app/api/webhook?action=set&secret=<WEBHOOK_SECRET>
   ```
   תשובה `{"ok":true,"action":"set"...}` = הבוט חי. ✅
6. בדיקה: `/api/webhook?action=info&secret=...` מציג את מצב ה-Webhook (ו-`pending_update_count`).

---

## 4️⃣ אפשרות B — Hugging Face Spaces (Polling 24/7, חינם לגמרי)

מתאים אם אתה מעדיף תהליך מתמיד (Long Polling) ללא דומיין.

1. [huggingface.co/new-space](https://huggingface.co/new-space) → SDK: **Docker** → Blank → Private.
2. העלה את כל קבצי הפרויקט (כולל `Dockerfile`) ל-Space.
3. **Settings → Variables and secrets** → הוסף כ-**Secrets** את כל משתני הסביבה, עם:
   - `MODE=polling`
   - `PORT=7860`
4. ה-Space יבנה ויעלה אוטומטית. ב-Logs תראה:
   `[server] @YourBot is live | HTTP port 7860 | mode: polling`
5. **חשוב:** אם קודם הגדרת Webhook, מחק אותו (`npm run delete-webhook`) — אחרת Polling לא יקבל עדכונים.

> 🔄 Spaces חינמי עשוי להיכנס לשינה (sleep). הוסף ב-[cron-job.org](https://cron-job.org) בדיקה כל 5 דקות לכתובת ה-Space (`/health`) כדי לשמור אותו ער.

### הרצה מקומית / Railway
```bash
cp .env.example .env     # ומלא את הערכים
npm install
npm run seed             # בדיקת חיבור ל-DB
npm start
```

---

## 5️⃣ בדיקת תקינות (Smoke Test)

| שלב | פעולה | תוצאה מצופה |
|---|---|---|
| 1 | `/start` בפרטי | הודעת פתיחה + תפריט 6 כפתורים |
| 2 | `➕ פרסום מודעה חדשה` | אשף: קטגוריה → שם → תיאור → מצב → מחיר → אזור → תמונות → תצוגה מקדימה |
| 3 | אישור המודעה | הודעה "ממתינה לאישור" + כרטיס מודרציה בקבוצת המנהלים |
| 4 | `🟢 אשר ופרסם` בקבוצה | הפוסט מתפרסם בערוץ + התראה למוכר עם קישור |
| 5 | לחיצה על `📩 צור קשר` בערוץ | הבוט נפתח ומציג את פרטי המוכר |
| 6 | `/admin` | פאנל מטריקות עם כל כפתורי הניהול |

---

## 🧩 פיצ'רים עיקריים

**למשתמש**
- אשף פרסום מלא עם ולידציות (כותרת 5-50, תיאור 10-500), אלבום עד 5 תמונות, תצוגה מקדימה ועריכת כל שדה לפני שליחה.
- חיפוש חופשי + סינון לפי קטגוריה, אזור, טווח מחירים ו"בחינם בלבד", עם עימוד (מודעה-מודעה) וספירת צפיות.
- "המודעות שלי": סימון כנמכר (מעדכן את הפוסט בערוץ לתג *נמכר*), מחיקה (מסירה מהערוץ) והקפצה (רה-פרסום עם cooldown של 24 שעות).
- מועדפים (גם דרך כפתור בערוץ), פרטי קשר של המוכר, דירוג מוכר 1-5 כוכבים, עדכון טלפון בלחיצה.

**למנהל**
- תור מודרציה בקבוצה: אישור / דחייה עם 7 סיבות מוכנות / עריכה בזמן אמת / חסימת משתמש.
- `/admin`: מטריקות חיות, שידור לכל המשתמשים (עם תצוגה מקדימה ואישור), ניהול קטגוריות, הסרת מודעה לפי מזהה, חסימה ושחרור משתמשים.
- כל פעולה שולחת התראה אוטומטית למפרסם.

---

## ⚙️ משתני סביבה

| משתנה | חובה | תיאור |
|---|---|---|
| `BOT_TOKEN` | ✅ | טוקן מ-BotFather |
| `BOT_USERNAME` | ✅ | שם המשתמש של הבוט (ל-deep links בערוץ) |
| `SUPABASE_URL` | ✅ | כתובת פרויקט Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | מפתח service_role |
| `CHANNEL_ID` | ✅ | מזהה ערוץ הפרסומים |
| `ADMIN_GROUP_ID` | ✅ | מזהה קבוצת המנהלים |
| `ADMIN_IDS` | ✅ | מזהי המנהלים, מופרדים בפסיק |
| `CHANNEL_URL` | ➖ | קישור ציבורי לערוץ |
| `SUPPORT_USERNAME` | ➖ | יוזר תמיכה |
| `PUBLIC_URL` | Webhook | דומיין הפריסה |
| `WEBHOOK_SECRET` | Webhook | סוד לאימות בקשות טלגרם |
| `MODE` | ➖ | `polling` / `webhook` |
| `PORT` | ➖ | ברירת מחדל 7860 |
| `MAX_PHOTOS` | ➖ | ברירת מחדל 5 |
| `BUMP_COOLDOWN_HOURS` | ➖ | ברירת מחדל 24 |

---

## 🛠️ פתרון תקלות

| תקלה | סיבה ופתרון |
|---|---|
| הבוט לא מגיב ב-Vercel | הרץ שוב `?action=set&secret=...`; ודא ש-`WEBHOOK_SECRET` זהה בין ה-URL למשתני הסביבה |
| הבוט לא מגיב ב-Polling | קיים Webhook פעיל — הרץ `npm run delete-webhook` |
| `Missing required environment variables` | לא הוגדרו משתני סביבה בפלטפורמה, או לא בוצע Redeploy |
| המודעה מאושרת אבל לא מתפרסמת | הבוט אינו אדמין בערוץ, או `CHANNEL_ID` שגוי |
| אין הודעות בקבוצת המנהלים | `ADMIN_GROUP_ID` שגוי (חייב להתחיל ב-`-100`) או שהבוט הוסר מהקבוצה |
| `relation "listings" does not exist` | `schema.sql` לא הורץ ב-Supabase |
| RLS / permission denied | נעשה שימוש ב-`anon key` במקום `service_role` |
| סימון "נמכר" לא מעדכן את הערוץ | חסרה הרשאת *Edit Messages* לבוט בערוץ |

---

## 🔐 אבטחה

- אימות Webhook דרך `secret_token` של טלגרם (כל בקשה שאינה מטלגרם נחסמת).
- RLS מופעל על כל הטבלאות; גישה רק דרך `service_role` בצד השרת.
- בריחה (escape) של כל תוכן משתמש לפני שליחה ב-HTML.
- בדיקת בעלות על כל פעולה במודעה, ובדיקת הרשאת אדמין על כל callback ניהולי.
- משתמשים חסומים נחסמים ב-middleware לפני כל handler.

---

## 📜 רישיון
MIT — חופשי לשימוש, שינוי והפצה.

---

## 🚀 שכבת PRO (v2) — ריבוי שפות, גלישה, התראות ומרכז בקרה

הפרויקט כולל שכבת שדרוג תוספתית: **7 שפות** (עברית, אנגלית, ערבית, רוסית, אוקראינית, צרפתית, ספרדית), מסכי גלישה וטרנדים, התראות חכמות על חיפושים שמורים, פרופילי מוכר עם תגים ודירוג, דיווחים, אנטי-ספאם, ומרכז בקרה מתקדם לאדמין (אנליטיקס, ניהול משתמשים, שידור מפולח, ייצוא CSV, יומן פעולות).

- תיעוד מלא: **[README_PRO.md](README_PRO.md)**
- מיגרציית DB: הרץ את `src/db/schema_v2.sql` ב-Supabase אחרי `schema.sql`
- אין תלויות npm חדשות ואין משתני סביבה חדשים
