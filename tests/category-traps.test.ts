import { expect, test } from "bun:test";
import { placeOf } from "../src/shared/categories.ts";
import { TAXONOMY } from "../src/shared/taxonomy.ts";

const at = (name: string) => { const p = placeOf({ name, is_weighted: false, unit_qty: "יחידה" }); return p ? `${p.cat}/${p.sub}` : null; };

test("מלכודות ידועות: המילה הראשונה קובעת", () => {
  expect(at("שוקולד חלב עלית")).toBe("snacks/choc");
  expect(at("שוקולד לבן")).toBe("snacks/choc");
  expect(at("יין לבן חצי יבש")).toBe("alcohol/wine");
  expect(at("מיץ תפוחים טבעי")).toBe("drinks/juice");
  expect(at("חומץ תפוחים")).toBe("pantry/oil");
  expect(at("שמן גוף ניוואה")).toBe("care/skin");
  expect(at("דגני בוקר קורנפלקס")).toBe("breakfast/cereal");
  expect(at("אטריות ביצים דקות")).toBe("pantry/pasta");
  expect(at("מרק עוף אמיתי")).toBe("pantry/soups");
  expect(at("גלידת קפה")).toBe("frozen/icecream");
  expect(at("סבון כלים לימון")).toBe("cleaning/dishes");
  expect(at("מי פנים לניקוי")).toBe("care/skin");
  expect(at("יוגורט בטעם תות")).toBe("dairy/yogurt");
});
test("מילים שלמות בלבד, עם אותיות שימוש", () => {
  expect(at("חלבון מי גבינה")).not.toBe("dairy/milk");
  expect(at("דגנים מלאים")).not.toBe("meat/fish");
  expect(at("והגבינה הלבנה")).toBe("dairy/cheese");
  // אותיות שימוש רק לפני מילה של 4+ אותיות: "שברי" אינו "ש+ברי"
  expect(at("שברי בייגלה סניידרס")).not.toBe("dairy/yellow");
});
test("מילים כלליות בתחילת השם לא קובעות", () => {
  expect(at("חטיף סניקרס Snickers")).toBe("snacks/choc");
  expect(at("חטיף קינדר טריס")).toBe("snacks/choc");
  expect(at("משקה שוקו יטבתה")).toBe("dairy/drinks");
  expect(at("מלטיזרס כדורים פריכים")).toBe("snacks/choc");
  expect(at("קפסולות לכביסה אריאל")).toBe("cleaning/laundry");
  expect(at("קפסולות למדיח פיניש")).toBe("cleaning/dishes");
  expect(at("נמס בכוס מרק פטריות")).toBe("pantry/soups");
  expect(at("קרם קרקר")).toBe("bakery/crackers");
  expect(at("מגבונים האגיס בישום")).toBe("baby/wipes");
  expect(at("מרכך תמציות אלוורה לשיער רגיל")).toBe("care/hair");
});
test("רמזי מותג ויחידה", () => {
  expect(at("האגיס פרידום דריי")).toBe("baby/diapers");
  expect(at("חטיף לכלב בטעם עוף")).toBe("pets/dogs");
  expect(at("מרכך כביסה לתינוקות")).toBe("cleaning/laundry");
  expect(at("בונבוניירה פרמיום")).toBe("snacks/sweets");
});
test("ירקות מעובדים לא במדף הטרי", () => {
  expect(at("עגבניות מרוסקות 400")).toBe("pantry/cans");
  expect(at("תרד קפוא 800 גרם")).toBe("frozen/veg");
  expect(placeOf({ name: "עגבניות שרי", is_weighted: true })?.cat).toBe("produce");
});
test("מוטב בלי שיוך מאשר שיוך שגוי", () => {
  expect(at("מברג פיליפס")).toBeNull();
  expect(at("סלט ביצים")).toBe("deli/salads");
});
test("כל מילת מפתח שייכת לתת-מחלקה אחת", () => {
  const seen = new Set<string>();
  for (const d of TAXONOMY) for (const s of d.subs) for (const k of s.kw) { expect(seen.has(k)).toBe(false); seen.add(k); }
  expect(TAXONOMY.length).toBeGreaterThanOrEqual(20);
});

// מלכודות שנמצאו בסבב הדיוק (300 + 200 דגימות ו־3,000 המוצרים הנפוצים)
test("מותג של מחלקה אחת לא גורר מוצר ממחלקה אחרת", () => {
  expect(at("דאב דאודורנט ספריי בניחוח טלקום")).toBe("care/deo");
  expect(at("דאו' רולאון ניוואה 50")).toBe("care/deo");
  expect(at("פלמוליב נטורלס חלב 750")).toBe("care/bath");
  expect(at("קמיל בלו סנסיטיב אל סבון שיבולת")).toBe("baby/care");
  expect(at("קרליין 10 קרם לחות לשיער מתולתל")).toBe("care/hair");
  expect(at("מוסטלה קרם לחות לפנים")).toBe("care/skin");
  expect(at("גילט דאודורנט ג'ל קול ווייב")).toBe("care/deo");
  expect(at("פרמיו בקר וכבד לחתול")).toBe("pets/cats");
  expect(at("פנסי פיסט גורמה עוף")).toBe("pets/cats");
});
test("מרכך: כביסה רק כשיש רמז לכביסה", () => {
  expect(at("מרכך Color Protect מטפח ומגן")).toBe("care/hair");
  expect(at("כיף מרכך לחות מוגברת")).toBe("care/hair");
  expect(at("מרכך בבישום עוצמתי סנו מקסימה")).toBe("cleaning/laundry");
  expect(at("לנור מרכך כביסה מרוכז")).toBe("cleaning/laundry");
});
test("מילה במשמעות אחרת", () => {
  expect(at("איטריות ביצים פטוצ'יני")).toBe("pantry/pasta");
  expect(at("כריות לניקוי כלים")).toBe("cleaning/dishes");
  expect(at("סחלב פלנופסיס")).toBeNull();
  expect(at("פילה עוף אמיתי")).not.toBe("meat/fish");
  expect(at("משקה תפוחים מוגז ללא סוכר")).toBe("drinks/soft");
  expect(at("קיווי משחת נעליים שחור")).toBe("cleaning/home");
  expect(at("כדוריות הבושם בניחוח לנור")).toBe("cleaning/laundry");
  expect(at("מולטי גין אקטיגל")).toBe("care/fem");
  expect(at("חטיף פוף כוכבי שמנת בצל")).toBe("snacks/salty");
  expect(at("מש.שיניים לילדים")).toBe("care/oral");
  expect(at("אוזנית מונסטר")).toBe("home/electronics");
  expect(at("צנטרום נשים מולטיויטמין 60 טבליות")).toBe("health/vitamins");
});
test("קפוא וסנפרוסט הם ירקות קפואים", () => {
  expect(at("גרעיני תירס מוקפאים סנפרוסט")).toBe("frozen/veg");
  expect(at("כרובית מוקפאת")).toBe("frozen/veg");
  expect(at("גרעיני תירס מתוק יכין")).toBe("pantry/cans");
});
test("תת-מחלקות חדשות: הלבשה, צעצועים, אלקטרוניקה", () => {
  expect(at("זוג חולצות ארוכות עם פסים")).toBe("home/clothing");
  expect(at("לייף מכנסונים סופגים למבוגרים")).toBeNull();
  expect(at("כבל USB C LIGHTNING")).toBe("home/electronics");
  expect(at("צעצוע דמפלינגס סקווישי")).toBe("home/toys");
});
test("טבק נשאר בלי מחלקה", () => {
  expect(at("סיגריות מרלבורו חפיסה")).toBeNull();
  expect(at("ווינסטון בלו פאקט")).toBeNull();
  expect(at("אל אם רד קצר")).toBeNull();
});

// סבב 2: ביקורת לפי משפחות (מילה ראשונה בכל תת-מחלקה)
test("שם עצם בראש השם קובע מול מילת מזון בהמשך", () => {
  expect(at("קערת סלט עגולה 27 ס\"מ")).toBe("home/kitchen");
  expect(at("מסחטת מיץ לימון")).toBe("home/kitchen");
  expect(at("מקציף חלב נירוסטה")).toBe("home/kitchen");
  expect(at("מחזיק נייר טואלט")).toBe("home/kitchen");
  expect(at("אטבי כביסה עץ 24 יח'")).toBe("home/kitchen");
  expect(at("מיחם שבת כ-40 כוסות")).toBe("home/electronics");
  expect(at("צנצנת מסטיק מאסט בטעם מנטה")).toBe("snacks/sweets");
  expect(at("כריות קרצוף אקסטרה חזקות")).toBe("cleaning/dishes");
  expect(at("טבלת טורינו חלב 100")).toBe("snacks/choc");
  expect(at("מטריה פול אוטומט")).toBe("home/clothing");
});
test("מותג טיפוח: מילת סוג קובעת, המותג רק כשאין", () => {
  expect(at("קרליין דאודורנט רול און נושם")).toBe("care/deo");
  expect(at("ניוואה ג'ל גילוח Sensitive")).toBe("care/shave");
  expect(at("פינוק אל סבון לילדים")).toBe("care/bath");
  expect(at("פנטן קרם לחות עשיר לשיער")).toBe("care/hair");
  expect(at("דאב ספריי טלק 150 מל")).toBe("care/deo");
  expect(at("בליסטקס סטיק מנטה")).toBe("care/skin");
});
test("דייסה עם מותג תינוקות או גיל = מזון תינוקות", () => {
  expect(at("דייסת דגנים בטעם וניל +6")).toBe("baby/food");
  expect(at("דייסת שיבולת שועל מייפל וסוכר חום")).toBe("breakfast/granola");
});
test("חתול/כלב בשם של בגד או בובה אינו מזון לבעלי חיים", () => {
  expect(at("מכנס וחולצה בנות איורי חתול מידה 1")).not.toBe("pets/cats");
  expect(at("בובת TY באונסר חתול צבעוני")).toBe("home/toys");
  expect(at("גבינה מותכת למריחה 14% החתול")).not.toBe("pets/cats");
});
test("משפחות מתוך הערימה הלא ממוינת", () => {
  expect(at("זר קשת בענן יחידה")).toBe("home/garden");
  expect(at("סינטה טרי מוכשר")).toBe("meat/beef");
  expect(at("טבורוג 5% שומן 300 ג")).toBe("dairy/cheese");
  expect(at("קרפלך במילוי בשר 400 גרם")).toBe("frozen/meals");
  expect(at("שפרוטים מעושנים בשמן")).toBe("pantry/cans");
  expect(at("משקפי קריאה מס 2.5")).toBe("health/eyes");
  expect(at("קולסטון קיט 2/8 שחור")).toBe("care/hair");
  expect(at("מארז 12 ביצי אומגה 3 - L")).toBe("dairy/eggs");
});

// סבב 2ב: דירוג 6,001–6,750
test("משפחות מדירוג 6,001 ואילך", () => {
  expect(at("מסיכה ללא שטיפה שמן")).toBe("care/hair");
  expect(at("מוס תלתלים 200 מ\"ל")).toBe("care/hair");
  expect(at("קרם גבינת שמנת בטעם טבעי 5%")).toBe("dairy/cheese");
  expect(at("מחית קארי אדומה 400ג")).toBe("cooking/sauces");
  expect(at("פילה טונה בשמן זית")).toBe("pantry/cans");
  expect(at("פחם הלהבה 2 ק\"ג")).toBe("home/candles");
  expect(at("חזרת 400 גרם")).toBe("deli/salads");
  expect(at("אוולין קרם לחות")).toBe("care/skin");
  expect(at("סלמון אטלנטי בשמן קנולה")).not.toBeNull();
  expect(at("בייבי מוצרלה 150 גר")).not.toBe("baby/care");
});

// סבב 3: משפחות מהדירוג העצמאי
test("מילים קצרות ושמות מתועתקים לא גוררים למזון", () => {
  expect(at("סאם ביי מי- רטינול אינטנס מסכת פנים")).toBe("care/skin");
  expect(at("ליברה ברי אדפ לאשה 30מ\"ל")).not.toBe("dairy/yellow");
  expect(at("מרקיות קנה סוכר 25יח")).toBe("paper/disposable");
  expect(at("כריות פלדה 3יח VIVI")).toBe("cleaning/dishes");
  expect(at("בייבי בל 100 גרם")).toBe("dairy/yellow");
  expect(at("עלי בייבי 120 גרם")).toBe("produce/veg");
  expect(at("ממתקי גלי מנגו")).toBe("snacks/sweets");
  expect(at("שמן גזר למראה שזוף 285 מ\"ל")).toBe("care/skin");
  expect(at("סכין קרם 40 יחידות")).not.toBe("care/skin");
});
test("החלטות סוג מוצר", () => {
  expect(at("גבינה קשה פרמזן")).toBe("dairy/yellow");
  expect(at("גבינה גאודה פרוסה 30%")).toBe("dairy/yellow");
  expect(at("חזה אווז קפוא")).toBe("meat/chicken");
  expect(at("תפוגן צ'יפס קלאסי לתנור 5%")).toBe("frozen/meals");
  expect(at("גלטו שוקולד 473 מ\"ל")).toBe("frozen/icecream");
  expect(at("סירופ אגבה אורגני 660גרם")).toBe("pantry/flour");
  expect(at("טחינה בלאדי עם פלפלים חריפים")).toBe("deli/hummus");
  expect(at("הלמנס ממרח מופחת שומן בקבוק לחיץ")).toBe("cooking/sauces");
  expect(at("שמן שפתיים 70")).toBe("care/skin");
  expect(at("סיר ג'חנון אפוי קפוא")).not.toBe("home/kitchen");
  expect(at("לחמניה כריך לבן בונז'ור")).not.toBe("pets/other");
  expect(at("חטיפי עוף פריכים בציפוי")).toBe("meat/chicken");
  expect(at("גל אורנים לניקוי1ל LU")).toBe("cleaning/home");
});

// סבב 4: משפחות מהדירוג השני
test("אבקות קינוח, צורות תבלין, ממרח מלוח, קפוא", () => {
  expect(at("אינסטנט פודינג בטעם וניל")).toBe("cooking/baking");
  expect(at("קינוחי עדן בוואריה פרווה")).toBe("cooking/baking");
  expect(at("אפיכל סירופ בטעם שוקולד")).toBe("cooking/baking");
  expect(at("שום גבישי 70 גרם")).toBe("cooking/spices");
  expect(at("ממרח ארטישוק 180 גרם")).toBe("deli/salads");
  expect(at("תותים ובננות מוקפאים 300")).toBe("frozen/veg");
  expect(at("כרובית מוקפא800ג ארבל")).toBe("frozen/veg");
  expect(at("כרוב אדום")).toBe("produce/veg");
});
test("מטרה גוברת על שם הדבר, צמחי, טעם לא קובע", () => {
  expect(at("פדים אובלים להסרת איפור 40יח")).toBe("care/skin");
  expect(at("סטרימר תרסיס אף מי מלח היפרטוני")).toBe("health/otc");
  expect(at("מנטרל ריחות בניחוח לימון למדיח כלים")).toBe("cleaning/dishes");
  expect(at("PLANT BITE- שניצל טופו")).toBe("meat/veggie");
  expect(at("לייף אולאין ח.חלבון סופט קרם עוגיות")).toBe("snacks/bars");
  expect(at("שוק הודו מפורק טרי")).toBe("meat/chicken");
  expect(at("רולדה הודו טרי")).not.toBe("bakery/cakes");
  expect(at("מגבות 3 תלת שכבתיות")).not.toBe("cosmetics/makeup");
});
test("החלטות סבב 4", () => {
  expect(at("לבלו שפתון לחות דובדבן")).toBe("care/skin");
  expect(at("פילה דג הרינג מלוח מצונן")).toBe("deli/smoked");
  expect(at("משקה חלבון GO אייס קפה")).toBe("dairy/drinks");
  expect(at("קוקיס שוקולד מריר במשקל")).toBe("snacks/biscuits");
  expect(at("בייגלה שמיניות עם מלח")).toBe("snacks/salty");
  expect(at("גבינה מותכת לייט")).toBe("dairy/cheese");
  expect(at("קיסמי שיניים מבמבוק")).toBe("paper/disposable");
});
