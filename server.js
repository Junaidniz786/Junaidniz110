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
      `${BASE_URL}/client/res/data_smsnumbers.php` +
      `?iDisplayStart=0&iDisplayLength=-1`;

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
      `${BASE_URL}/client/res/data_smscdr.php` +
      `?fdate1=${today}%2000:00:00&fdate2=${today}%2023:59:59` +
      `&iDisplayStart=0&iDisplayLength=-1`;

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
