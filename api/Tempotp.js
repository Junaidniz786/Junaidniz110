const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const querystring = require("querystring");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------- CONFIG (Edit or set via ENV) ----------
const PANEL_HOST = process.env.PANEL_HOST || "http://51.89.99.105";
const LOGIN_PATH = process.env.LOGIN_PATH || "/NumberPanel/login";
const PANEL_USER = process.env.PANEL_USER || "Junaidniz786";
const PANEL_PASS = process.env.PANEL_PASS || "Junaidniz786";

const COOKIE_FILE = process.env.COOKIE_FILE || path.join(__dirname, "..", "session.cookie");
const PORT = parseInt(process.env.PORT || "3001", 10);
const TIMEOUT_MS = 15000;

let savedCookie = loadCookie();

// ----------------- helpers -----------------
function loadCookie() {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      return fs.readFileSync(COOKIE_FILE, "utf8").trim() || null;
    }
  } catch (e) {
    console.error("loadCookie error:", e);
  }
  return null;
}
function saveCookie(cookie) {
  try {
    fs.writeFileSync(COOKIE_FILE, cookie, { encoding: "utf8" });
  } catch (e) {
    console.error("saveCookie error:", e);
  }
}
function maskCookie(c) {
  if (!c) return null;
  return c.split(";").map(p => {
    const [k,v] = p.split("=");
    if (!v) return k;
    return `${k}=****${v.slice(-4)}`;
  }).join("; ");
}
function joinCookie(arr) {
  if (!arr || !arr.length) return null;
  return arr.map(s => s.split(";")[0].trim()).join("; ");
}
async function safeGet(url, opts = {}) {
  return axios.get(url, { timeout: TIMEOUT_MS, ...opts });
}
async function safePost(url, data, opts = {}) {
  return axios.post(url, data, { timeout: TIMEOUT_MS, ...opts });
}

// ----------------- LOGIN (agent/client) -----------------
// This function fetches login page, extracts form inputs and posts credentials.
// It tries to detect username/password input names automatically.
async function performLogin() {
  try {
    const loginUrl = new URL(LOGIN_PATH, PANEL_HOST).toString();
    console.log("Login: GET", loginUrl);
    const getResp = await safeGet(loginUrl, { headers: { "User-Agent":"LoginProxy/1.0" } });
    const html = getResp.data;
    const $ = cheerio.load(html);
    // choose a form which has 'login' in action if exists, otherwise first form
    let form = $("form").first();
    $("form").each((i,el) => {
      const a = $(el).attr("action") || "";
      if (String(a).toLowerCase().includes("login")) { form = $(el); return false; }
    });

    // collect inputs
    const inputs = {};
    form.find("input").each((i,el) => {
      const name = $(el).attr("name");
      const val = $(el).attr("value") || "";
      if (name) inputs[name] = val;
    });

    // detect fields
    let userField = Object.keys(inputs).find(k => /user|login|email|uname/i.test(k));
    let passField = Object.keys(inputs).find(k => /pass|pwd|passwd/i.test(k));

    if (!userField || !passField) {
      // fallback: try common names
      for (const k of Object.keys(inputs)) {
        if (!userField && /user|login|email/i.test(k)) userField = k;
        if (!passField && /pass|pwd/i.test(k)) passField = k;
      }
    }

    if (!userField || !passField) {
      console.error("Auto-detect failed, inputs:", Object.keys(inputs));
      throw new Error("Cannot detect username/password input names. Provide correct names or screenshot.");
    }

    // build payload preserving hidden fields
    const payload = { ...inputs };
    payload[userField] = PANEL_USER;
    payload[passField] = PANEL_PASS;

    const body = querystring.stringify(payload);

    console.log("Login: POST", loginUrl, "fields:", userField, passField);

    const postResp = await axios({
      method: "post",
      url: loginUrl,
      headers: {
        "Content-Type":"application/x-www-form-urlencoded",
        "User-Agent":"LoginProxy/1.0",
        "Referer": loginUrl,
      },
      maxRedirects: 0,
      validateStatus: s => (s >= 200 && s < 400),
      data: body,
      timeout: TIMEOUT_MS
    });

    // check set-cookie on response or on subsequent redirect location
    let cookies = [];
    if (postResp.headers && postResp.headers['set-cookie']) cookies = postResp.headers['set-cookie'];
    // if no set-cookie, try follow location once
    if (!cookies.length && postResp.status >= 300 && postResp.headers.location) {
      const follow = new URL(postResp.headers.location, PANEL_HOST).toString();
      const fResp = await safeGet(follow, { headers: { "User-Agent":"LoginProxy/1.0", "Referer": loginUrl } });
      if (fResp.headers && fResp.headers['set-cookie']) cookies = fResp.headers['set-cookie'];
    }

    if (!cookies || !cookies.length) {
      console.error("Login did not return set-cookie. Response status:", postResp.status);
      throw new Error("Login failed: no session cookie");
    }

    const cookieStr = joinCookie(cookies);
    savedCookie = cookieStr;
    saveCookie(cookieStr);
    console.log("Login successful, cookie saved:", maskCookie(cookieStr));
    return cookieStr;

  } catch (err) {
    console.error("performLogin error:", err.message || err);
    throw err;
  }
}

// ----------------- API endpoints -----------------
app.get("/api/tempotp", async (req, res) => {
  const type = String(req.query.type || "").toLowerCase();
  if (!type || (type !== "sms" && type !== "numbers")) {
    return res.status(400).json({ error: "use ?type=sms or ?type=numbers" });
  }

  // target endpoints on panel (adjust paths if different)
  const numbersPath = "/NumberPanel/ints/agent/res/data_smsnumbers.php?frange=&fclient=&sEcho=2&iColumns=8&iDisplayStart=0&iDisplayLength=-1";
  const smsPath = p => `/NumberPanel/ints/agent/res/data_smscdr.php?fdate1=${p}%2000:00:00&fdate2=${p}%2023:59:59&frange=&fclient=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sEcho=2&iColumns=9&iDisplayStart=0&iDisplayLength=-1`;

  try {
    if (!savedCookie) {
      await performLogin();
    }

    let target = "";
    if (type === "numbers") {
      target = new URL(numbersPath, PANEL_HOST).toString();
    } else {
      const today = new Date().toISOString().split("T")[0];
      target = new URL(smsPath(encodeURIComponent(today)), PANEL_HOST).toString();
    }

    console.log("Fetching", target);
    let resp = await axios.get(target, {
      headers: {
        "User-Agent":"LoginProxy/1.0",
        "Accept":"application/json, text/javascript, */*; q=0.01",
        "Referer": `${PANEL_HOST}/ints/agent/`,
        "Cookie": savedCookie
      },
      timeout: TIMEOUT_MS
    });

    // If response looks like login page (html), try re-login once
    const dataStr = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
    if (dataStr.toLowerCase().includes("login") || dataStr.toLowerCase().includes("please login")) {
      console.log("Looks like session expired — relogin and retry");
      await performLogin();
      resp = await axios.get(target, {
        headers: {
          "User-Agent":"LoginProxy/1.0",
          "Accept":"application/json, text/javascript, */*; q=0.01",
          "Referer": `${PANEL_HOST}/ints/agent/`,
          "Cookie": savedCookie
        },
        timeout: TIMEOUT_MS
      });
    }

    // Try to send JSON if possible
    if (typeof resp.data === "object") return res.json(resp.data);
    // if server returned JSON in string form:
    const trimmed = String(resp.data).trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { return res.json(JSON.parse(trimmed)); } catch(e){ return res.type("text").send(trimmed); }
    }
    // otherwise return raw text
    return res.type("text").send(resp.data);

  } catch (err) {
    console.error("API error:", err.message || err);
    return res.status(500).json({ error: String(err.message || err) });
  }
});

// session endpoint
app.get("/session", (req,res) => {
  res.json({ cookie: maskCookie(savedCookie), raw: savedCookie ? savedCookie : null });
});

app.get("/", (req,res) => res.send("OK - tempotp proxy"));

// start server
app.listen(PORT, () => {
  console.log(`tempotp proxy listening on port ${PORT}`);
  if (savedCookie) console.log("Loaded cookie:", maskCookie(savedCookie));
});
