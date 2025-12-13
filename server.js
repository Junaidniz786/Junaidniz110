import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

/* =====================
   CONFIG
===================== */
const PORT = process.env.PORT || 3000;
const BASE_URL = "http://51.89.99.105/NumberPanel";

const USERNAME = process.env.PANEL_USER || "Junaidali786";
const PASSWORD = process.env.PANEL_PASS || "Junaidali786";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile",
  "X-Requested-With": "XMLHttpRequest",
};

let SESSION_COOKIE = null;

/* =====================
   LOGIN (WITH CAPTCHA)
===================== */
async function doLogin() {
  const s = axios.create({ headers: HEADERS });

  // 1) get login page
  const page = await s.get(`${BASE_URL}/login`);

  const cookies = page.headers["set-cookie"];
  if (!cookies) throw new Error("No cookies");

  const phpsess = cookies.find(c => c.startsWith("PHPSESSID"));
  if (!phpsess) throw new Error("PHPSESSID missing");

  const baseCookie = phpsess.split(";")[0];

  // captcha parse
  const m = page.data.match(/What is (\d+) \+ (\d+)/);
  if (!m) throw new Error("Captcha not found");

  const capt = parseInt(m[1]) + parseInt(m[2]);

  // 2) submit login
  const body = new URLSearchParams();
  body.append("username", USERNAME);
  body.append("password", PASSWORD);
  body.append("capt", capt);

  const res = await s.post(`${BASE_URL}/signin`, body, {
    headers: {
      ...HEADERS,
      Cookie: baseCookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    maxRedirects: 0,
    validateStatus: s => s < 400,
  });

  const newCookies = res.headers["set-cookie"];
  const newSess = newCookies?.find(c => c.startsWith("PHPSESSID"));

  SESSION_COOKIE = newSess
    ? newSess.split(";")[0]
    : baseCookie;

  console.log("✅ Login OK");
}

/* =====================
   ENSURE LOGIN
===================== */
async function ensureLogin(req, res, next) {
  try {
    if (!SESSION_COOKIE) {
      await doLogin();
    }
    next();
  } catch (e) {
    res.status(500).json({ error: "LOGIN_FAILED", msg: e.message });
  }
}

/* =====================
   ROUTES
===================== */
app.get("/", (req, res) => {
  res.send("✅ API Running");
});

// NUMBERS
app.get("/numbers", ensureLogin, async (req, res) => {
  try {
    const url =
      `${BASE_URL}/client/res/data_smsnumbers.php?iDisplayStart=0&iDisplayLength=-1`;

    const r = await axios.get(url, {
      headers: { ...HEADERS, Cookie: SESSION_COOKIE },
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
      `${BASE_URL}/client/res/data_smscdr.php?fdate1=${today}%2000:00:00&fdate2=${today}%2023:59:59&iDisplayStart=0&iDisplayLength=-1`;

    const r = await axios.get(url, {
      headers: { ...HEADERS, Cookie: SESSION_COOKIE },
    });

    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =====================
   START SERVER
===================== */
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
