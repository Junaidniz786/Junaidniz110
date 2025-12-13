import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// =====================
// CONFIG
// =====================
const PORT = process.env.PORT || 3000;

const BASE_URL = "http://51.89.99.105/NumberPanel";

const CREDENTIALS = {
  username: "Junaidali786",   // 👈 apna agent/client username
  password: "Junaidali786"    // 👈 apna password
};

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome Mobile",
  "X-Requested-With": "XMLHttpRequest"
};

let SESSION_COOKIE = null;

// =====================
// LOGIN WITH CAPTCHA
// =====================
async function login() {
  const session = axios.create({ headers: HEADERS });

  // 1️⃣ get login page
  const loginPage = await session.get(`${BASE_URL}/login`);

  const cookies = loginPage.headers["set-cookie"];
  if (!cookies) throw new Error("No cookies from login page");

  const phpSess = cookies.find(c => c.startsWith("PHPSESSID"));
  if (!phpSess) throw new Error("PHPSESSID not found");

  const cookie = phpSess.split(";")[0];

  // captcha parse
  const match = loginPage.data.match(/What is (\d+) \+ (\d+)/);
  if (!match) throw new Error("Captcha not found");

  const capt = parseInt(match[1]) + parseInt(match[2]);

  // 2️⃣ submit login
  const body = new URLSearchParams();
  body.append("username", CREDENTIALS.username);
  body.append("password", CREDENTIALS.password);
  body.append("capt", capt);

  const res = await session.post(`${BASE_URL}/signin`, body, {
    headers: {
      ...HEADERS,
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    maxRedirects: 0,
    validateStatus: s => s < 400
  });

  const newCookies = res.headers["set-cookie"];
  const newSess = newCookies?.find(c => c.startsWith("PHPSESSID"));

  SESSION_COOKIE = newSess
    ? newSess.split(";")[0]
    : cookie;

  console.log("✅ Logged in");
}

// =====================
// MIDDLEWARE
// =====================
async function ensureLogin(req, res, next) {
  try {
    if (!SESSION_COOKIE) {
      await login();
    }
    next();
  } catch (e) {
    res.status(500).json({ error: "Login failed", details: e.message });
  }
}

// =====================
// ROUTES
// =====================
app.get("/", (req, res) => {
  res.send("✅ API Running Successfully");
});

// NUMBERS
app.get("/numbers", ensureLogin, async (req, res) => {
  try {
    const url =
      `http://51.89.99.105/NumberPanel/client/res/data_smsnumbers.php?frange=&fclient=&sEcho=2&iColumns=6&sColumns=%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1&_=1765425845351;

    const r = await axios.get(url, {
      headers: { ...HEADERS, Cookie: SESSION_COOKIE }
    });

    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SMS
app.get("/sms", ensureLogin, async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    const url =
      `http://51.89.99.105/NumberPanel/client/res/data_smscdr.php?fdate1=2025-12-11%2000:00:00&fdate2=2125-12-11%2023:59:59&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sesskey=Q05RRkJQUEJBUg==&sEcho=2&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=1765425809322;

    const r = await axios.get(url, {
      headers: { ...HEADERS, Cookie: SESSION_COOKIE }
    });

    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =====================
// START SERVER (RENDER REQUIRED)
// =====================
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
