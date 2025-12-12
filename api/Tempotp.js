const express = require("express");
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const axios = require("axios").default;
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const querystring = require("querystring");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== CONFIG ==========
const PANEL_HOST = process.env.PANEL_HOST || "http://51.89.99.105";
const LOGIN_PATH  = process.env.LOGIN_PATH  || "/NumberPanel/login"; // show login page
const LOGIN_SUBMIT = process.env.LOGIN_SUBMIT || "/NumberPanel/signin"; // fallback signin path (if used)
const PANEL_USER = process.env.PANEL_USER || "Junaidniz786";
const PANEL_PASS = process.env.PANEL_PASS || "Junaidniz786";

const COOKIE_FILE = path.join(__dirname, "session.json");
const PORT = parseInt(process.env.PORT || "3001", 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "15000", 10);

// ========== cookie jar + axios instance ==========
let jar = loadJar() || new CookieJar();
const client = wrapper(axios.create({
  baseURL: PANEL_HOST,
  jar,
  withCredentials: true,
  timeout: TIMEOUT_MS,
  headers: {
    "User-Agent": "Mozilla/5.0 (X11; Linux) NodeLoginProxy/1.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  }
}));

function saveJar() {
  try {
    const json = JSON.stringify(jar.toJSON());
    fs.writeFileSync(COOKIE_FILE, json, "utf8");
    console.log("Saved cookie jar to", COOKIE_FILE);
  } catch (e) { console.error("saveJar error", e); }
}
function loadJar() {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      const raw = fs.readFileSync(COOKIE_FILE,"utf8");
      const obj = JSON.parse(raw);
      return CookieJar.fromJSON(obj);
    }
  } catch(e) {
    console.warn("Could not load jar:", e && e.message);
  }
  return null;
}
function maskJar() {
  try {
    const s = JSON.stringify(jar.toJSON());
    return s.slice(0,200) + (s.length>200 ? "..." : "");
  } catch { return null; }
}

// ========== helpers ==========
async function getLoginPage() {
  const url = new URL(LOGIN_PATH, PANEL_HOST).toString();
  const resp = await client.get(url, { headers: { Referer: PANEL_HOST } });
  return resp.data;
}
function findFormAndInputs(html) {
  const $ = cheerio.load(html);
  // prefer form with login action
  let form = $("form").first();
  $("form").each((i, el) => {
    const a = $(el).attr("action") || "";
    if (a.toLowerCase().includes("login") || a.toLowerCase().includes("signin")) { form = $(el); return false; }
  });
  // action absolute
  let action = form.attr("action") || LOGIN_SUBMIT || LOGIN_PATH;
  // if relative, make absolute
  action = new URL(action, PANEL_HOST).toString();

  const inputs = {};
  form.find("input").each((i, el) => {
    const name = $(el).attr("name");
    const val  = $(el).attr("value") || "";
    if (name) inputs[name] = val;
  });

  // also attempt to find a simple captcha "What is X + Y = ?" pattern
  const text = $.root().text();
  let captchaMatch = text.match(/What\s+is\s+(\d+)\s*\+\s*(\d+)\s*=?\s*\?/i);
  if (!captchaMatch) {
    // alternate patterns
    captchaMatch = text.match(/(\d+)\s*\+\s*(\d+)\s*=/);
  }

  return { action, inputs, captchaMatch };
}

async function postLogin(actionUrl, formBody, referer) {
  // post as form
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Referer": referer || PANEL_HOST
  };
  const resp = await client.post(actionUrl, querystring.stringify(formBody), { headers, maxRedirects: 0, validateStatus: s => s < 500 });
  return resp;
}

// ========== ENDPOINTS ==========

app.get("/", (req,res) => {
  res.send("API Running — endpoints: POST /login , GET /session , GET /numbers , GET /sms");
});

// POST /login  (optional body: user, pass)
app.post("/login", async (req, res) => {
  const user = req.body.user || req.body.username || PANEL_USER;
  const pass = req.body.pass || req.body.password || PANEL_PASS;

  try {
    const html = await getLoginPage();
    const { action, inputs, captchaMatch } = findFormAndInputs(html);

    // detect username & password field names if not obvious
    let userField = Object.keys(inputs).find(k => /user|username|login|email|client/i.test(k)) || null;
    let passField = Object.keys(inputs).find(k => /pass|password|passwd|pwd/i.test(k)) || null;

    // fallback: choose first text + first password
    if (!userField) {
      for (const k of Object.keys(inputs)) {
        if (/text|email/i.test(k) || k.toLowerCase().includes("user")) { userField = k; break; }
      }
    }
    if (!passField) {
      for (const k of Object.keys(inputs)) {
        if (k.toLowerCase().includes("pass") || k.toLowerCase().includes("pwd")) { passField = k; break; }
      }
    }

    // if still missing, try heuristics
    if (!userField || !passField) {
      // respond with detected inputs for debugging
      return res.status(400).json({ ok:false, error:"Could not detect user/pass field names.", detectedInputs: Object.keys(inputs) });
    }

    // prepare payload
    const payload = { ...inputs };
    payload[userField] = user;
    payload[passField] = pass;

    // if captcha found and simple sum, solve it and try to set param named 'capt' or similar
    if (captchaMatch) {
      const a = parseInt(captchaMatch[1],10);
      const b = parseInt(captchaMatch[2],10);
      const answer = a + b;
      // try to detect field name for captcha
      const possibleNames = ["capt","captcha","answer","cap","verify"];
      let setName = possibleNames.find(n => Object.keys(inputs).includes(n)) || possibleNames[0];
      payload[setName] = answer;
    }

    // POST login
    const resp = await postLogin(action, payload, new URL(LOGIN_PATH, PANEL_HOST).toString());

    // Check set-cookie on response or follow redirect once
    const setCookieHeaders = resp.headers['set-cookie'] || [];
    if (Array.isArray(setCookieHeaders) && setCookieHeaders.length) {
      // cookie jar is updated automatically by axios-cookiejar-support
      saveJar();
      return res.json({ ok:true, message:"Login posted; cookie jar saved", jarMask: maskJar() });
    }

    // If no set-cookie, maybe redirect
    if (resp.status >= 300 && resp.status < 400 && resp.headers.location) {
      const nextUrl = new URL(resp.headers.location, PANEL_HOST).toString();
      const follow = await client.get(nextUrl, { headers: { Referer: action } });
      if ((follow.headers['set-cookie'] || []).length) {
        saveJar();
        return res.json({ ok:true, message:"Login followed redirect; cookie jar saved", jarMask: maskJar() });
      } else {
        // maybe login success without cookie, but check for dashboard content
        const bodyText = follow.data ? String(follow.data).slice(0,400) : "";
        saveJar();
        return res.json({ ok:true, message:"Followed redirect; no new cookie header. Response sample included.", sample: bodyText });
      }
    }

    // fallback: return response snippet for debugging
    const sample = String(resp.data || "").slice(0,800);
    saveJar();
    return res.status(200).json({ ok:false, message:"Login request completed (no obvious set-cookie). Saved jar state anyway.", sample });

  } catch (err) {
    console.error("Login error:", err && err.message);
    return res.status(500).json({ ok:false, error: String(err) });
  }
});

// GET /session -> show masked jar
app.get("/session", (req,res) => {
  return res.json({ cookieMask: maskJar() || null });
});

// helper: ensure jar loaded
async function ensureJar() {
  if (!jar) jar = loadJar() || new CookieJar();
}

// GET /numbers
app.get("/numbers", async (req,res) => {
  try {
    await ensureJar();
    // Panel-specific numbers path (adjust if different)
    const url = new URL("/NumberPanel/ints/agent/res/data_smsnumbers.php?frange=&fclient=&sEcho=2&iColumns=8&iDisplayStart=0&iDisplayLength=-1", PANEL_HOST).toString();
    const r = await client.get(url, { headers: { Accept: "application/json, text/javascript, */*; q=0.01", Referer: `${PANEL_HOST}/ints/agent/` } });
    // try to parse JSON if returned
    const txt = r.data;
    try {
      return res.json(typeof txt === "string" ? JSON.parse(txt) : txt);
    } catch {
      return res.type("text").send(String(txt));
    }
  } catch (e) {
    console.error("fetch numbers error", e && e.message);
    return res.status(500).json({ ok:false, error: String(e) });
  }
});

// GET /sms
app.get("/sms", async (req,res) => {
  try {
    await ensureJar();
    const fdate1 = req.query.fdate1 || `${new Date().toISOString().slice(0,10)} 00:00:00`;
    const fdate2 = req.query.fdate2 || `${new Date().toISOString().slice(0,10)} 23:59:59`;
    const basePath = `/NumberPanel/ints/agent/res/data_smscdr.php`;
    const qs = `?fdate1=${encodeURIComponent(fdate1)}&fdate2=${encodeURIComponent(fdate2)}&frange=&fclient=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sEcho=2&iColumns=9&iDisplayStart=0&iDisplayLength=-1`;
    const url = new URL(basePath + qs, PANEL_HOST).toString();
    const r = await client.get(url, { headers: { Accept: "application/json, text/javascript, */*; q=0.01", Referer: `${PANEL_HOST}/ints/agent/` } });
    const txt = r.data;
    try {
      return res.json(typeof txt === "string" ? JSON.parse(txt) : txt);
    } catch {
      return res.type("text").send(String(txt));
    }
  } catch (e) {
    console.error("fetch sms error", e && e.message);
    return res.status(500).json({ ok:false, error: String(e) });
  }
});

// LOGOUT -> clear jar
app.get("/logout", (req,res) => {
  jar = new CookieJar();
  try { fs.unlinkSync(COOKIE_FILE); } catch(e) {}
  return res.json({ ok:true });
});

// start server
app.listen(PORT, ()=> {
  console.log("Agent-proxy running on port", PORT);
  if (fs.existsSync(COOKIE_FILE)) console.log("Loaded cookie jar:", COOKIE_FILE);
});
