# מחקר: ארבעה פיצ'רים לצמיחה — ספטמבר 2026

> נאסף ב-18.09.2026 מול **מקורות ראשוניים בלבד**: gov.il ורשות המסים, הרשות להגנת הפרטיות,
> התיעוד הרשמי של Meta, Google, OpenAI ו-ivrit.ai, ו-data.gov.il. כל טענה מקושרת למקורה.
> מה שלא נמצא לו מקור ראשוני מסומן **unverified** במפורש — לא הוערך ולא נוחש.
>
> מחירים ותנאים של ספקים משתנים. לפני החלטה שנשענת על מספר מכאן, לבדוק שוב את הקישור.

התוכנית שנגזרת מהמחקר: [../40-growth-roadmap.md](../40-growth-roadmap.md)

## תוכן

1. [חשבוניות ישראל ותיקון 13 לחוק הגנת הפרטיות](#part-1)
2. [WhatsApp Business Platform ותמלול עברית](#part-2)
3. [חיפוש עסק בזמן אונבורדינג](#part-3)

## המסקנות שמשנות את התוכנית

| # | ממצא | ההשלכה |
|---|---|---|
| 1 | סף מספר ההקצאה ירד ל-**5,000 ₪ לפני מע"מ מ-01.06.2026** — כבר בתוקף | חשבוניות המס שלנו חסרות ערך לקזוז מע"מ אצל לקוח עסקי. עדיפות ראשונה. |
| 2 | חיבור ישיר לרשות המסים = רישום בית תוכנה, בדיקות חדירה, 2FA חובה, עד 90 יום | לא בונים ישיר. מתחברים ל-Morning (ואז iCount); ה-PDF שלנו הופך ל"חשבון עסקה". |
| 3 | תמחור WhatsApp משתנה ב-**01.10.2026**: גם תשובות שירות בתוך 24 שעות בתשלום מעבר ל-1,000 בחודש | מתכננים לפי המודל החדש; כל עסק משלם ל-Meta ישירות. |
| 4 | Embedded Signup v2 יוצא משימוש ב-15.10.2026 | בונים על v4 מההתחלה. |
| 5 | Gemini מקבל ogg/opus ישירות, 32 טוקנים לשנייה | הודעה קולית → קריאה אחת שמחזירה תמלול + שדות מובנים. כ-$2.60 ל-1,000 הודעות. |
| 6 | אין מספר WER פורסם ל-Gemini בעברית; ivrit.ai מדווח 6.1% על הודעות WhatsApp | לפני התחייבות — מבחן על 30–50 הקלטות אמיתיות. |
| 7 | תנאי Google אוסרים "להעתיק ולשמור שמות עסקים וכתובות" | שומרים `place_id` בלבד עד בירור משפטי. המילוי האוטומטי מוצג, לא נשמר כמות שהוא. |
| 8 | אין מאגר ציבורי לעוסק מורשה לפי שם | רשם החברות מועיל רק לחברות בע"מ. |
| 9 | תיקון 13 בתוקף מ-14.08.2025; אנחנו "מחזיק" | הסכם עיבוד נתונים עם כל לקוח, יומן גישה, אסור לזהות דוברים לפי קול. |

---

<a id="part-1"></a>

# חלק 1: חשבוניות ישראל ותיקון 13 לחוק הגנת הפרטיות — מחקר עבור CraftMind AI

> נכון ל־18.09.2026. כל עובדה מקושרת למקור ראשוני (gov.il / taxes.gov.il / הרשות להגנת הפרטיות / תיעוד רשמי של הספק). מה שלא נמצא לו מקור ראשוני מסומן **unverified**. זה לא ייעוץ משפטי או חשבונאי — ראו "שאלות פתוחות" בסוף.

## תקציר

**מה מצאנו:**
- **מספר הקצאה** הוא תנאי שבלעדיו הקונה לא יכול לנכות מע"מ תשומות. מ־01.06.2026 הוא נדרש בכל חשבונית מס שסכומה לפני מע"מ **עולה על 5,000 ₪**, כשהקונה הוא עוסק מורשה וביקש אותו. אין מקור ראשוני שקובע סף אחר ל־2027.
- **חיבור ישיר לרשות המסים הוא פרויקט רגולטורי, לא רק אינטגרציה.** צריך:
  - רישום של בית תוכנה בשע"ם, כולל כתב התחייבות ונספח אבטחת מידע. הנספח מחייב מבדקי חדירה, 2FA ללקוחות, הצפנת טוקנים ולוגים לאורך 12 חודשים.
  - OAuth2 Authorization Code, שבו כל עוסק מזדהה ונותן הרשאה.
  - ככל הנראה גם **רישום התוכנה במרשם התוכנות** לניהול מערכת חשבונות. הרישום מחייב מודול "מבנה אחיד", וזמן הטיפול עד 90 יום.
- **Morning ו־iCount כבר מבקשות מספרי הקצאה אוטומטית**, אחרי שהעסק מחבר אותן פעם אחת לרשות המסים. בשתיהן אפשר ליצור חשבונית מס דרך API בשם העסק:
  - ב־Morning ה־API זמין מ־Best ומעלה (45 ₪ לחודש במנוי שנתי, לפני מע"מ). יש סביבת Sandbox. האימות הוא OAuth2 client_credentials עם מפתחות שכל עסק מפיק בעצמו.
  - ב־iCount ה־API כלול ב"מסלול המלא" ולא ב־Express. האימות הוא API Token לכל משתמש.
- **פרטיות:** תיקון 13 בתוקף מ־**14.08.2025**. CraftMind היא "מחזיק" (processor), והטכנאי הוא "בעל שליטה".
  - גם מחזיק אחראי בעצמו לאבטחת המידע.
  - עיבוד שחורג מההרשאה של בעל השליטה הוא עבירה פלילית. הוא חושף גם לעיצום של 4 ₪ לאדם ולא פחות מ־200,000 ₪.
  - חובת רישום מאגרים צומצמה, וכנראה לא חלה על לקוחותינו.
- **הקלטות קול** הן מידע אישי. הן הופכות ל"מידע בעל רגישות מיוחדת" רק אם משתמשים בהן, או מתכוונים להשתמש בהן, כמזהה ביומטרי לזיהוי ממוחשב.
- **תוכן WhatsApp** מוגן גם בסעיף 2(5) לחוק: העתקה או שימוש בתוכן מסר אלקטרוני ללא רשות הנמען או הכותב.

**ההחלטות שנגזרות מזה:**
1. **לא לבנות עכשיו חיבור ישיר לרשות המסים.** נחבר את Morning כספק ראשון ואת iCount כשני, במודל "העסק מביא את חשבון החשבוניות שלו". ה־PDF הנוכחי יישאר "טיוטה / חשבון עסקה" בלבד.
2. **לבדוק מיד עם רו"ח** אם הפקת חשבוניות מס היום בלי תוכנה רשומה חושפת אותנו או את הלקוחות (ראו A.5).
3. **הסכם עיבוד נתונים (DPA)** עם כל לקוח, לפי תקנה 15 לתקנות אבטחת מידע. בלי שימוש בנתוני לקוחות למטרות שלנו, כולל אימון מודלים, בלי הרשאה מפורשת.
4. **לא ליצור טביעות קול (voiceprints).** לתמלל, ולמחוק את האודיו לפי מדיניות שמירה שהלקוח מגדיר.
5. **לבנות לוג גישה אוטומטי שנשמר 24 חודשים, TLS בכל תעבורה, והצפנה במנוחה**, גם אם רוב המאגרים הם ברמת אבטחה בסיסית.

---

## A. חשבוניות ישראל / מספר הקצאה

### A.1 מה זה, ועל אילו חשבוניות זה חל

- **הבסיס בחוק:** חוק ההתייעלות הכלכלית (תיקוני חקיקה להשגת יעדי התקציב לשנות התקציב 2023 ו־2024), התשפ"ג–2023. לפי החוק, עוסק צריך לקבל מרשות המסים מספר הקצאה לחשבונית מס, **כתנאי לניכוי מס התשומות** שבה. תחילה ב־01.01.2024, ולאחר אורכה בפועל מ־05.05.2024. [הוראת ביצוע מע"מ 01/2025, עמ' 1](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf)
- **מספר ההקצאה בן 9 ספרות.** הוא מודפס על החשבונית תחת הכותרת "מספר הקצאה:". [הוראת ביצוע 01/2025](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf); [שאלות ותשובות — חשבוניות ישראל, ש' 6](https://www.gov.il/he/pages/faq_israel_invoice)
- **רק חשבונית מס.** זה לא חל על חשבון עסקה או על מסמכים אחרים. [FAQ ש' 7](https://www.gov.il/he/pages/faq_israel_invoice)
- **לא חל על עסקאות פטורות או בשיעור אפס.** על חשבונית מס שכוללת רק עסקאות כאלה לא נדרש מספר הקצאה, והוא גם לא יינתן. [הוראת ביצוע 01/2025, סעיף 1](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf)
- **ארבעה תנאים מצטברים** לחובה לבקש מספר הקצאה:
  1. הסכום לפני מע"מ עולה על הסף.
  2. החשבונית כוללת רכיב מע"מ.
  3. הלקוח הוא עוסק מורשה.
  4. הלקוח דרש מספר הקצאה.

  בכל מקרה מותר לבקש מספר הקצאה לחשבונית בכל סכום. [הוראת ביצוע 01/2025, סעיף 1](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf)
- **מאז 2025 רשות המסים יכולה לסרב** להקצות מספר, אם יש יסוד סביר לחשש שהחשבונית הוצאה שלא כדין. המוציא מקבל אז ארבע חלופות:
  1. ביטול.
  2. הוצאת החשבונית בלי מספר הקצאה. הקונה לא ינכה תשומות.
  3. היפוך חיוב.
  4. פנייה לחדר הבקרה ושימוע.

  [הוראת ביצוע 01/2025, פרק ד'](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf); [הודעה: שינויים ברפורמה לשנת 2026](https://www.gov.il/he/pages/pa301225-2)
- **אסור לפצל עסקה כדי לעקוף את הסף.** זה נושא שאלה 54 ב־FAQ. **unverified:** לא חילצנו את נוסח התשובה. [FAQ ש' 54](https://www.gov.il/he/pages/faq_israel_invoice)

**לוח הספים** (סכום החשבונית לפני מע"מ שמעליו נדרש מספר הקצאה כתנאי לניכוי תשומות):

| תקופה | סף (לפני מע"מ) | מקור |
|---|---|---|
| 05.05.2024 – 31.12.2024 | מעל 25,000 ₪ | [FAQ ש' 1](https://www.gov.il/he/pages/faq_israel_invoice); [הודעת רשות המסים 20.11.2024](https://www.gov.il/he/pages/sa201124-2) |
| 01.01.2025 – 31.12.2025 | מעל 20,000 ₪ | [הודעת רשות המסים 20.11.2024](https://www.gov.il/he/pages/sa201124-2); [הוראת ביצוע 01/2025](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf) |
| 01.01.2026 – 31.05.2026 | מעל 10,000 ₪ | [הוראת ביצוע 01/2025](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf); [הודעה 30.12.2025](https://www.gov.il/he/pages/pa301225-2) |
| מ־01.06.2026 | מעל 5,000 ₪ | שם |
| 2027 | **unverified**: לא נמצא מקור ראשוני שקובע סף שונה ל־2027. לפי הפרסומים העדכניים, 5,000 ₪ היא המדרגה האחרונה שנקבעה. | — |

- **הערה על מסמך ישן:** מסמך ההנחיות לבתי תוכנה (גרסה 2.0, 7/2024) עוד מציג את **המתווה המקורי**: 2026 — 15,000 ₪, 2027 — 10,000 ₪, 2028 — 5,000 ₪. [Israel Invoice Model API Description v2.0, סעיף 1.2](https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/vat_software-houses-180724-en.pdf)
- **המתווה המקורי הוחלף.** ועדת הכספים אישרה ב־17.03.2025 להקדים את הספים: 10,000 ₪ מ־1.1.2026 ו־5,000 ₪ מ־1.6.2026. [הודעת רשות המסים 17.03.2025](https://www.gov.il/he/pages/sa170325-1)
- **ההקדמה נכנסה לחוק.** בהודעה מ־30.12.2025 רשות המסים מתארת את הספים החדשים כ"מתווה שנקבע בחוק". [הודעה 30.12.2025](https://www.gov.il/he/pages/pa301225-2)

### A.2 עוסק מול צרכן פרטי, ומה קורה לקונה בלי מספר הקצאה

- **החובה נגזרת מזכות הניכוי של הקונה**, ולכן היא חלה רק כשהלקוח הוא **עוסק מורשה** וביקש מספר. [הוראת ביצוע 01/2025, סעיף 1(ב)-(ג)](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf)
- **לצרכן פרטי אין חובה.** אם בכל זאת מבקשים מספר הקצאה עבור מי שאינו עוסק, הבקשה תתקבל, ובלבד שמספר הזיהוי תקין. [FAQ ש' 18](https://www.gov.il/he/pages/faq_israel_invoice)
- **מלכ"ר או מוסד כספי** שלא מקזז את התשומה לא צריך מספר הקצאה. [FAQ ש' 42](https://www.gov.il/he/pages/faq_israel_invoice)
- **אצל הקונה:** חשבונית שחייבת מספר הקצאה ואין עליה מספר **אסורה בניכוי כתשומה**, והיא מופחתת אוטומטית בדוח המפורט. ניכוי תשומות על סמך חשבונית כזו הוא **עבירה על חוק מע"מ**. [FAQ ש' 30](https://www.gov.il/he/pages/faq_israel_invoice)
- **תשומה שנדחתה:** אם מוציא החשבונית בחר להמשיך בלי מספר הקצאה אחרי סירוב, מקבל החשבונית לא יוכל לנכות את התשומה. [הודעה 30.12.2025](https://www.gov.il/he/pages/pa301225-2)
- **מס הכנסה:** ועדת הכספים אישרה גם איסור לנכות במס הכנסה הוצאה שכלולה בחשבונית שבקשת ההקצאה עבורה סורבה, החל מאוגוסט 2025. באותה הודעה נאמר שהכניסה לתוקף מותנית באישור המליאה. [הודעה 17.03.2025](https://www.gov.il/he/pages/sa170325-1) — **unverified:** לא אימתנו את הנוסח הסופי שעבר במליאה.
- **בקשה בדיעבד:** אפשר לבקש מספר הקצאה עד שנה מתאריך החשבונית. עד שמתקבל המספר, הלקוח לא יכול להזדכות על המע"מ. [FAQ ש' 10](https://www.gov.il/he/pages/faq_israel_invoice)
- **חשבונית עם תאריך עתידי:** אפשר לבקש מספר לחשבונית שתאריכה עד 30 יום אחרי מועד הבקשה. [FAQ ש' 41](https://www.gov.il/he/pages/faq_israel_invoice)
- **משמעות עבורנו:** טכנאי מיזוג שמתקין אצל לקוח עסקי (משרד, מסעדה) בעבודה שמעל 5,000 ₪ לפני מע"מ חייב חשבונית עם מספר הקצאה, אחרת הלקוח שלו מפסיד את המע"מ. עבודות לצרכנים פרטיים לא דורשות מספר הקצאה.

### A.3 איך מקבלים מספר: ה־API של רשות המסים לבתי תוכנה

**שלוש דרכים לבקש מספר הקצאה:**
1. אוטומטית, מתוכנת הנהלת החשבונות של העוסק.
2. ידנית, ביישום אינטרנטי של רשות המסים (מתאים גם לנייד).
3. דרך חברות "תווכה" שמקבלות הרשאה מהעסק.

[הוראת ביצוע 01/2025, סעיף 3(ג)](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf); [FAQ ש' 22](https://www.gov.il/he/pages/faq_israel_invoice)

**הרשאה מהעסק (מודל ההסכמה):**
- העוסק נרשם לאזור האישי ונותן הרשאה ב"מערכת ההרשאות לפעולות דיגיטליות" לנושא "חשבוניות ישראל". מקבל ההרשאה נרשם גם הוא ומאשר אותה.
- ההרשאה תקפה לתקופה שהעוסק קובע, ולכל היותר שנה. כל צד יכול לבטל אותה.
- האחריות לפעולות נשארת תמיד על העוסק.

[הוראת ביצוע 01/2025, סעיף 3(ב)](https://www.gov.il/BlobFolder/policy/inst-071225-1/he/vat_inst-071225-1.pdf); [FAQ ש' 4](https://www.gov.il/he/pages/faq_israel_invoice)

**אימות ב־API:**
- כל השירותים עובדים ב־**OAuth2**. [API Description v2.0, סעיף 1.5](https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/vat_software-houses-180724-en.pdf)
- שירות ה־Approval מוגדר "OAuth2: User Restricted". [API Description v2.0, סעיף 2.3](https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/vat_software-houses-180724-en.pdf)
- מדריך הפורטל מתאר את הזרימה:
  1. Authorization Code flow, שבו משתמש הקצה מזדהה ברשות המסים ומנותב ל־Redirect URI.
  2. החלפת הקוד ב־JWT access token ו־refresh token, עם Basic auth של client_id:client_secret.
  3. יש טוקנים מסוג one-time ו־long-time.

  [OpenApiUserGuide (הנחיות התחברות לשירותי רשות המסים, 5.2023)](https://secapp.taxes.gov.il/OpenApiUserGuide/OpenApiUserGuide.pdf)
- הטוקן "נשתל" בתוכנה וצריך לחדש אותו כל כמה חודשים. בחיוב ממוכן אפשר טוקן ארגוני אחד. כשכמה אנשים מפיקים חשבוניות, מומלץ טוקן לכל אחד מהם. [FAQ ש' 37](https://www.gov.il/he/pages/faq_israel_invoice)
- כשהטוקן רשום על משתמש "כללי", צריך לשלוח בכל בקשה את ת"ז המשתמש שביצע את הפעולה בפועל. [API Description v2.0, טבלה 2.1](https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/vat_software-houses-180724-en.pdf)

**Endpoints:**
- `…/shaam/production/Invoices/v2/Approval`
- `…/Multiinvoices/v2/MultiApproval` (לחיוב המוני)
- `invoice-information/v1/details`
- `InvoiceDecisionApi/v1/{Cancel,Continue,FurtherObjection}` (לטיפול בחשבונית שעוכבה)

כולם גם בסביבת `tsandbox`. [API Description v2.0](https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/vat_software-houses-180724-en.pdf)

**חשבונית שעוכבה:** התוכנה חייבת להציג למשתמש 4 חלופות ולעדכן את הרשות. אם ממשיכים בלי מספר, יש להדפיס על החשבונית "Input tax should not be deducted in respect of this invoice". [API Description v2.0, סעיף 2.2.2](https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/vat_software-houses-180724-en.pdf)

**רישום בית תוכנה (לא רק מפתח API):**
- **Sandbox:** חובה להירשם קודם לסביבת ה־Sandbox, בלי מסמכים. זה תנאי לאישור בסביבת ה־Production. [OpenApiUserGuide](https://secapp.taxes.gov.il/OpenApiUserGuide/OpenApiUserGuide.pdf)
- **Production:** השימוש מותנה באישור רשות המסים ובמסמכים חתומים: [OpenApiUserGuide](https://secapp.taxes.gov.il/OpenApiUserGuide/OpenApiUserGuide.pdf)
  - רישום Organization בפורטל המפתחים.
  - מינוי ADMIN.
  - Client ID/Secret.
- **חמשת שלבי נוהל החיבור:** [נוהל חיבור בית תוכנה — הגשה דיגיטלית](https://www.gov.il/BlobFolder/service/connect-to-shaam/he/Service_Pages_shaam_Software-Company-Connection-Procedure-Digital-Form-Submission.pdf); [דף השירות "קישור לשע"ם"](https://www.gov.il/he/service/connect-to-shaam)
  1. הרשאה דיגיטלית מהתאגיד.
  2. חשבון בפורטל המפתחים (sandbox + production).
  3. חתימה על **כתב התחייבות לשימוש בשירותי API** ועל **נספח אבטחת מידע**.
  4. טופס בקשה דיגיטלי.
  5. המתנה לאישור.
- **נספח אבטחת המידע** (22.07.2025) מחייב את בית התוכנה: [נספח אבטחת מידע — הצהרה](https://www.gov.il/BlobFolder/service/connect-to-shaam/he/Service_Pages_shaam_Data-Security-Appendix-Statement.pdf)
  - לעמוד בחוק הגנת הפרטיות, בתקנות אבטחת מידע ובתיקון 13.
  - להחתים עובדים על סודיות.
  - לדווח לרשות המסים תוך **72 שעות** על שימוש לרעה.
  - לבצע **מבדק חדירות כל 12–18 חודשים** אם יש לו יותר מ־10 לקוחות שמפיקים חשבוניות דרך שע"ם. מעל 100 לקוחות, כל 18 חודשים.
  - לתקן ממצאי High/Critical תוך 30 ימי עסקים.
  - לדרוש מהלקוחות שלו **2FA**.
  - לשמור מוצפנים: Client Secret, Access/Refresh Token, JWT, Session.
  - לשמור **לוגי אימות מוצפנים 12 חודשים**.
  - לדווח בזמן אמת על ניסיונות תקיפה או פישינג.
- **תיעוד וקוד לדוגמה:**
  - [מסמך ההנחיות ליצרני תוכנה (עברית)](https://www.gov.il/BlobFolder/generalpage/hor-software-other/he/vat_software-houses-180724.pdf)
  - [גרסה באנגלית](https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/vat_software-houses-180724-en.pdf)
  - [כלל מסמכי ההנחיות](https://www.gov.il/he/pages/israel-invoice-160723)
  - פורטל המפתחים: `https://openapi-portal.taxes.gov.il/sandbox` ו־`https://openapi-portal.taxes.gov.il/shaam/production`
  - דוגמאות קוד: `github.com/IsrTaxesOpenApi/NodeJsExample`

  [OpenApiUserGuide, "קישורים חשובים"](https://secapp.taxes.gov.il/OpenApiUserGuide/OpenApiUserGuide.pdf)
- **תמיכה:** APISupport@taxes.gov.il. [FAQ ש' 34](https://www.gov.il/he/pages/faq_israel_invoice)

### A.4 Morning (חשבונית ירוקה) ו־iCount

**Morning** — [תיעוד API רשמי: developers.morning.co](https://developers.morning.co/)

| נושא | ממצא | מקור |
|---|---|---|
| אימות | OAuth 2.0 **client_credentials**. מפתחות API (Client ID/Secret) לכל עסק. ה־accessToken הוא JWT שתקף **שעה**, ו־"scoped to the business associated with your API keys" | [Morning API docs — Authentication](https://developers.morning.co/) |
| יצירת מסמכים ב־API | `POST /documents` עם `type` 305 (חשבונית מס), 320 (חשבונית מס/קבלה), 330 (זיכוי) ועוד. בתגובה יש שדה `allocationNumber` ("Allocation Number issued by the Israeli Tax Authority") | [Morning API docs — Documents](https://developers.morning.co/) |
| בשם משתמשים אחרים | אין זרימת OAuth של שותפים או "התחבר עם Morning". כל עסק מפיק מפתחות בעצמו (אזור אישי > כלי מפתחים > מפתחות API) ומוסר אותם לנו. אנחנו שומרים סוד לכל לקוח | [Morning API docs](https://developers.morning.co/); [מרכז העזרה: איך ליצור מפתחות API](https://www.greeninvoice.co.il/help-center/kb/he/article/%D7%90%D7%99%D7%9A-%D7%9C%D7%99%D7%A6%D7%95%D7%A8-%D7%9E%D7%A4%D7%AA%D7%97%D7%95%D7%AA-api) (אתר הספק) |
| דרישת מסלול | API "זמין למנויי Best ומעלה". הטוקן נדחה עם `unauthorized_client` אם אין מנוי שכולל API | [מרכז העזרה](https://www.greeninvoice.co.il/help-center/kb/he/article/%D7%90%D7%99%D7%9A-%D7%9C%D7%99%D7%A6%D7%95%D7%A8-%D7%9E%D7%A4%D7%AA%D7%97%D7%95%D7%AA-api); [API docs — Errors](https://developers.morning.co/) |
| מחיר | ב־18.09.2026, במנוי שנתי ולפני מע"מ: Basic 29 ₪ לחודש (ללא API); **Best 45 ₪ לחודש** (540 ₪ לשנה, עד 50 מסמכים, API ו־Webhooks); Extra 74 ₪; Prime 129 ₪ (155 ₪ בחודשי). מחירי חודשי של Best/Extra לא נבדקו | [מחירון Morning](https://www.greeninvoice.co.il/pricing/) |
| Sandbox | יש: `https://sandbox.d.greeninvoice.co.il/api/v1`, עם שרת טוקנים `api.sandbox.morning.dev`. צריך מפתחות נפרדים | [API docs — Environments](https://developers.morning.co/) |
| מספר הקצאה אוטומטי | כן, אחרי חיבור חד־פעמי של העסק לרשות המסים. זמין מ־Basic ומעלה, ולא בתקופת הניסיון. "ההרשאה תקפה למשך 3 חודשים ולאחר תקופה זו יש לחדשה". אחר כך כל חשבונית מס מ־5,000 ₪ לפני מע"מ שולחת בקשה אוטומטית | [מרכז העזרה: חשבונית ישראל](https://www.greeninvoice.co.il/help-center/all-tax-auth/) (אתר הספק) |
| מסמך שנוצר ב־API | **unverified:** התיעוד לא אומר במפורש שמסמך שנוצר ב־API עובר אותו תהליך הקצאה. שדה `allocationNumber` בתגובה מרמז על כך. צריך לבדוק ב־Sandbox | — |

**iCount** — [תיעוד API רשמי: apiv3.icount.co.il](https://apiv3.icount.co.il/)

| נושא | ממצא | מקור |
|---|---|---|
| אימות | שלוש שיטות: (1) **API Token** ארוך־טווח ב־Bearer, בלי תפוגה עד ביטול, צמוד למשתמש ועם אותן הרשאות. מומלץ. (2) `sid` מ־`auth/login`, תקף 20 דקות מהבקשה האחרונה. (3) cid/user/pass בכל בקשה | [iCount API docs](https://apiv3.icount.co.il/) |
| יצירת מסמכים | `POST https://api.icount.co.il/api/v3.php/doc/create` עם `doctype`, פרטי לקוח (`client_id` / `vat_id` / `client_name`) ועוד | [iCount API docs — module doc](https://apiv3.icount.co.il/#/module/doc) |
| בשם משתמשים | אין OAuth לשותפים. העסק יוצר משתמש, רצוי עם הרשאות מוגבלות, ומפיק לנו Token | [iCount API docs](https://apiv3.icount.co.il/) |
| דרישת מסלול / מחיר | Express (276 ₪ לשנה, לפני מע"מ) הוא הכנסות והוצאות בלבד. **API "כלול במסלול המלא"**. Advanced "החל מ־32 ₪ לחודש", לפי שימוש ולפני מע"מ | [מחירון iCount](https://www.icount.co.il/plans/) |
| Sandbox | **unverified**: לא מצאנו סביבת Sandbox בתיעוד ה־API הרשמי | — |
| מספר הקצאה אוטומטי | הספק מצהיר שהמערכת מבקשת מספר הקצאה אוטומטית, אחרי "הקמת הרשאה" חד־פעמית באתר הממשלתי | [iCount — חשבוניות ישראל](https://www.icount.co.il/blog/invoice-israel/) (אתר הספק, לא תיעוד API) |
| מסמך שנוצר ב־API | **unverified**: אין אזכור של allocation בתיעוד מודול `doc` | [iCount API docs](https://apiv3.icount.co.il/#/module/doc) |

### A.5 המלצה: לבנות חיבור עצמאי או לחבר Morning / iCount

**ההמלצה: לחבר את Morning כספק ראשון ואת iCount כשני.** לא לבנות חיבור ישיר לשע"ם בשלב הזה.

**הנימוקים:**
1. **נטל האישור.** חיבור ישיר מחייב:
   - רישום Organization בשע"ם, כתב התחייבות ונספח אבטחה.
   - מבדקי חדירה כל 12–18 חודשים מרגע שיש לנו יותר מ־10 לקוחות שמפיקים חשבוניות, אצל ספק עם דרישות ניסיון מחמירות.
   - 2FA ללקוחות, לוגים מוצפנים ודיווח תוך 72 שעות. [נספח אבטחת מידע](https://www.gov.il/BlobFolder/service/connect-to-shaam/he/Service_Pages_shaam_Data-Security-Appendix-Statement.pdf)
   - טיפול ב־4 חלופות של חשבונית שעוכבה, שימוע וזיכוי. [API Description v2.0](https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/vat_software-houses-180724-en.pdf)
2. **רישום התוכנה עצמה.**
   - יצרני תוכנה לניהול מערכת חשבונות ממוחשבת, "המיועדת למכירה, להשכרה או לשימושם של אחרים (כולל שימוש בחינם)", חייבים לרשום אותה.
   - הרישום מחייב מודול **"מבנה אחיד"** ובדיקת סימולטור, וזמן הטיפול עד 90 יום. [בקשה לרישום תוכנה לניהול מערכת חשבונות ממוחשבת](https://www.gov.il/he/service/registration-software-designed-managing-computerized-accounting-system)
   - המשמעות: אם CraftMind מפיקה בעצמה חשבוניות מס ללקוחות, היא עלולה להיות חייבת ברישום הזה **כבר היום**, בלי קשר למספרי הקצאה. צריך לאמת עם רו"ח; ראו שאלה פתוחה 1.
3. **אחריות.** כשהחשבונית מופקת במערכת רשומה של Morning או iCount, האחריות לתקינות מסמך המקור, למספור, לשמירה ולקובץ האחיד נשארת אצל הספק הרשום ואצל העוסק. בכל מקרה "האחריות לביצוע הפעולות נותרת תמיד על העוסק". [FAQ ש' 4](https://www.gov.il/he/pages/faq_israel_invoice)
4. **עלות ללקוח.** Morning Best עולה 45 ₪ לחודש, ו־iCount Advanced מתחיל ב־32 ₪ לחודש (שניהם לפני מע"מ). [מחירון Morning](https://www.greeninvoice.co.il/pricing/); [מחירון iCount](https://www.icount.co.il/plans/)
   - ללקוח שכבר משלם על אחת מהן, התוספת היא אפס עד שדרוג מסלול.
   - **unverified:** אין לנו מקור ראשוני לנתחי השוק של Morning או iCount בקרב עוסקים קטנים, ולכן הטענה ש"רוב הטכנאים כבר משתמשים באחת מהן" אינה מאומתת.
5. **מתי לשקול מחדש:** אם נרצה בעתיד להיות מערכת החשבוניות עצמה, למשל בגלל עלות או חוויית משתמש, זה פרויקט של רבעון לפחות: רישום תוכנה, מבנה אחיד, רישום בית תוכנה, pen-test ו־OAuth per-business. עד אז, ה־PDF שלנו צריך להיות "חשבון עסקה / הצעת מחיר", והחשבונית הרשמית מופקת דרך הספק.

**השלכות הנדסיות לאינטגרציה:**
- ממשק `InvoiceProvider` עם מימושים ל־Morning ול־iCount.
- הצפנת הסודות של כל לקוח (Client Secret או Token) במנוחה.
- רענון טוקן כל שעה ב־Morning.
- הצגת `allocationNumber` מהתגובה.
- התראה ללקוח כשההרשאה שלו מול רשות המסים ב־Morning עומדת לפוג (3 חודשים).

---

## B. תיקון 13 לחוק הגנת הפרטיות

### B.1 מועד תחילה, ומה חל על CraftMind כמחזיק

- **תאריכים:** הכנסת אישרה את החוק ב־05.08.2024. הוא נכנס לתוקף ב־**14.08.2025**. [מדריך הרשות להגנת הפרטיות: תיקון 13 (עמ' 3)](https://www.gov.il/BlobFolder/reports/guide_tikon13_professional/he/tikun%2013%20_170825.pdf); [שאלות ותשובות — תיקון 13](https://www.gov.il/he/pages/tikun13_qa)
- **התפקידים:**
  - **"בעל שליטה במאגר מידע"** הוא מי שקובע את מטרות העיבוד. במקרה שלנו זה העסק של הטכנאי.
  - **"מחזיק"** הוא "גורם חיצוני לבעל השליטה במאגר מידע המעבד מידע עבורו". במקרה שלנו זו CraftMind.

  [שאלות ותשובות — תיקון 13](https://www.gov.il/he/pages/tikun13_qa)
- **"עיבוד"** הוא כל פעולה על מידע אישי, כולל אחסון, העתקה, עיון, העברה ומתן גישה. [שם](https://www.gov.il/he/pages/tikun13_qa)
- **"מאגר מידע"** הוא אוסף מידע אישי שמעובד באמצעי דיגיטלי. [חוק הגנת הפרטיות, תרגום לא רשמי מעודכן לתיקון 13, סעיף 3](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
  - החריג לאוסף של שם, מען ודרכי התקשרות בלבד (עד 100,000 איש) **לא יחול** על לקוחותינו. אצלם יש גם היסטוריית עבודות וחשבוניות.
- **החובות העיקריות שחלות עלינו כמחזיק:**
  - **אחריות לאבטחה:** "בעל השליטה והמחזיק אחראים כל אחד" לאבטחת המידע. [סעיף 17(א)](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
  - **עיבוד רק לפי הרשאה:** אסור לעבד מידע ממאגר בלי הרשאה של בעל השליטה או בחריגה ממנה. [סעיף 8(ג)](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
    - זו עבירה פלילית שדינה 3 שנות מאסר. [שו"ת תיקון 13](https://www.gov.il/he/pages/tikun13_qa)
    - היא חושפת לעיצום של 4 ₪ לאדם (8 ₪ למידע בעל רגישות מיוחדת), ולפחות 200,000 ₪. [סעיף 23KF(e) בתרגום](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
  - **תיקון מידע:** מחזיק חייב לתקן מידע אם בעל השליטה הסכים לתיקון. [סעיף 14(ד)](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
  - **זכות עיון במידע אצל מחזיק:** יש הסדר נפרד. [סעיף 13א](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
  - **עיצום על מחזיק:** אם הוטל עיצום על מחזיק, בעל השליטה מקבל הודעה והוראה להביא להפסקת ההפרה. אם ההפרה לא הופסקה, העיצום יכול לחול גם על בעל השליטה. [מדריך תיקון 13](https://www.gov.il/BlobFolder/reports/guide_tikon13_professional/he/tikun%2013%20_170825.pdf); [סעיף 23KF(j) בתרגום](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
    - המשמעות: לקוחות ידרשו מאיתנו DPA ופיקוח.
- **ממונה על הגנת הפרטיות (DPO)** חובה רק עבור:
  - גופים ציבוריים.
  - סוחרי מידע (מעל 10,000 איש).
  - מי שעיסוקו העיקרי ניטור שיטתי בהיקף ניכר.
  - מי שעיסוקו העיקרי עיבוד מידע בעל רגישות מיוחדת בהיקף ניכר.

  [סעיף 17ב1](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf); [שו"ת תיקון 13](https://www.gov.il/he/pages/tikun13_qa)

  **הערכה (לא עובדה):** CraftMind כנראה לא חייבת. לשאלה 7.
- **ממונה אבטחת מידע** חובה לבעל שליטה או **מחזיק** בחמישה מאגרים שחייבים ברישום או בהודעה. [סעיף 17ב](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)

### B.2 רישום מאגרים, יידוע, רמות אבטחה, דיווח על אירוע, עיצומים

**רישום מאגרים — צומצם:**
- חובת רישום נשארת רק למאגר של גוף ציבורי, ולמאגר שמטרתו העיקרית מסירת מידע לאחר כדרך עיסוק או בתמורה, עם מעל 10,000 איש. [סעיף 8א(א)](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf); [שו"ת תיקון 13](https://www.gov.il/he/pages/tikun13_qa)
- **חובת הודעה חדשה:** מאגר עם מידע בעל רגישות מיוחדת על יותר מ־100,000 איש מחייב הודעה לרשות תוך 30 יום. ההודעה כוללת את מסמך הגדרות המאגר. [סעיף 8א(ב)](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf); [שו"ת תיקון 13](https://www.gov.il/he/pages/tikun13_qa)
- **משמעות:** מאגר של עוסק קטן לא חייב ברישום ולא בהודעה, אבל **כל שאר החובות** ממשיכות לחול. [שו"ת תיקון 13](https://www.gov.il/he/pages/tikun13_qa)

**חובת יידוע (סעיף 11):** כשמבקשים מאדם מידע לצורך עיבוד במאגר, צריך למסור לו הודעה שכוללת: [סעיף 11](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
- האם יש חובה חוקית למסור את המידע, והתוצאה של אי־הסכמה (תוספת של תיקון 13).
- מטרת האיסוף.
- שם ופרטי קשר של בעל השליטה.
- למי יימסר המידע ולאיזו מטרה.
- זכויות העיון והתיקון.

[מדריך תיקון 13 — הרחבת חובת היידוע](https://www.gov.il/BlobFolder/reports/guide_tikon13_professional/he/tikun%2013%20_170825.pdf)

**עיצום על הפרת חובת היידוע:** 50 ₪ כפול מספר הפונים (100 ₪ למידע בעל רגישות מיוחדת), ולפחות 30,000 ₪. [סעיף 23KF(c) בתרגום](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)

**תקנות הגנת הפרטיות (אבטחת מידע), התשע"ז–2017:**
- **ארבע רמות:** גבוהה, בינונית, בסיסית, ומאגר שמנוהל בידי יחיד. [עמוד הרשות על התקנות](https://www.gov.il/en/pages/data_security_eng); [נוסח התקנות (תרגום רשמי־לא־מחייב)](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
- **רמה בינונית:** מאגר שיש בו, בין השאר:
  - מידע רפואי.
  - מידע ביומטרי.
  - מידע על נכסים, חובות, מצב כלכלי ויכולת עמידה בהתחייבויות.

  **חריג:** אם יש לכל היותר עשרה בעלי הרשאה, המאגר הוא ברמה בסיסית. [התוספת הראשונה](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
- **רמה גבוהה:** מאגר מסוג בינוני עם 100,000 איש ומעלה, או עם יותר מ־100 בעלי הרשאה. [התוספת השנייה](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
- **לוג גישה אוטומטי** (ברמה בינונית וגבוהה):
  - רושם זהות משתמש, זמן, רכיב, סוג גישה ותוצאה.
  - עמיד לשינוי או השבתה.
  - נשמר **לפחות 24 חודשים**.

  [תקנה 10](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
- **עוד חובות רלוונטיות:**
  - הצפנה מקובלת לתעבורה ברשת ציבורית. [תקנה 14](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
  - הצפנה לנתונים שמועתקים להתקן נייד. [תקנה 12](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
  - בדיקה שנתית של מידע עודף. [תקנה 2(ג)](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
  - מסמך הגדרות מאגר, כולל עיבוד בידי מחזיק והעברה לחו"ל. [תקנה 2(א)](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
  - ביקורת תקופתית כל 24 חודשים ברמה בינונית וגבוהה. [תקנה 16](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
  - **הצפנה במנוחה:** **לא מצאנו** בתקנות חובה מפורשת כללית. היא כן נדרשת לטוקנים ולסודות בנספח של רשות המסים, ורלוונטית רק אם מתחברים ישירות.
- **מיקור חוץ (תקנה 15):** בעל השליטה חייב לבחון סיכונים ולחתום עם נותן השירות על הסכם שמסדיר: [תקנה 15](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
  - סוגי המידע ומטרות השימוש.
  - המערכות שהמחזיק רשאי לגשת אליהן.
  - סוג העיבוד.
  - משך ההסכם, החזרת המידע והשמדתו בסיומו, ודיווח על כך.
  - יישום חובות האבטחה.
  - התחייבות סודיות של עובדי המחזיק.
  - תנאים לקבלני משנה.
  - **דיווח שנתי לבעל השליטה, והודעה לו על כל אירוע אבטחה**.

**אירוע אבטחה חמור:**
- **ההגדרה:** ברמה גבוהה, כל שימוש לא מורשה. ברמה בינונית, שימוש לא מורשה בחלק מהותי מהמאגר. [תקנה 1](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
- **החובות:** בעל השליטה מודיע לרשות **מיד**. הרשות רשאית להורות לו להודיע לנושאי המידע. [תקנה 11(ד)](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
- **עיצום:** אי־דיווח על אירוע חמור הוא הפרה בקבוצת העיצומים של 80,000 ₪ לרמה בינונית ו־320,000 ₪ לרמה גבוהה. [מדריך תיקון 13, עמ' 19](https://www.gov.il/BlobFolder/reports/guide_tikon13_professional/he/tikun%2013%20_170825.pdf)

**עיצומים ואכיפה:**
- **ביטול הקנסות:** מנגנון הקנסות המנהליים הישן בוטל, ובמקומו באו עיצומים כספיים. [שו"ת תיקון 13](https://www.gov.il/he/pages/tikun13_qa)
- **דוגמאות לסכומים:**
  - 150,000 ₪ על אי־רישום או אי־הודעה (כפול במאגר של מיליון איש ומעלה). [סעיף 23KF בתרגום](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
  - 15,000 ₪ על סירוב לזכות עיון. [סעיף 23KF בתרגום](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
  - 300,000 ₪ על אי־מסירת מסמכים למפקח. [סעיף 23KF בתרגום](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
  - במאגר ברמה בסיסית ובמאגר של יחיד: 1,000–2,000 ₪ לרוב ההפרות של תקנות האבטחה, ו־4,000 ₪ על הפרת פיקוח על מיקור חוץ. [מדריך תיקון 13, עמ' 19–20](https://www.gov.il/BlobFolder/reports/guide_tikon13_professional/he/tikun%2013%20_170825.pdf)
- **הפחתות ותקרות:**
  - הפחתה של 30% למי שהפסיק את ההפרה ודיווח עליה.
  - תקרות מיוחדות לעסקים זעירים (מחזור עד 4 מיליון ₪) ולעסקים קטנים (4–10 מיליון ₪).
  - **תקרה כוללת של 5% מהמחזור השנתי**.

  [מדריך תיקון 13, עמ' 22](https://www.gov.il/BlobFolder/reports/guide_tikon13_professional/he/tikun%2013%20_170825.pdf)
- **עבירות פליליות חדשות:** עיבוד בלי הרשאה (3 שנות מאסר) והטעיה בחובת היידוע (3 שנות מאסר). [שו"ת תיקון 13](https://www.gov.il/he/pages/tikun13_qa)

### B.3 הקלטות קול ותוכן WhatsApp

**הקלטות קול:**
- **קול הוא מידע אישי.** "מידע אישי" הוא כל נתון שנוגע לאדם מזוהה או לאדם שניתן לזהות. [שו"ת תיקון 13](https://www.gov.il/he/pages/tikun13_qa)
- **הרשות מונה את הקול כתכונה ביומטרית.** [זיהוי ביומטרי — שאלות ותשובות](https://www.gov.il/he/departments/general/fqa_biometric_database)
- **מתי זה "מידע בעל רגישות מיוחדת":** רק "מזהה ביומטרי המשמש או מיועד לשמש לזיהוי אדם או לאימות זהותו באופן ממוחשב". [שו"ת תיקון 13](https://www.gov.il/he/pages/tikun13_qa); [סעיף 3, הגדרת "data of special sensitivity" פס' (4)](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
  - **הפרשנות שלנו:** הודעה קולית של טכנאי שנשמרת ומתומללת, בלי זיהוי דובר, **אינה** מידע בעל רגישות מיוחדת מכוח היותה קול. אם נוסיף voiceprint או speaker-ID, היא תהפוך לכזו.
- **התוכן עצמו** עלול לכלול מידע בעל רגישות מיוחדת, למשל מצב בריאותי של לקוח ("הלקוח מונשם, צריך מזגן דחוף") או פעילות פיננסית. [סעיף 3](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
- **אי־ודאות בתקנות האבטחה:** התוספת הראשונה מונה "Biometric information" כגורם לרמה בינונית, בלי הסייג של "משמש לזיהוי". **unverified:** לא ברור אם הקלטה גולמית נחשבת כך. [תוספת ראשונה לתקנות](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf); ראו שאלה פתוחה 5.
- **הקלטת שיחות טלפון** (בניגוד להודעה קולית שהטכנאי מקליט בעצמו) עשויה לערב את חוק האזנת סתר. **unverified:** לא בדקנו מקור ראשוני.

**תוכן WhatsApp:**
- **שני סעיפים רלוונטיים בחוק:**
  - **סעיף 2(5):** העתקה או שימוש, בלי רשות הנמען או הכותב, בתוכן של מכתב או כתב אחר שלא נועד לפרסום, "לרבות מסר אלקטרוני", הם פגיעה בפרטיות. [סעיף 2(5)](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
  - **סעיף 2(9):** שימוש במידע לא לשם המטרה שלשמה נמסר הוא פגיעה בפרטיות. [סעיף 2(9)](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
- **משמעות:**
  - לקלוט רק שיחות שבהן העסק הוא צד (נמען או כותב).
  - להשתמש בהן רק לתפעול העבודה.
  - לא להשתמש בהן לאימון מודלים או לניתוח חוצה־לקוחות בלי הרשאה של בעל השליטה, ובמידת הצורך גם של הכותב.
- **תנאי Meta:** **unverified.** לא בדקנו את תנאי WhatsApp Business Platform של Meta לגבי שמירת תוכן.

### B.4 השלכות הנדסיות קונקרטיות

1. **DPA עם כל לקוח** לפי רשימת תקנה 15(א)(2):
   - סוגי המידע: פרטי קשר, כתובת, היסטוריית עבודות, חשבוניות, הודעות קוליות, WhatsApp.
   - מטרות, מערכות, סוגי עיבוד.
   - תת־מעבדים: אחסון (DigitalOcean), תמלול, LLM, Morning/iCount.
   - החזרה ומחיקה בסיום.
   - דיווח שנתי והודעה על כל אירוע אבטחה.
   - התחייבות סודיות של העובדים שלנו.

   [תקנה 15](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
2. **לוג גישה** (user, timestamp, resource, action, allowed/denied):
   - append-only, עם התראה על ניסיון להשבית אותו.
   - נשמר **24 חודשים**.
   - הלקוחות צריכים ממשק לסקירה שלו.

   זה מכסה גם לקוחות שיגיעו לרמה בינונית. [תקנה 10](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
3. **הצפנה:**
   - TLS בכל תעבורה. [תקנה 14](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
   - הצפנה במנוחה ל־DB, לגיבויים ולקבצי אודיו. זו המלצה, לא חובה מפורשת שמצאנו.
   - הצפנה נפרדת בשדה (envelope) לסודות API של כל לקוח, כלומר Morning Client Secret ו־iCount Token.
4. **שמירה ומחיקה:**
   - מדיניות שמירה שהלקוח מגדיר לכל סוג מידע. ברירת מחדל מוצעת: מחיקת אודיו גולמי X ימים אחרי תמלול.
   - בדיקת "מידע עודף" שנתית. [תקנה 2(ג)](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
   - export ומחיקה מלאה בסיום ההתקשרות.
   - חובת השמירה של חשבוניות לצרכי מס: **unverified**. לא אומת מול מקור ראשוני בסבב הזה, ולכן לא לקבוע ערך עד שרו"ח יאשר.
5. **הרשאות:**
   - RBAC לכל עסק.
   - ספירת בעלי הרשאה. כל עוד בעסק יש 10 משתמשים לכל היותר, הוא ברמה בסיסית גם עם מידע כלכלי. [תוספת ראשונה, פס' 2(2)](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
   - ביטול גישה מיידי כשעובד עוזב.
   - 2FA (נדרש ממילא אם נתחבר ישירות לשע"ם). [נספח אבטחת מידע](https://www.gov.il/BlobFolder/service/connect-to-shaam/he/Service_Pages_shaam_Data-Security-Appendix-Statement.pdf)
6. **יידוע:** תבנית הודעת פרטיות לפי סעיף 11, שהלקוח שולח לצרכן בערוץ WhatsApp או בטופס הזמנה. [סעיף 11](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)
7. **תגובה לאירועים:**
   - תיעוד אוטומטי של אירועי אבטחה. [תקנה 11(א)](https://www.gov.il/BlobFolder/legalinfo/data_security_regulation/en/5777%E2%80%932017.pdf)
   - runbook להודעה ללקוחות, כדי שבעל השליטה יוכל לדווח לרשות "מיד".
8. **בלי ביומטריה:** לא לבנות speaker-identification או voiceprints.
9. **הפרדת מטרות:** flag מפורש בהסכם לכל שימוש משני, כמו אנליטיקה מצטברת או אימון מודלים. ברירת המחדל כבויה. [סעיף 8(ג)](https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf)

---

## שאלות פתוחות לעו"ד ולרו"ח

1. **רו"ח:** האם CraftMind, שמפיקה היום PDF של חשבונית מס עבור לקוחות, חייבת ברישום במרשם התוכנות לניהול מערכת חשבונות ממוחשבת? האם החשבוניות שהופקו עד היום תקפות? [דף השירות](https://www.gov.il/he/service/registration-software-designed-managing-computerized-accounting-system)
2. **רו"ח:** אם המסמך שלנו יהיה "חשבון עסקה" והחשבונית הרשמית תופק ב־Morning או iCount, האם יש דרישה כלשהי ממסמך ה"חשבון עסקה" שלנו, כמו מספור רציף או שמירה?
3. **רו"ח:** האם נקבע סף הקצאה ל־2027 ומעבר לו? מה נוסח החוק הסופי אחרי התיקון של 2025, כולל האיסור על ניכוי במס הכנסה?
4. **רו"ח:** מה תקופת השמירה המחייבת לחשבוניות ולמסמכי עסקה במערכת ממוחשבת, לפי הוראות ניהול פנקסים?
5. **עו"ד:** האם הקלטה קולית גולמית (בלי זיהוי דובר) היא "מידע ביומטרי" לעניין התוספת הראשונה לתקנות אבטחת מידע, ולכן מעלה את המאגר לרמה בינונית?
6. **עו"ד:** האם נתוני חשבוניות ותשלום של צרכנים פרטיים הם "מידע על פעילותו הפיננסית" של אדם, ולכן מידע בעל רגישות מיוחדת? זה משפיע על הכפלת העיצומים ועל רמת האבטחה.
7. **עו"ד:** האם CraftMind כמחזיק נחשבת "מחזיק ב־5 מאגרים" לעניין ממונה אבטחת מידע (סעיף 17ב), ובאילו תנאים תידרש למנות DPO?
8. **עו"ד:** איך סופרים "בעלי הרשאה" במאגר של לקוח כשעובדי CraftMind (תמיכה, DevOps) מקבלים גישה? האם זה עלול להעביר את הלקוח מרמה בסיסית לבינונית?
9. **עו"ד:** אירוח בחו"ל (DigitalOcean) ושימוש בספקי תמלול ו־LLM מחוץ לישראל: אילו דרישות חלות מכוח תקנות העברת מידע אל מאגרים מחוץ לגבולות המדינה? (**unverified**, לא נבדק.)
10. **עו"ד:** האם הקלטה או קליטה של תוכן WhatsApp מהלקוח הסופי מחייבת הסכמה נוספת של הכותב, מעבר להסכמה של הנמען (העסק), לפי סעיף 2(5)? ומה נדרש לפי חוק האזנת סתר אם נקליט שיחות טלפון?
11. **עו"ד:** מה הנוסח המינימלי של DPA בין CraftMind ללקוח, ומי אחראי להודעה לרשות על אירוע אבטחה חמור כשהאירוע אצלנו?
12. **מוצר ו־Morning:** האם מסמך שנוצר ב־Morning API מקבל מספר הקצאה אוטומטית כמו מסמך שנוצר ב־UI? ואיך מתנהל חידוש ההרשאה כל 3 חודשים? (לבדוק ב־Sandbox.)
13. **מוצר ו־iCount:** האם יש סביבת Sandbox, והאם `doc/create` מחזיר מספר הקצאה?

---

<a id="part-2"></a>

# חלק 2: WhatsApp Business Platform ותמלול עברית להקלטות קוליות קצרות

> נכון ל-18/09/2026. כל עובדה מקושרת למקור ראשוני: developers.facebook.com, ai.google.dev, developers.openai.com, cloud.google.com, דפי ivrit.ai ו-Hugging Face של ivrit.ai. מחירי Twilio ו-360dialog לקוחים מדפי המחירים של החברות עצמן.
> מה שלא מצאתי במקור ראשוני מסומן **unverified**. חישובים שלי מסומנים **(חישוב)**, והנחות מסומנות **(הנחה)**.
> שימו לב: Meta העבירה את התיעוד מ-`/docs/whatsapp/...` ל-`/documentation/business-messaging/whatsapp/...`. הקישורים הישנים מפנים (301) לחדשים.

## תקציר

**WhatsApp:**
- **שינוי מחירים ב-1 באוקטובר 2026, בעוד פחות משבועיים, ושם הכי קל לטעות.** עד 30/09/2026 הודעות service (לא-template בתוך חלון 24 השעות) והודעות utility שנשלחות בתוך החלון חינמיות. **מ-1/10/2026 Meta גובה על שתיהן.** הודעות service מקבלות מכסה חינמית של 1,000 הודעות שנמסרו בחודש **לכל מספר טלפון עסקי**. בישראל כל אחת מהקטגוריות marketing, utility, authentication ו-service תעלה אז ‎$0.0053 להודעה, חוץ מ-marketing שעולה ‎$0.0353 ([pricing](https://developers.facebook.com/docs/whatsapp/pricing)).
- **המלצה: להתחבר ישירות ל-Cloud API כ-Tech Provider, בלי BSP.** צריך לעבור אימות עסק ו-App Review. אחרי זה כל עסק לקוח מצטרף דרך Embedded Signup, ו-**Meta מחייבת את כרטיס האשראי של העסק ישירות**. BSP כדאי רק אם רוצים לרכז חיוב (credit line) או לדלג על App Review. יש לזה מחיר: Twilio גובה ‎$0.005 לכל הודעה נכנסת ויוצאת, ו-360dialog Partner מתחיל ב-€250 לחודש ([partners](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview), [Twilio](https://www.twilio.com/en-us/whatsapp/pricing), [360dialog](https://360dialog.com/pricing)).
- **Coexistence פותר את בעיית המספר.** טכנאי שכבר משתמש באפליקציית WhatsApp Business יכול לחבר את אותו מספר ל-Cloud API ולהמשיך לענות מהאפליקציה ([coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)). בלי coexistence, מספר שכבר רשום ב-WhatsApp חייב להימחק לפני הרישום.
- **הקלטות קוליות מגיעות כ-`audio/ogg; codecs=opus` עם `"voice": true`.** ה-URL להורדה תקף **5 דקות**, ו-media ID מ-webhook תקף **7 ימים**. לכן צריך להוריד את הקובץ מיד, מתוך job ב-BullMQ ([media](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media)).
- **אבטחת webhook:** צריך לאמת HMAC-SHA256 של ה-body הגולמי מול הכותרת `X-Hub-Signature-256`, עם ה-App Secret ([Graph webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)). Meta שולחת ניסיונות חוזרים עד 7 ימים, ולכן חובה dedupe לפי `wamid`.

**תמלול:**
- **המלצה: קריאה מולטימודלית אחת ל-Gemini.** זה ה-`gemini-3.6-flash` שכבר בשימוש בפרויקט. הקריאה מקבלת את קובץ ה-ogg ומחזירה JSON שמכיל גם את התמלול וגם את השדות המובנים. היא זולה (כ-‎$2.6 לאלף הקלטות של 30 שניות עד סוף 2026, ראו טבלה). היא מקבלת ogg ו-opus ישירות. והיא לא דורשת ספק נוסף.
- **הסיכון העיקרי: ל-Gemini אין מספר WER מפורסם לעברית.** גם ב-leaderboard של ivrit.ai הוא לא מופיע. לכן צריך להתחיל בסט הערכה קטן של הקלטות אמיתיות. אם האיכות לא מספיקה, יש שתי חלופות. הראשונה היא `gemini-3.5-transcribe` עם `custom_vocabulary` של עד 1,000 מונחים, בכ-‎$0.005 לדקה. השנייה היא מודל ivrit.ai שמתארח ב-RunPod. הוא המוביל בעברית בבנצ'מרק הקלטות WhatsApp של ivrit.ai, עם WER של 6.1%–7.5%.
- **self-hosting של ivrit.ai על השרת הנוכחי (1 vCPU, 1GB) לא אפשרי.** קובץ המשקלות של גרסת turbo לבדו שוקל 1.6GB ([HF tree](https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-ct2/tree/main)).

---

## A. WhatsApp Business Platform

### A.1 Cloud API ישירות מול BSP

**מה Meta מגדירה** ([Partners overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview)):

| | Solution Partner (BSP, למשל Twilio או 360dialog) | Tech Provider (אנחנו, ישירות) |
|---|---|---|
| מציע את כל שירותי הפלטפורמה ללקוחות | כן | כן |
| credit line, והלקוח לא מזין אמצעי תשלום | כן | **לא**. הלקוח מזין אמצעי תשלום משלו, ו-Meta מחייבת אותו ישירות |
| מחייב את הלקוחות בעצמו על השימוש ב-API | כן | לא (Meta מחייבת, ואנחנו מחייבים על שאר השירות) |
| Direct Support | כן | כן |

- Meta מציינת במפורש שהדרך להיות Solution Partner ארוכה. אם לא צריך credit line או חיוב ישיר של הלקוחות, היא ממליצה להיות Tech Provider ([Partners overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview)).
- **מה צריך כדי להיות Tech Provider** ([Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)):
  1. Meta app עם use case של WhatsApp, ו-business portfolio.
  2. **אימות עסק** (Business Verification): שם, כתובת, טלפון, אימייל ואתר, ולפעמים גם מסמכים.
  3. **App Review** עם שני סרטונים: שליחת הודעה מהאפליקציה שלנו וקבלתה ב-WhatsApp, ויצירת template. בסוף מקבלים Advanced access ל-`whatsapp_business_messaging` ול-`whatsapp_business_management`.
  4. אחרי זה: קליטת לקוחות דרך Embedded Signup, הגדרת webhooks, וכל לקוח מוסיף כרטיס אשראי.
- **Embedded Signup** יוצר אוטומטית את כל נכסי ה-WhatsApp של הלקוח (WABA ומספר) ומעניק לאפליקציה שלנו גישה אליהם. יש גם גרסה פשוטה יותר, **Hosted Embedded Signup**, שלא דורשת לארח קוד ([Partners overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview)).
- **חשוב:** Embedded Signup v2 יוצא משימוש ב-**15/10/2026**. צריך לממש ישר את v4 ([coexistence doc, warning](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)).
- Tech Provider צריך להשתמש **ב-business tokens בלבד** ([Partners overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview)).
- **עלות BSP (מדפי הספקים):**
  - Twilio: ‎$0.005 לכל הודעה, נכנסת ויוצאת, מעבר לעמלות Meta, ועוד ‎$0.001 לכל הודעה שנכשלה ([Twilio pricing](https://www.twilio.com/en-us/whatsapp/pricing)).
  - 360dialog: €49 לחודש למספר בחבילה Regular. תוכנית Partner (ISV) עולה €250 לחודש ועוד €49 לכל ערוץ, כש-5 ערוצים כלולים. לפי הדף אין תוספת על מחיר ההודעות ([360dialog pricing](https://360dialog.com/pricing)).
- **(הערכה)** עבור SaaS שמשרת הרבה עסקים קטנים עם נפח נמוך, מסלול Tech Provider זול יותר, כי אין עמלה לכל הודעה ולכל מספר. המחיר הוא עבודת onboarding חד-פעמית (אימות ו-App Review), ו-UX שבו כל עסק מזין כרטיס אשראי ב-Meta. BSP כדאי אם לא רוצים שהעסק הקטן יתעסק בחיוב של Meta, כלומר צריך credit line של Solution Partner.

### A.2 מודל התמחור (per-message) ותעריפי ישראל

**המודל הנוכחי** ([pricing](https://developers.facebook.com/docs/whatsapp/pricing)):
- מאז **1/7/2025** Meta גובה **לפי הודעה**, ולא לפי שיחה כמו קודם. חיוב נעשה רק על הודעה שנמסרה. התעריף נקבע לפי קטגוריית ה-template ולפי הקידומת הבינלאומית של הנמען.
- קטגוריות template: marketing, utility, authentication.
- **חינמי עד 30/09/2026:**
  - הודעות שהמשתמש שולח לעסק תמיד חינמיות.
  - הודעות לא-template (טקסט, תמונה וכו') בתוך חלון שירות פתוח, מאז 1/11/2024.
  - utility template שנשלח בתוך חלון שירות פתוח, מאז 1/7/2025.
  - כל ההודעות, כולל templates, בחלון Free Entry Point של 72 שעות. החלון נפתח כשמשתמש מגיע ממודעת Click-to-WhatsApp או מכפתור בדף פייסבוק, והעסק עונה תוך 24 שעות ([pricing explainer PDF, דרך דף ה-pricing](https://developers.facebook.com/docs/whatsapp/pricing)).
- **הנחות נפח:** ל-utility ול-authentication יש מדרגות לפי נפח חודשי. בישראל, utility במחיר מחירון עד 100,000 הודעות בחודש, ואחר כך ‎$0.0050 (הנחה של 5%) ([USD volume tiers CSV, דרך דף ה-pricing](https://developers.facebook.com/docs/whatsapp/pricing#rate-cards-and-volume-tiers)).
- **לוח שינויים:** Meta משנה מחירים רק ב-1 לינואר, לאפריל, ליולי ולאוקטובר. על שינוי תעריף היא מודיעה לפחות חודש מראש, ועל שינוי מודל לפחות 6 חודשים מראש ([pricing](https://developers.facebook.com/docs/whatsapp/pricing)).

**השינויים ב-1/10/2026** ([pricing, סעיפים 2–3](https://developers.facebook.com/docs/whatsapp/pricing)):
- **הודעות service יחויבו לפי הודעה**, באותו תעריף כמו utility ו-authentication באותו שוק. מתווספת **מכסה חינמית של 1,000 הודעות service שנמסרו בחודש, לכל מספר טלפון עסקי**. המכסה לא עוברת לחודש הבא.
- **הודעות utility שנשלחות בתוך חלון השירות יחויבו.** החינם שהיה בתוקף מ-1/7/2025 מבוטל.
- אם ל-WABA **אין אמצעי תשלום**, Meta תמסור הודעות service רק עד סוף המכסה החינמית, **ואחר כך לא תמסור אותן בכלל**. זה קריטי במודל Tech Provider, שבו כל לקוח משלם בעצמו.
- ב-webhook של סטטוס ההודעה, השדה `pricing.type` ישתנה ל-`regular` (עם `billable: true`) להודעות שחויבו.

**תעריפים לישראל, ב-USD להודעה** (מתוך קבצי ה-CSV הרשמיים שמקושרים מ-[pricing#rate-cards](https://developers.facebook.com/docs/whatsapp/pricing#rate-cards-and-volume-tiers). קישורי ה-CSV עצמם הם URL חתומים של fbcdn שפגים, ולכן הקישור הוא לסעיף בדף):

| קטגוריה | בתוקף מ-1/7/2026 (עכשיו) | בתוקף מ-1/10/2026 |
|---|---|---|
| Marketing | $0.0353 | $0.0353 |
| Utility | $0.0053 (חינם בתוך חלון שירות) | $0.0053 (**גם בתוך חלון שירות**) |
| Authentication | $0.0053 | $0.0053 |
| Authentication-International | n/a | n/a |
| Service | n/a (חינם) | **$0.0053** אחרי 1,000 חינמיות בחודש לכל מספר |

**(חישוב)** עלות WhatsApp לדוגמה ל-1,000 קריאות שירות בחודש, כולן על מספר אחד. כל קריאה כוללת 2 תשובות service בתוך החלון ו-2 עדכוני סטטוס כ-utility template אחרי שהחלון נסגר:
- היום: 2,000 × ‎$0.0053 = **‎$10.60**.
- מ-1/10/2026: utility ‎$10.60, ועוד service‏ (2,000 − 1,000 חינמיות) × ‎$0.0053 = ‎$5.30. סה"כ **‎$15.90**.
- כשכל עסק לקוח מחזיק מספר משלו, כל מספר מקבל 1,000 הודעות service חינמיות משלו. לעסק קטן זה כנראה מכסה את כל ה-service.

### A.3 אימות עסק, display name ודרישות מספר

- **מגבלות של portfolio לא מאומת:** 250 משתמשים ייחודיים ב-24 שעות מחוץ לחלון שירות, 2 מספרים רשומים ו-250 templates לכל WABA.
  - מגבלת ההודעות עולה ל-2,000 אחרי אימות עסק, אחרי אימות שה-partner מבצע, או אחרי 2,000 הודעות איכותיות ב-30 יום. משם היא עולה אוטומטית ל-10K, ל-100K וללא הגבלה ([messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)).
  - תקרת המספרים עולה ל-20 אחרי אימות ([phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers), [templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)).
  - מגבלת ההודעות חלה **רק על פניות יזומות, מחוץ לחלון**. לפיצ'ר שלנו, שבו הלקוח פונה ראשון, 250 כנראה מספיק בהתחלה **(הערכה)**.
  - קיים מסלול "partner-led business verification", שבו ה-partner מאמת את העסק ([messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)). **unverified:** האם הוא זמין גם ל-Tech Provider.
- **Display name:** חובה להגדיר אותו ברישום המספר. הוא עובר אימות אוטומטי כשהעסק מגיע למגבלת הודעות גבוהה יותר. תוצאת האימות מגיעה ב-webhook `phone_number_name_update`. אפשר לשנות את השם עד 10 פעמים ב-30 יום. אחרי שהשם אושר צריך לרשום את המספר מחדש תוך 14 יום ([display names](https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names)).
- **דרישות מספר:** המספר צריך להיות בבעלות העסק, עם קידומת מדינה ואזור (short codes לא נתמכים), ולהיות מסוגל לקבל SMS או שיחה. מספר נייח אפשרי אבל "Not Recommended". חובה להגדיר PIN לאימות דו-שלבי ([phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers)).
- **מספר שכבר פעיל ב-WhatsApp:** אי אפשר לרשום אותו ל-Cloud API בלי למחוק אותו קודם ([phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers)). **החריג הוא Coexistence** ([Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)):
  - מחברים חשבון קיים של אפליקציית WhatsApp Business (גרסה 2.24.17 ומעלה) ל-Cloud API דרך Embedded Signup. זמין רק ל-Solution Partner או ל-Tech Provider.
  - העסק ממשיך לענות מהאפליקציה, וההיסטוריה מסונכרנת. אפשר לסנכרן עד 6 חודשי צ'אטים ואנשי קשר.
  - מגבלות: throughput קבוע של 20 הודעות לשנייה. קבוצות, broadcast lists, הודעות נעלמות ו-view once לא נתמכים. companion devices מתנתקים וצריך לחבר אותם מחדש.
  - **חייבים לסנכרן היסטוריה תוך 24 שעות מה-onboarding.** אחרת צריך לנתק את העסק ולחזור על התהליך.
  - הודעות שנשלחות מהאפליקציה נשארות חינמיות. הודעות דרך Cloud API מחויבות.
  - חלון שירות נפתח רק על הודעות שהגיעו **אחרי** ה-onboarding.
  - **unverified:** האם Coexistence זמין בישראל. לא מצאתי במסמך רשימת מדינות.

### A.4 חלון 24 השעות ו-templates

- **חלון השירות:** הודעה או שיחה מהמשתמש פותחות טיימר של 24 שעות, וכל הודעה נוספת מאפסת אותו. כשהחלון פתוח אפשר לשלוח כל סוג הודעה חופשית. כשהוא סגור אפשר לשלוח רק templates מאושרים. אפשר לשלוח רק למשתמשים שנתנו opt-in ([send messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)).
- **(מסקנה לפיצ'ר)** "הטכנאי בדרך" או "העבודה הושלמה" נשלחים בדרך כלל שעות אחרי הפנייה, כשהחלון כבר סגור. לכן צריך **utility templates בעברית** (קוד שפה `he`, לפי [supported languages](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/supported-languages)).
- **אישור template:** ההחלטה מתקבלת תוך עד 24 שעות, בשילוב של ML ובדיקה ידנית. התוצאה מגיעה ב-webhook `message_template_status_update`. לכל משתנה חובה לצרף דוגמה ([template review](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review)).
  - סיבות דחייה נפוצות: משתנים לא רציפים או עם תווים מיוחדים, template שמתחיל או נגמר במשתנה, יותר מדי משתנים ביחס לאורך הטקסט, ו-template כפול.
- **Utility:** הודעה על עסקה או אינטראקציה ספציפית, בלי קידום מכירות, upsell או הצעות ([template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)). העסק אחראי על הקטגוריה שהוגדרה ל-template ברגע השליחה ([pricing](https://developers.facebook.com/docs/whatsapp/pricing)).

### A.5 מדיה נכנסת: תמונות והקלטות קוליות

- **webhook של אודיו:** `type: "audio"`, ובתוכו `audio.id`, `mime_type` (בדוגמה `audio/ogg; codecs=opus`), `sha256` ו-`voice: true` כשמדובר בהקלטה מתוך WhatsApp ([audio webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/audio)).
  - גם השדה `url` נכלל, אבל הוא נפרס בהדרגה מ-12/11/2025 ויכול להיות שעדיין לא זמין לכולם. לכן עדיף להסתמך על `id`.
  - תמונות מגיעות באותו מבנה, תחת `type: "image"` ([image webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/image)).
- **הורדה** ([media](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media)):
  1. `GET /<MEDIA_ID>` מחזיר `url`, `mime_type`, `sha256` ו-`file_size`.
  2. `GET <url>` עם `Authorization: Bearer` מחזיר את הקובץ הבינארי. בלי token הבקשה נכשלת.
  - ה-URL **תקף 5 דקות**. media ID שהגיע ב-webhook **תקף 7 ימים**. אם מתקבל 404, מבקשים URL חדש.
- **גדלים ופורמטים:** אודיו עד 16MB, כולל OGG עם codec של OPUS בלבד ובמונו. תמונות JPEG או PNG עד 5MB. זו טבלת "supported media types", והיא מתייחסת בעיקר לשליחה. בקבלה, הגודל המקסימלי ב-Cloud API הוא **100MB**. מעל זה מגיע webhook עם שגיאה 131052 ([media](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media)).
- **(המלצה הנדסית)** ה-webhook רק שומר את האירוע ומכניס job ל-BullMQ. ה-worker מוריד את הקובץ מיד, מאמת את ה-`sha256` ושומר אותו אצלנו, כי ה-media ID פג אחרי 7 ימים.

### A.6 אבטחת webhook

- **אימות ה-endpoint:** Meta שולחת GET עם `hub.mode=subscribe`, `hub.challenge` ו-`hub.verify_token`. צריך לוודא שה-token תואם ולהחזיר את ה-challenge ([Graph webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)).
- **חתימה:** Meta חותמת כל payload ב-SHA256 ושולחת את החתימה בכותרת **`X-Hub-Signature-256: sha256=<sig>`**. מחשבים HMAC-SHA256 על ה-payload עם ה-**App Secret** ומשווים ([Graph webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)).
  - **(המלצה)** ב-NestJS צריך `rawBody: true` ולחשב על ה-bytes הגולמיים, לא על JSON שעבר parse. ההשוואה צריכה להיות timing-safe.
- **אמינות:** payload עד 3MB. אם התשובה אינה 200, Meta מנסה שוב במשך עד 7 ימים, ולכן ייתכנו כפילויות. יש תמיכה ב-mTLS ([webhooks overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)).

---

## B. תמלול עברית להקלטות קצרות ורועשות

### B.1 Gemini API: audio understanding

- **מודל:** בפרויקט כבר משתמשים ב-`gemini-3.6-flash`. ה-Flash העדכני ביותר הוא `gemini-3.8-flash` ([models](https://ai.google.dev/gemini-api/docs/models)). ל-3.6 Flash יש קלט של אודיו, 1,048,576 טוקנים וגם יכולת thinking ([gemini-3.6-flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)).
- **קצב טוקנים:** 32 טוקנים לשניית אודיו, כלומר 1,920 לדקה. אורך מקסימלי 9.5 שעות לפרומפט. האודיו מוקטן ל-16Kbps, וערוצים מרובים מתמזגים לאחד ([audio](https://ai.google.dev/gemini-api/docs/audio)).
- **פורמטים:** בין השאר `audio/ogg` ו-`audio/opus`, וגם WAV, MP3, AAC, FLAC, M4A ו-WebM ([audio](https://ai.google.dev/gemini-api/docs/audio)). **אפשר לשלוח את קובץ ה-ogg/opus של WhatsApp בלי המרה.** עד 20MB לבקשה אפשר inline, ומעבר לזה דרך Files API.
  - **unverified:** האם ה-API מקבל את ה-mime עם הפרמטר `codecs=opus`, או שצריך לשלוח `audio/ogg` נקי. צריך לבדוק בפועל.
- **מחיר (Standard, Paid):** ל-`gemini-3.6-flash` ול-`gemini-3.8-flash` אותו מחיר ([pricing](https://ai.google.dev/gemini-api/docs/pricing)):
  - קלט: ‎$0.75 למיליון טוקנים עד 31/12/2026, ו-**‎$1.50 מ-1/1/2027**. בדף אין מחיר נפרד לאודיו.
  - פלט, כולל thinking: ‎$3.75 למיליון, ו-‎$7.50 מ-2027.
  - `gemini-3.5-flash-lite`: ‎$0.30 למיליון על כל סוגי הקלט, ו-‎$2.50 על הפלט.
  - **(חישוב)** אודיו בלבד ב-3.6 Flash: 1,920 × ‎$0.75/1M = **‎$0.00144 לדקה** בשנת 2026, ו-‎$0.00288 לדקה ב-2027.
- **פרטיות:** ב-Paid tier הנתונים "Used to improve our products: No". ב-Free tier ‏"Yes" ([pricing](https://ai.google.dev/gemini-api/docs/pricing)). **עם הקלטות של לקוחות חייבים Paid tier.**
- **דיוק בעברית:** **unverified.** לא מצאתי WER מפורסם של Google ל-Gemini Flash בעברית. Gemini גם לא מופיע ב-[leaderboard של ivrit.ai](https://huggingface.co/spaces/ivrit-ai/hebrew-transcription-leaderboard).
- **השהיה (latency):** **unverified.** אין נתון רשמי. thinking מאריך את זמן התגובה ומייקר את הפלט, ולכן כדאי להגדיר רמת thinking נמוכה.

**Gemini 3.5 Transcribe, מודל STT ייעודי שיצא באוגוסט 2026** ([model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe), [transcribe guide](https://ai.google.dev/gemini-api/docs/transcribe)):
- **עברית נתמכת במפורש** (`he-IL`), יחד עם עוד 85+ שפות וזיהוי code-switching.
- **`custom_vocabulary` של עד 1,000 מונחים**, כשהתוצאות הטובות ביותר מתקבלות עד כ-100. אי אפשר לשלב אותו עם diarization או עם timestamps. יש מצב "smart" שמסיר מילות מילוי ומנרמל מספרים.
- עד שעה לבקשה. הפורמטים כמו ב-Gemini, כולל OGG ו-Opus.
- מחיר: קלט ‎$2.00 למיליון, בהערכה ‎$0.003 לדקה. פלט ‎$12.00 למיליון, בהערכה ‎$0.002 לדקה. **כ-‎$0.005 לדקה בסך הכול**, לפי 25 טוקני אודיו לשנייה ([pricing](https://ai.google.dev/gemini-api/docs/pricing)).
- אין Batch, אין Flex, אין function calling ואין thinking. המודל מחזיר רק תמלול, ולכן חילוץ שדות מובנים דורש קריאה נוספת.

### B.2 OpenAI

- **מחירים** ([pricing](https://developers.openai.com/api/docs/pricing)):
  - `gpt-transcribe`: ‎$0.0045 לדקה. זה המודל ש-OpenAI ממליצה עליו כיום ([STT guide](https://developers.openai.com/api/docs/guides/speech-to-text)).
  - `gpt-4o-transcribe`: ‎$0.006 לדקה (טוקנים: ‎$2.50 לקלט ו-‎$10 לפלט).
  - `gpt-4o-mini-transcribe`: ‎$0.003 לדקה (‎$1.25/‎$5).
  - `whisper-1`: ‎$0.006 לדקה.
- **הטיית אוצר מילים:**
  - `gpt-transcribe` תומך ב-`prompt` (הקשר חופשי), ב-`keywords` (מונחים צפויים) וב-`languages` (רשימת שפות, ISO 639-1).
  - `gpt-4o-transcribe` ו-`gpt-4o-mini-transcribe` תומכים ב-prompt.
  - `whisper-1` תומך ב-prompt של עד **224 טוקנים**, ו-OpenAI מציינת שהוא מאפשר פחות שליטה ([STT guide](https://developers.openai.com/api/docs/guides/speech-to-text)).
- **פורמטים ומגבלות:** קובץ עד **25MB**. הפורמטים: mp3, mp4, mpeg, mpga, m4a, wav ו-webm ([STT guide](https://developers.openai.com/api/docs/guides/speech-to-text)). **ogg לא מופיע ברשימה**, ולכן צריך ffmpeg להמרה. **unverified:** האם ogg נדחה בפועל.
- **השהיה:** יש streaming של תמלול גם לקבצים שלמים, ו-Realtime transcription לשמע חי ([STT guide](https://developers.openai.com/api/docs/guides/speech-to-text)). אין נתון מספרי רשמי.
- **עברית:** Whisper כולל עברית בטבלת השפות שלו (`"he": "hebrew"` ב-[whisper/tokenizer.py](https://github.com/openai/whisper/blob/main/whisper/tokenizer.py)). OpenAI מציינת ש-Whisper תומך ב-98 שפות, אבל הדיוק משתנה משפה לשפה.
- **WER בעברית:** מתוך בנצ'מרק של ivrit.ai, בטבלה ב-B.3 ([benchmark.csv](https://huggingface.co/spaces/ivrit-ai/hebrew-transcription-leaderboard/blob/main/benchmark.csv)). `gpt-4o-transcribe` קיבל WER של 12.6% על הקלטות WhatsApp, ו-`gpt-4o-mini-transcribe` קיבל 15.8%. ל-`gpt-transcribe` אין עדיין מספר: **unverified**.

### B.3 ivrit.ai

- **מודלים** ([HF org](https://huggingface.co/ivrit-ai)):
  - `ivrit-ai/whisper-large-v3-turbo` ו-`ivrit-ai/whisper-large-v3`, בפורמט transformers.
  - גרסאות `-ct2` ל-faster-whisper, וגרסאות `-ggml` ו-`-onnx`.
  - **רישיון Apache-2.0**. זה fine-tune מאפריל 2025 על כ-4,700 שעות מהכנסת, כ-300 שעות crowd-transcribe ו-50 שעות recital. זיהוי השפה נפגע באימון, ולכן **חובה לקבע `language='he'`** ([model card turbo](https://huggingface.co/ivrit-ai/whisper-large-v3-turbo), [model card v3](https://huggingface.co/ivrit-ai/whisper-large-v3)).
  - **unverified:** הרישיון של ה-datasets הוא רישיון ivrit.ai נפרד. לא בדקתי אם הוא משפיע על שימוש מסחרי במודלים.
- **WER** מתוך [leaderboard ivrit.ai, benchmark.csv](https://huggingface.co/spaces/ivrit-ai/hebrew-transcription-leaderboard/blob/main/benchmark.csv), בעדכון 06/2026. המספרים הם שבר עשרוני, והנמוך טוב יותר. `eval-whatsapp` כולל שעה ו-10 דקות של **הקלטות WhatsApp חופשיות של מתנדבים**, ולכן הוא הכי קרוב למקרה שלנו:

| מודל | eval-whatsapp | eval-d1 (פודקאסט) | fleurs/he |
|---|---|---|---|
| ivrit-ai/whisper-large-v3-turbo-ct2-20250403 | **0.061** | 0.055 | 0.208 |
| ivrit-ai/whisper-large-v3-turbo-ct2-20250513 | 0.071 | 0.053 | 0.181 |
| ivrit-ai/whisper-large-v3-ct2-20250513 | 0.072 | 0.051 | 0.174 |
| soniox stt | 0.090 | 0.048 | 0.177 |
| amazon-transcribe batch | 0.104 | 0.066 | 0.230 |
| deepgram nova-3 | 0.120 | 0.067 | 0.233 |
| openai gpt-4o-transcribe | 0.126 | 0.073 | 0.210 |
| whisper large-v3-turbo (בסיס) | 0.128 | 0.084 | 0.289 |
| whisper large-v3 (בסיס) | 0.132 | 0.098 | 0.262 |
| openai gpt-4o-mini-transcribe | 0.158 | 0.090 | 0.300 |
| google-speech (המודל לא מצוין) | 0.352 | 0.211 | 0.385 |

  על הקלטות WhatsApp, ה-fine-tune של ivrit.ai חותך את ה-WER בערך בחצי לעומת Whisper הבסיסי: 0.061 לעומת 0.128 ב-turbo, ו-0.072 לעומת 0.132 ב-large-v3 **(חישוב)**.
- **חומרה:**
  - קובץ המשקלות של `whisper-large-v3-turbo-ct2` שוקל **1,618MB**, של `whisper-large-v3-ct2` ‏3,087MB, ושל ggml turbo ‏1,625MB ([HF tree](https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-ct2/tree/main)). ל-turbo יש 809M פרמטרים ([openai/whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo)).
  - **על שרת של 1 vCPU ו-1GB RAM זה לא ירוץ.** המשקלות לבדם גדולים מכל הזיכרון, ועל השרת כבר רצים Postgres ו-Node. זה נכון גם לפני שמביאים בחשבון את המהירות על CPU יחיד.
  - ivrit.ai מפרסמת זמנים רק ל-GPU. לקליפים של 15–30 שניות, p50 על T4 הוא 832ms ועל L4 הוא 603ms ([timing.csv](https://huggingface.co/spaces/ivrit-ai/hebrew-transcription-leaderboard/blob/main/timing.csv)). **unverified:** ביצועים על CPU.
- **אירוח:** ivrit.ai לא מפעילה API מנוהל משלה. היא ממליצה על image מוכן ב-RunPod serverless, ומצהירה על עלות של **כ-‎$0.03 לשעת תמלול** ([ivrit.ai API](https://www.ivrit.ai/en/api/)). **unverified:** cold start ב-serverless. בנפח נמוך הוא עלול להוסיף שניות רבות.
- **פורמט:** faster-whisper מפענח קבצים דרך PyAV/ffmpeg, ולכן ogg אמור לעבוד. **unverified**, כי לא מצאתי מקור של ivrit.ai.

### B.4 Google Cloud Speech-to-Text (Chirp)

- **עברית:** `iw-IL` נתמך ב-`chirp`, ב-`chirp_2` וב-`chirp_3` ([supported languages](https://cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages)).
  - chirp_3 בעברית זמין באזורים `us` ו-`eu` ותומך ב-Model adaptation.
  - Chirp 3 תומך ב-speech adaptation של עד 1,000 ביטויים ([Chirp 3](https://cloud.google.com/speech-to-text/docs/models/chirp-3)).
  - `Recognize` הסינכרוני מתאים לאודיו קצר מדקה ([Chirp 3](https://cloud.google.com/speech-to-text/docs/models/chirp-3)).
- **פורמט:** `OGG_OPUS` נתמך ישירות, בקצב דגימה של 8, 12, 16, 24 או 48kHz ([encoding](https://cloud.google.com/speech-to-text/docs/encoding)).
- **מחיר, V2** ([pricing](https://cloud.google.com/speech-to-text/pricing)):
  - "Standard": ‎$0.016 לדקה עד 500K דקות בחודש. החיוב לפי שניות ומעוגל למעלה לשנייה.
  - Dynamic batch: ‎$0.003 לדקה. העיבוד בדחיפות נמוכה, ולכן לא מתאים לתגובה מיידית.
  - לפי ההערה בדף, "Standard" כולל את `chirp`.
  - **unverified:** הדף לא מזכיר את `chirp_3` בשמו.
- **WER בעברית:** ב-leaderboard של ivrit.ai, "google-speech" קיבל 0.352 על WhatsApp, אבל **המודל לא מצוין**. לכן **unverified** אם זה Chirp 3.

### B.5 המלצה

**ההקשר שלנו:** קליפים של 10–60 שניות, נפח נמוך, ז'רגון (קבל, R32, מדחס), פלט מובנה, והפרויקט כבר עובד עם Gemini.

1. **v1: קריאה אחת ל-`gemini-3.6-flash`** עם קובץ ה-ogg (inline) ועם `responseSchema`. הפלט: `{ transcript, parts_used[], refrigerant, work_done, follow_up_needed, ... }`.
   - בפרומפט: מילון מונחים ("קבל" = capacitor, "גז R32/R410A", "מדחס", "יחידה חיצונית"...) והוראה לא להמציא ערכים.
   - רמת thinking נמוכה.
   - **היתרונות:** אין ספק חדש ואין המרת פורמט. המודל רואה את האודיו עצמו, ולכן יכול לפתור עמימות לפי ההקשר ולא רק לפי תמלול שגוי. זו גם האפשרות הזולה: כ-‎$0.0026 להקלטה של 30 שניות **(חישוב, ראו טבלה)**.
   - **החסרונות:** אין WER מפורסם בעברית. אין רשימת מונחים מובנית כמו `custom_vocabulary`. ומחיר ה-Flash מוכפל ב-1/1/2027.
2. **לשמור את `transcript` הגולמי** ולהציג לטכנאי מסך אישור לפני שמירה. כך טעויות מתגלות, וגם נאסף דאטה.
3. **סט הערכה מההתחלה:** 30–50 הקלטות אמיתיות מתוייגות ידנית. להשוות שלוש אפשרויות:
   - (א) Gemini בקריאה אחת.
   - (ב) `gemini-3.5-transcribe` עם `custom_vocabulary` ו-`language_codes: ["he-IL"]`, ואחריו חילוץ טקסטואלי ב-Flash.
   - (ג) ivrit.ai turbo ב-RunPod, ואחריו חילוץ ב-Flash.

   הבנצ'מרק החיצוני הכי רלוונטי מצביע על (ג) כמוביל בעברית של WhatsApp, עם WER של 6.1%, אבל הוא מוסיף תשתית ו-cold start.
4. **STT ואחריו LLM (שני שלבים):** כדאי לעבור אליו רק אם הבדיקה מראה ש-Gemini טועה במונחים. היתרונות: מונחים מוטים מפורשות, ותמלול דטרמיניסטי יותר. המחיר: עוד קריאה, עוד latency ועוד ספק.
5. **לא לארח מודל על השרת הנוכחי.** OpenAI ו-Google Cloud STT לא מציעים יתרון ברור על Gemini שכבר מחובר. Google STT (‏‎$0.016 לדקה) הוא היקר מביניהם.

### B.6 טבלת עלויות: 1,000 הקלטות של 30 שניות (500 דקות)

**(חישוב)** לפי המחירים שצוטטו למעלה. בקריאות ה-LLM ההנחה היא ~500 טוקני פרומפט ו-~400 טוקני פלט להקלטה, בלי thinking **(הנחה)**.

| אפשרות | תמלול | חילוץ מובנה | סה"כ ל-1,000 | הערות |
|---|---|---|---|---|
| **Gemini 3.6 Flash, קריאה אחת** (2026) | אודיו 960K טוקנים × ‎$0.75 = ‎$0.72 | טקסט ‎$0.375 + פלט ‎$1.50 | **כ-‎$2.60** | ogg ישירות |
| Gemini 3.6 Flash, קריאה אחת (מ-1/1/2027) | ‎$1.44 | ‎$0.75 + ‎$3.00 | כ-‎$5.19 | המחיר מוכפל |
| Gemini 3.5 Flash-Lite, קריאה אחת | ‎$0.29 | ‎$0.15 + ‎$1.00 | כ-‎$1.44 | איכות בעברית: unverified |
| Gemini 3.5 Transcribe ואחריו Flash | ‎$2.50 | כ-‎$2.10 | כ-‎$4.60 | custom_vocabulary |
| OpenAI gpt-transcribe ואחריו Flash | ‎$2.25 | כ-‎$2.10 | כ-‎$4.35 | צריך המרה מ-ogg |
| OpenAI gpt-4o-mini-transcribe ואחריו Flash | ‎$1.50 | כ-‎$2.10 | כ-‎$3.60 | WER ב-WhatsApp: 15.8% |
| OpenAI gpt-4o-transcribe / whisper-1 ואחריו Flash | ‎$3.00 | כ-‎$2.10 | כ-‎$5.10 | |
| Google STT V2 Standard ואחריו Flash | ‎$8.00 | כ-‎$2.10 | כ-‎$10.10 | Chirp 3: unverified |
| ivrit.ai ב-RunPod ואחריו Flash | כ-‎$0.25 | כ-‎$2.10 | כ-‎$2.35 | לפי הצהרת ivrit.ai. בלי cold start ו-idle |

בכל האפשרויות סדר הגודל זניח, כמה דולרים לחודש. **ההחלטה צריכה להיות לפי דיוק על ז'רגון ולפי פשטות, לא לפי מחיר.**

---

## שאלות פתוחות

1. **Coexistence בישראל:** האם זמין? לא מצאתי רשימת מדינות. צריך לבדוק ב-Embedded Signup בפועל, או מול Direct Support.
2. **UX של חיוב במודל Tech Provider:** האם עסק קטן יסכים להזין כרטיס אשראי ב-Meta Billing Hub? מ-1/10/2026, בלי אמצעי תשלום, הודעות service נחסמות אחרי 1,000 בחודש. אם התשובה שלילית, צריך Solution Partner עם credit line.
3. **partner-led business verification:** האם זמין ל-Tech Provider או רק ל-Solution Partner?
4. **שדה `url` ב-webhook של מדיה:** האם כבר פרוס אצלנו? עד שיתברר, להסתמך על `id` ועל `GET /MEDIA_ID`.
5. **Gemini ו-mime של WhatsApp:** האם `audio/ogg; codecs=opus` מתקבל כמו שהוא? צריך בדיקה עצמית.
6. **WER של Gemini (3.6 Flash, 3.5 Flash-Lite, 3.5 Transcribe) ושל `gpt-transcribe` בעברית:** אין נתון ראשוני. צריך סט הערכה פנימי, או לחכות לעדכון ה-leaderboard של ivrit.ai.
7. **רישיון ה-datasets של ivrit.ai:** האם הוא מגביל שימוש מסחרי במודלים שאומנו עליהם, כשהמודלים עצמם ב-Apache-2.0?
8. **cold start של RunPod serverless** עם image של ivrit.ai בנפח נמוך: כמה שניות? האם זה מקובל ל-UX של סגירת עבודה?
9. **Anthropic Claude כחלופה:** לא בדקתי אם ה-API של Claude מקבל קלט אודיו. **unverified.** אם לא, מסלול Claude מחייב STT נפרד.
10. **מחיר Gemini Flash מ-1/1/2027** מוכפל. צריך להחליט אם לנעול מודל זול יותר (Flash-Lite) לתמלול אחרי הבדיקה.

---

<a id="part-3"></a>

# חלק 3: חיפוש עסק בזמן Onboarding: Google Places API (New) ומרשם החברות

> נכון ל-18/09/2026. כל עובדה מקושרת למקור ראשוני (developers.google.com, cloud.google.com, data.gov.il, gov.il).
> מה שלא מצאתי במקור ראשוני מסומן **unverified**. בדיקות שהרצתי בעצמי מסומנות **(בדיקה עצמית)**, והן לא מחליפות מקור.

## תקציר

- **Google Places API (New) הוא המקור היחיד שמכסה את כל השדות שאנחנו צריכים** (שם, כתובת, טלפון, שעות, קטגוריה, אתר). טלפון, שעות פתיחה ואתר הם שדות **Enterprise**, בשני ה-endpoints ([data-fields](https://developers.google.com/maps/documentation/places/web-service/data-fields)).
- **המחירים אומתו:** Text Search Pro עולה ‎$32 לכל 1,000 קריאות, עם 5,000 בחינם בחודש. Place Details Enterprise עולה ‎$20 לכל 1,000, עם 1,000 בחינם. יש גם SKU שלא הופיע בשאלה ורלוונטי לנו: Place Details Enterprise + Atmosphere, ‎$25 לכל 1,000 עם 1,000 בחינם ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing)).
- **המסלול הזול ביותר:** Autocomplete (New) עם session token, שנגמר ב-Place Details אחד. כשה-session נסגר ב-Place Details ברמת Pro/Enterprise, כל בקשות ה-Autocomplete בו חינמיות, ו-Place Details מחויב כ-Enterprise + Atmosphere, כלומר ‎$0.025 ל-onboarding אחרי המכסה החינמית ([session-pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing)). המסלול החלופי, Text Search Pro ואחריו Place Details Enterprise, עולה ‎$0.052.
- **אחסון:** מותר לשמור `place_id` ללא הגבלת זמן. קואורדינטות מותר לשמור עד 30 יום. שאר תוכן Google Maps אסור לשמור. תנאי השימוש אוסרים במפורש "copy and save business names, addresses". **אף מקור ראשוני לא מתייחס לשמירת ערכים שבעל העסק עצמו אישר.** זו שאלה משפטית פתוחה.
- **מרשם החברות (data.gov.il):** מאגר `ica_companies` מתעדכן מדי יום, וניתן לחפש בו דרך CKAN `datastore_search`. הוא מכסה **חברות בלבד**, לא עוסקים מורשים או פטורים. הרישיון מתיר שימוש מסחרי בתנאי שמציינים את המקור.
- **עוסק מורשה/פטור:** לא מצאתי מאגר פתוח או API. לרשות המסים יש שירות מקוון שמחפש **לפי מספר עוסק** בלבד, לא לפי שם. בבדיקה היום הקישור הוביל לדף כניסה לאזור האישי.

---

## A. Google Places API (New)

### A.1 שדה ל-SKU (Text Search ו-Place Details)

טבלת המקור הרשמית: [Place Data Fields (New)](https://developers.google.com/maps/documentation/places/web-service/data-fields).

| שדה | Text Search (New) | Place Details (New) |
|---|---|---|
| `id` | Text Search Essentials (IDs Only) | Place Details Essentials (IDs Only) |
| `displayName` | Text Search **Pro** | Place Details **Pro** |
| `formattedAddress` | Text Search Pro | Place Details **Essentials** |
| `location` | Text Search Pro | Place Details Essentials |
| `types` | Text Search Pro | Place Details Essentials |
| `primaryType` | Text Search Pro | Place Details Pro |
| `businessStatus` | Text Search Pro | Place Details Pro |
| `nationalPhoneNumber` / `internationalPhoneNumber` | Text Search **Enterprise** | Place Details **Enterprise** |
| `regularOpeningHours` | Text Search Enterprise | Place Details Enterprise |
| `websiteUri` | Text Search Enterprise | Place Details Enterprise |
| `attributions` | Text Search Essentials (IDs Only) | Place Details Essentials (IDs Only) |

([data-fields](https://developers.google.com/maps/documentation/places/web-service/data-fields))

- רשימת השדות ב-Text Search Essentials (IDs Only) היא Name (שם המשאב `places/…`), `id`, Photos, Consumer alert, Moved place, Moved place ID, Attributions ו-Next page token. **`displayName` לא נכלל בה**, ולכן אי אפשר להציג רשימת מועמדים בחינם ([data-fields](https://developers.google.com/maps/documentation/places/web-service/data-fields)).
- החיוב הוא לפי ה-SKU הגבוה ביותר שהשדות המבוקשים מפעילים: "You are then billed at the highest SKU applicable to your request" ([usage-and-billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)).
- Field mask הוא חובה ב-Text Search: "There is no default list of returned fields in the response. If you omit the field mask, the method returns an error" ([text-search](https://developers.google.com/maps/documentation/places/web-service/text-search)).

### A.2 מחירים ומכסות חינמיות (מדרגה ראשונה, עד 100,000 בחודש)

מקור: [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing). העמוד עודכן לאחרונה ב-2026-09-16.

| SKU | מכסה חינמית בחודש | מחיר ל-1,000 | אימות |
|---|---|---|---|
| Text Search Essentials (IDs Only) | Unlimited | ללא חיוב | |
| Text Search Pro | 5,000 | ‎$32.00 | **אומת** |
| Text Search Enterprise | 1,000 | ‎$35.00 | |
| Place Details Essentials (IDs Only) | Unlimited | ללא חיוב | |
| Place Details Essentials | 10,000 | ‎$5.00 | |
| Place Details Pro | 5,000 | ‎$17.00 | |
| Place Details Enterprise | 1,000 | ‎$20.00 | **אומת** |
| Place Details Enterprise + Atmosphere | 1,000 | ‎$25.00 | |
| Autocomplete Requests | 10,000 | ‎$2.83 | |
| Autocomplete Session Usage | Unlimited | ללא חיוב | |

- המכסות החינמיות נמדדות לכל SKU בנפרד ולכל חודש: "If your application generates requests or map load volumes up to the free usage cap for a given month, your usage is not charged" ([FAQ](https://developers.google.com/maps/faq)).

### A.3 דפוס הקריאות הזול והנכון

**אפשרות 1 (מומלצת): Autocomplete (New) עם session token, ואחריו Place Details (New)**
- Autocomplete (New) מחזיר בברירת מחדל "businesses, addresses and points of interest". כל תחזית כוללת `placeId`, `text` ו-`structuredFormat` (`mainText`/`secondaryText`). מספיק להציג את השם והכתובת בלי קריאה נוספת ([place-autocomplete](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete)).
- אפשר להגביל לישראל עם `includedRegionCodes` ("Array of up to 15 two-character country codes to restrict results to"). אפשר לסנן לפי סוג עם `includedPrimaryTypes`, עד 5 סוגים ([place-autocomplete](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete)).
- **חיוב session** ([session-pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing)):
  - כשה-session נסגר ב-Place Details ברמת Pro/Enterprise, כל בקשות ה-Autocomplete מחויבות ב-Autocomplete Session Usage (חינם). הבקשה הסוגרת: "Place Details (New) terminating requests are billed at SKU: Place Details Enterprise + Atmosphere, regardless of the fields requested."
  - כשה-session נסגר ב-Place Details Essentials, 12 הבקשות הראשונות מחויבות כ-Autocomplete Requests, ומהבקשה ה-13 הן חינמיות.
  - session שננטש (בלי Place Details) מחויב לפי בקשה: "Autocomplete (New) requests revert to the per-request pricing model."
  - שימוש חוזר ב-token או השמטתו גורמים לחיוב כל בקשה בנפרד ([place-session-tokens](https://developers.google.com/maps/documentation/places/web-service/place-session-tokens)).
  - המסמכים מזכירים רק Place Details (New) ו-Address Validation כבקשות שסוגרות session. **Text Search לא סוגר session** (unverified: אין לכך ניסוח מפורש, רק היעדר אזכור).
- **עלות ל-onboarding שהושלם:** ‎$0.025 (Enterprise + Atmosphere), עם 1,000 חינם בחודש.

**אפשרות 2: Text Search Pro ואחריו Place Details Enterprise**
- Text Search עם field mask מינימלי `places.id,places.displayName,places.formattedAddress` מחויב כ-Text Search Pro ($32, עם 5,000 חינם). המשתמש בוחר מועמד, ואז Place Details על המועמד שנבחר בלבד עם `nationalPhoneNumber,regularOpeningHours,websiteUri,primaryType,businessStatus,...` מחויב כ-Place Details Enterprise ($20, עם 1,000 חינם) ([data-fields](https://developers.google.com/maps/documentation/places/web-service/data-fields), [pricing](https://developers.google.com/maps/billing-and-pricing/pricing)).
- `pageSize` בין 1 ל-20. בלי `locationBias`/`locationRestriction` ה-API מפעיל IP biasing ([text-search](https://developers.google.com/maps/documentation/places/web-service/text-search)). כשהמשתמש נותן עיר, כדאי להכניס אותה לשאילתה ("<שם עסק> <עיר>").
- **עלות:** ‎$0.052 ל-onboarding, או יותר אם המשתמש מחפש כמה פעמים.
- יתרון: חיפוש אחד מבוסס טקסט חופשי. חיסרון: יקר פי 2 בערך.

**בשני המסלולים:** לא לבקש שדות Enterprise ברשימת המועמדים. לבקש אותם רק ב-Place Details על המקום שנבחר.

**רענון `place_id`:** Place Details עם field mask של `id` בלבד חינמי, ומומלץ לרענן מזהים בני יותר מ-12 חודשים ([place-id](https://developers.google.com/maps/documentation/places/web-service/place-id)).

**קטגוריה:** ברשימת Place Types יש `electrician`, `plumber`, `general_contractor` ו-`roofing_contractor`, אבל **אין סוג ייעודי למיזוג אוויר/HVAC** (בדיקה עצמית של [place-types](https://developers.google.com/maps/documentation/places/web-service/place-types): המחרוזות `hvac` ו-`air_condition` לא מופיעות בעמוד). לכן `primaryType` כנראה לא יחזיר "מיזוג אוויר". ההערכה הזו unverified.

### A.4 תמיכה בעברית

- קוד השפה הרשמי לעברית ברשימת השפות הנתמכות הוא **`iw`** ("iw | Hebrew") ([FAQ, supported languages](https://developers.google.com/maps/faq#languagesupport)).
- Text Search: "If you specify an invalid language code, the API returns an `INVALID_ARGUMENT` error". "If a name is not available in the preferred language, the API uses the closest match". ברירת המחדל היא `en` ([text-search](https://developers.google.com/maps/documentation/places/web-service/text-search)).
- Autocomplete (New): `languageCode` הוא קוד IETF BCP-47, וברירת המחדל שלו היא Accept-Language או `en` ([place-autocomplete](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete)).
- **האם `he` מתקבל כמו `iw`: unverified.** הרשימה הרשמית מציגה רק `iw`. מומלץ לשלוח `iw` או לבדוק בפועל.
- `regionCode` הוא קוד CLDR בן שני תווים. הוא משפיע על עיצוב הכתובת ועל הדירוג, ואם המדינה בכתובת זהה ל-regionCode, שם המדינה יושמט מ-`formattedAddress` ([text-search](https://developers.google.com/maps/documentation/places/web-service/text-search)).
- **כיסוי עסקים קטנים בישראל: unverified.** לא מצאתי מקור ראשוני שמתייחס לכך.

### A.5 תנאים: אחסון, attribution, ערכים מאושרים

**ציטוטים מתנאי השירות** ([Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms), גרסה מ-26/08/2026):
- סעיף 3.2.3(a) No Scraping: "Customer will not export, extract, or otherwise scrape Google Maps Content for use outside the Services. For example, Customer will not: (i) pre-fetch, index, store, reshare, or rehost Google Maps Content outside the services; … (iii) copy and save business names, addresses, or user reviews".
- סעיף 3.2.3(b) No Caching: "Customer will not cache Google Maps Content except as expressly permitted under the Maps Service Specific Terms."
- סעיף 3.2.3(c)(vii) אוסר "use Google Maps Content to improve machine learning and artificial intelligence models, including to train, test, validate or fine-tune the models."
- ההגדרה של "Google Maps Content": "any content provided through the Services … including … places data (including business listings)."

**ציטוטים מה-Service Specific Terms** ([Maps Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms), גרסה מ-10/06/2026):
- סעיף A.3, Google ID Caching: "Customer may cache the Google ID values … For example, Customer may cache (a) place_id from Places API".
- סעיף 14.1: "Customer may use Google Maps Content from the Places API in Customer Applications without a corresponding Google Map."
- סעיף 14.2: "Customer must not use Google Maps Content from the Places API in conjunction with a non-Google map."
- סעיף 14.3: "Customer may temporarily cache latitude and longitude values from the Places API for up to 30 consecutive calendar days, after which Customer must delete the cached latitude and longitude values."

**Place ID:** "The place ID is exempt from the caching restrictions. You can therefore store place ID values indefinitely" ([Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)). Place IDs פטורים מסעיף 3.2.3(b), ומומלץ לרענן מזהים בני יותר מ-12 חודשים ([place-id](https://developers.google.com/maps/documentation/places/web-service/place-id)).

**Attribution בלי מפה** ([Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)):
- "Attribution should take the form of the Google Maps logo whenever possible. In cases where space is limited, the text Google Maps is acceptable." יש דרישות עיצוב לטקסט: Roboto או sans-serif, משקל 400, ניגודיות 4.5:1.
- כשמוחזרים third-party attributions: "only including 'Google Maps' or the Google logo is not proper attribution"
- לכן צריך להציג "Google Maps" (לוגו או טקסט) ליד רשימת המועמדים ולצד כל שדה שהוצע מגוגל. זה גם מתאים לדרישת המוצר "suggestion with its source".

**שמירת ערכים שבעל העסק אישר: unverified, שאלה משפטית פתוחה.**
- אף מקור ראשוני שמצאתי לא מתייחס למקרה שבו משתמש קצה מאשר או עורך נתון שהגיע מ-Places ושומר אותו כנתון שלו.
- הניסוח של 3.2.3(a)(iii) רחב, והוא אוסר "copy and save business names, addresses". ההגדרה של Google Maps Content כוללת במפורש "business listings". פרשנות שמרנית: שמירת ערך כפי שהתקבל מגוגל אסורה גם אם המשתמש לחץ "אישור".
- מה שבטוח לפי הטקסט: לשמור `place_id` לתמיד. לשמור `location` עד 30 יום. להציג את השאר רק לצורך המילוי בזמן ה-session.
- **מומלץ לקבל ייעוץ משפטי**, או לפנות ל-Google Maps Platform sales/support לפני שמירת ערכים שמקורם ב-Places.

**שימוש ב-LLM:** 3.2.3(c)(vii) אוסר אימון, בדיקה או fine-tune של מודלים על Google Maps Content. לא מצאתי מקור שמתייחס להעברת Google Maps Content כקלט ל-LLM בזמן inference, ולכן זה unverified. המלצה: לשלוח ל-Gemini רק את תוכן אתר העסק עצמו, לא נתונים מ-Places.

### A.6 חיוב ובקרת עלויות

- חשבון חיוב הוא חובה גם בתוך המכסה החינמית: "To use Google Maps Platform products, you must have a billing account, and all requests must include a valid API key" ([FAQ](https://developers.google.com/maps/faq)).
- **Budget לא עוצר שימוש:** "Setting a budget does _not_ automatically cap Google Cloud or Google Maps Platform usage or spending" ([manage-costs](https://developers.google.com/maps/billing-and-pricing/manage-costs)). Budget הוא התראה בלבד.
- **Quota הוא התקרה האמיתית:** "Quota limits help you control your API usage and prevent unexpected charges by capping the number of requests your project can make… they can be increased or decreased" ([manage-costs](https://developers.google.com/maps/billing-and-pricing/manage-costs)). מומלץ להגדיר requests-per-day נמוך ל-Places API (New) ב-Cloud Console, יחד עם budget alert.
- "You are financially responsible for charges caused by abuse of unrestricted API keys", ולכן צריך להגביל את המפתח ([manage-costs](https://developers.google.com/maps/billing-and-pricing/manage-costs)). כדאי שכל הקריאות יעברו דרך השרת שלנו, עם מפתח מוגבל ל-Places API (New) בלבד וב-IP restriction.
- "Setting a quota too low can impact your ability to use the API, which could cause a user-facing outage" ([manage-costs](https://developers.google.com/maps/billing-and-pricing/manage-costs)). ה-UI צריך לאפשר מעבר חלק להזנה ידנית.

---

## B. מרשם החברות (data.gov.il) ועוסקים

### B.1 מאגר רשם החברות

- **Dataset:** `ica_companies`, "מאגר חברות - רשם החברות", של משרד המשפטים ([dataset](https://data.gov.il/dataset/ica_companies)).
- **Resource (CSV + datastore):** `f004176c-b85f-4542-8901-7b3176f9a054`, "רשימת החברות" ([package_show API](https://data.gov.il/api/3/action/package_show?id=ica_companies)).
- **תדירות עדכון:** `Frequency: Day`, `Update: Automat`. העדכון האחרון של המשאב היה 2026-09-18T01:12 ([package_show API](https://data.gov.il/api/3/action/package_show?id=ica_companies)).
- **תוכן, לפי תיאור ה-dataset:** המאגר כולל חברות בסטטוסים פעילה, בפירוק, מחוקה, מחוסלת ועוד. "הקובץ כולל את מספר התאגיד, שם התאגיד, שם התאגיד באנגלית, סוג התאגיד, סטטוס התאגיד, תת סטטוס התאגיד, תיאור התאגיד, מטרת התאגיד, תאריך התאגדות, מגבלות, מפרה, דוח שנתי וכתובת" ([package_show API](https://data.gov.il/api/3/action/package_show?id=ica_companies)).
- **שדות ה-datastore** ([datastore_search](https://data.gov.il/api/3/action/datastore_search?resource_id=f004176c-b85f-4542-8901-7b3176f9a054&limit=1)):
  - `מספר חברה`, `שם חברה`, `שם באנגלית`
  - `סוג תאגיד`, `סטטוס חברה`, `תת סטטוס`, `תאור חברה`, `מטרת החברה`
  - `תאריך התאגדות`, `חברה ממשלתית`, `מגבלות`, `מפרה`, `שנה אחרונה של דוח שנתי (שהוגש)`
  - `שם עיר`, `שם רחוב`, `מספר בית`, `מיקוד`, `ת.ד.`, `מדינה`, `אצל`
  - קודים: `קוד סטטוס חברה`, `קוד סוג חברה`, `קוד ישוב`, `קוד רחוב` ועוד
  - בבדיקה היו במאגר 731,237 רשומות (בדיקה עצמית).
- **הערות מעשיות (בדיקה עצמית):**
  - גרשיים בשמות מוחלפים ב-`~`, למשל "בע~מ". צריך לנרמל לפני השוואה.
  - אין טלפון, אתר או שעות פתיחה.
  - הכתובת היא הכתובת הרשומה. השדה `אצל` מרמז שלעתים זו כתובת של רו"ח או עו"ד, ולא בהכרח כתובת העסק (הסקה, unverified).
- **API** ([data.gov.il CKAN API docs](https://data.gov.il/docs)): "Read-only endpoints (*_show, *_list, *_search etc.) accept GET requests with query parameters". ברשימת ה-endpoints המתועדים מופיע `datastore_search`, ו-**`datastore_search_sql` לא מופיע**. בבדיקה עצמית הוא החזיר דף שגיאה.
- **דוגמאות (נבדקו ועבדו):**
  ```
  # חיפוש טקסט חופשי לפי שם
  GET https://data.gov.il/api/3/action/datastore_search
      ?resource_id=f004176c-b85f-4542-8901-7b3176f9a054
      &q=מיזוג אוויר
      &limit=10
      &fields=מספר חברה,שם חברה,סטטוס חברה,שם עיר,שם רחוב,מספר בית

  # חיפוש מדויק לפי מספר חברה
  GET .../datastore_search?resource_id=f004176c-...&filters={"מספר חברה":510000011}
  ```
  (ב-URL צריך לקודד את העברית ב-URL-encoding.) השאילתה `q=מיזוג אוויר` החזירה 220 תוצאות, כולל חברות לא פעילות. צריך לסנן בצד שלנו לפי `סטטוס חברה = פעילה`, או להוסיף `filters={"סטטוס חברה":"פעילה"}`.

### B.2 תנאי שימוש ומגבלות קצב של data.gov.il

מקור: [תנאי שימוש Data.Gov.il](https://data.gov.il/he/terms-of-use), עודכן ב-30/08/2025.
- "השימוש במאגרי המידע … אינו כפוף לתנאי השימוש, אלא לרישיון השימוש המובא להלן."
- "רישיון עולמי, ללא תמלוגים, בלתי מוגבל בזמן ולא בלעדי."
- **שימוש מסחרי מותר:** "אתה רשאי לעשות שימוש במידע באופן מסחרי ובאופן שאינו מסחרי."
- **ציון מקור:** "בשימוש במידע, עליך לציין את מקור המידע." יש חריג לנתונים שנשאבו כשהשימוש "איננו שומר על המקוריות בבחירה ובסידור של הנתונים שבמקור".
- **שימושים אסורים (רלוונטי):** "לעשות שימוש שיביא לפגיעה בפרטיותו של אדם, לרבות על ידי הצלבת המידע עם מקורות מידע אחרים."
- **אחריות:** המידע מסופק "כמות שהוא" (as is). במקרה של סתירה, הפרסומים הרשמיים גוברים.
- **Rate limits: unverified.** בתנאי השימוש ובתיעוד ה-API לא מופיעה מגבלת קצב. בבדיקה עצמית, דפי HTML של האתר חסמו בקשות שאינן מדפדפן (CloudFront 403), ואילו ה-API עצמו ענה ל-curl. צריך להיערך ל-429/403 ולשמור cache בצד שלנו, כי המאגר מתעדכן פעם ביום.

### B.3 עוסק מורשה / עוסק פטור

- **יש שירות רשמי, לפי מספר בלבד:** "השירות מאפשר לקבל באופן מקוון את פרטי העוסק המורשה או הפטור, לפי מספר העוסק. הפרטים שיוצגו הינם: שם העוסק, כתובת העסק והאם הוא רשום כעוסק מורשה במרשמי מס ערך מוסף." השירות "ניתן לכל מי שרוצה לברר" ו"ללא עלות" ([gov.il, בקשה לקבלת פרטי עוסק מורשה](https://www.gov.il/he/service/vat-apply-online)).
- **אין חיפוש לפי שם.** המקור מציין "לפי מספר העוסק" בלבד.
- **API: לא נמצא (unverified שאינו קיים).** לא מצאתי תיעוד API ציבורי. חיפוש ב-data.gov.il ("עוסק מורשה", "מע"מ עוסק") החזיר 0 מאגרים (בדיקה עצמית, [package_search](https://data.gov.il/api/3/action/package_search?q=%D7%A2%D7%95%D7%A1%D7%A7%20%D7%9E%D7%95%D7%A8%D7%A9%D7%94)).
- **בבדיקה עצמית היום:** הקישור הישן `taxinfo.taxes.gov.il/emosek/wHzanatTik.aspx` מפנה ל-`secapp.taxes.gov.il/sr-ezor-ishi/main/pirtey-osek`, שמציג דף "כניסה לשירותי הדיגיטל" עם מספר זהות וקוד משתמש. כלומר השירות נראה כרגע מאחורי התחברות. לא ניסיתי להתחבר.
- **מסקנה:** אין מקור רשמי שמאפשר למצוא עוסק מורשה או פטור לפי שם. לרוב הלקוחות שלנו, שהם עוסקים, Google Places הוא המקור היחיד לחיפוש לפי שם.

---

## C. המלצה

### תהליך מומלץ
1. **שדה "שם העסק".** בכל הקלדה (עם debounce) נשלחת קריאת Autocomplete (New) דרך השרת שלנו, עם `sessionToken` חדש לכל onboarding, `includedRegionCodes:["il"]`, `languageCode:"iw"` ו-`regionCode:"il"`. אם המשתמש הזין עיר, מוסיפים אותה לטקסט או ל-`locationBias`.
2. **הצגת מועמדים:** `mainText` ו-`secondaryText`, עם לוגו או טקסט "Google Maps".
3. **בחירה:** קריאת Place Details (New) אחת עם **אותו session token** ו-field mask `id,displayName,formattedAddress,addressComponents,nationalPhoneNumber,regularOpeningHours,websiteUri,primaryType,types,businessStatus`. היא מחויבת כ-Enterprise + Atmosphere, ‎$25 לכל 1,000 עם 1,000 חינם בחודש.
4. **הצגה כהצעות:** כל שדה מסומן "מקור: Google Maps", וניתן לעריכה.
5. **אם זו חברה בע"מ (אופציונלי):** מציעים "מצאנו גם במרשם החברות". קריאת `datastore_search` ל-`ica_companies` לפי השם או לפי ח"פ שהמשתמש מזין מחזירה ח"פ, סטטוס וכתובת רשומה, עם "מקור: רשם החברות, data.gov.il". זה חינמי, ומותר לשמור בכפוף לציון המקור.
6. **אתר ו-Gemini:** אם יש `websiteUri`, השרת מביא את דף הבית של העסק, ו-Gemini מחלץ ממנו שירותים כהצעות. שולחים ל-Gemini רק את תוכן האתר, לא נתוני Places.
7. **שמירה:** שומרים `place_id` תמיד (מותר). את שאר השדות שומרים רק אחרי אישור, ורק בכפוף להכרעה המשפטית שבשאלות הפתוחות. חלופה זהירה: שומרים את מה שהמשתמש **הקליד או ערך** בעצמו, ולא מעתיקים ערכים שהגיעו מגוגל כמות שהם. לא שומרים `location` יותר מ-30 יום.
8. **Fallback:** אם אין תוצאה או שה-quota נגמר, עוברים להזנה ידנית.

### עלות צפויה ל-onboarding
- **מסלול מומלץ:** ‎$0.025 לכל onboarding שהושלם. עד 1,000 onboardings בחודש המחיר $0. Session שננטש עולה ‎$0.00283 לכל בקשת Autocomplete, אחרי 10,000 בקשות חינם בחודש ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [session-pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing)).
- **מסלול חלופי (Text Search Pro + Details Enterprise):** ‎$0.052 לכל onboarding, עם 5,000 ו-1,000 קריאות חינם בחודש בהתאמה.
- **data.gov.il:** $0.
- **Gemini:** מחוץ לתחום המחקר הזה ולא אומת.

### אילוצים משפטיים על אחסון (סיכום)
| נתון | מותר לשמור? | מקור |
|---|---|---|
| `place_id` | כן, ללא הגבלת זמן | [Service Terms A.3](https://cloud.google.com/maps-platform/terms/maps-service-terms), [policies](https://developers.google.com/maps/documentation/places/web-service/policies) |
| lat/lng מ-Places | עד 30 יום רצופים | [Service Terms 14.3](https://cloud.google.com/maps-platform/terms/maps-service-terms) |
| שם, כתובת ושאר תוכן Places | לא (3.2.3(a)(iii), 3.2.3(b)). אישור של הבעלים: **unverified** | [ToS](https://cloud.google.com/maps-platform/terms) |
| הצגת נתוני Places על מפה שאינה של Google | אסור | [Service Terms 14.2](https://cloud.google.com/maps-platform/terms/maps-service-terms) |
| נתוני רשם החברות | כן, כולל שימוש מסחרי, עם ציון מקור | [data.gov.il terms](https://data.gov.il/he/terms-of-use) |

---

## שאלות פתוחות
1. **האם מותר לשמור ערכים מ-Places אחרי שבעל העסק אישר אותם?** אין מקור ראשוני שעונה על זה. צריך ייעוץ משפטי או פנייה ל-Google.
2. האם `languageCode=he` מתקבל, או רק `iw`? (unverified. הרשימה הרשמית מציגה `iw`.)
3. איך נראה הכיסוי של עסקי מיזוג אוויר קטנים בישראל ב-Google Places, ובאיכות עברית? צריך פיילוט של כ-50 עסקים אמיתיים.
4. אין Place Type ל-HVAC. צריך להחליט איך ממפים `types` לקטגוריה שלנו.
5. מגבלות קצב של data.gov.il אינן מתועדות (unverified).
6. האם שירות "פרטי עוסק" של רשות המסים חזר להיות פתוח בלי התחברות, ואם יש API לגופים מורשים? לא נמצא.
7. האם מותר להעביר Google Maps Content כקלט ל-LLM בזמן inference, כשלא מדובר באימון? (unverified. לכן ההמלצה היא לא להעביר.)
8. Autocomplete (New) מחזיר גם כתובות, לא רק עסקים. האם לסנן לפי `includedPrimaryTypes`, ואיזה סוג מתאים לטכנאי מיזוג? תלוי בשאלה 4.

---
