import express from "express";
import fs from "fs";
import path from "path";
import cheerio from "cheerio";
import querystring from "querystring";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PANEL_HOST = "http://51.89.99.105";
const LOGIN_PATH = "/NumberPanel/login";

const PANEL_USER = "Junaidniz786";
const PANEL_PASS = "Junaidniz786";

const COOKIE_FILE = path.join(__dirname, "session.cookie");
const PORT = process.env.PORT || 3001;
const TIMEOUT = 15000;

let savedCookie = loadCookie();

function loadCookie() {
    try {
        if (fs.existsSync(COOKIE_FILE)) {
            return fs.readFileSync(COOKIE_FILE, "utf8").trim();
        }
    } catch {}
    return null;
}

function saveCookie(c) {
    fs.writeFileSync(COOKIE_FILE, c, "utf8");
}

function maskCookie(c) {
    if (!c) return null;
    return c.split(";").map(p => {
        const [k,v] = p.split("=");
        if (!v) return p;
        return `${k}=****${v.slice(-4)}`;
    }).join("; ");
}

function timeoutSignal(ms) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    return { controller, clear: () => clearTimeout(id) };
}

async function safeFetch(url, options = {}) {
    const { controller, clear } = timeoutSignal(TIMEOUT);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clear();
        return res;
    } catch (err) {
        clear();
        throw err;
    }
}

app.post("/login", async (req, res) => {
    const user = req.body.user || PANEL_USER;
    const pass = req.body.pass || PANEL_PASS;

    try {
        const loginURL = PANEL_HOST + LOGIN_PATH;

        const page = await safeFetch(loginURL);
        const html = await page.text();

        const $ = cheerio.load(html);
        const form = $("form").first();

        const inputs = {};
        form.find("input").each((i, el) => {
            const name = $(el).attr("name");
            const val  = $(el).attr("value") || "";
            if (name) inputs[name] = val;
        });

        let userField = Object.keys(inputs).find(n => /user|login|email/i.test(n));
        let passField = Object.keys(inputs).find(n => /pass|pwd/i.test(n));

        if (!userField || !passField) {
            return res.json({
                ok: false,
                msg: "Cannot detect username/password fields.",
                foundFields: Object.keys(inputs)
            });
        }

        inputs[userField] = user;
        inputs[passField] = pass;

        const body = querystring.stringify(inputs);

        const loginPost = await safeFetch(loginURL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "LoginProxy/1.0"
            },
            body,
            redirect: "manual"
        });

        let rawCookies = [];

        if (loginPost.headers.raw) {
            rawCookies = loginPost.headers.raw()["set-cookie"] || [];
        } else {
            const c = loginPost.headers.get("set-cookie");
            if (c) rawCookies = [c];
        }

        if (rawCookies.length === 0) {
            return res.json({ ok: false, msg: "Login failed: No cookie returned" });
        }

        const finalCookie = rawCookies.map(s => s.split(";")[0]).join("; ");

        savedCookie = finalCookie;
        saveCookie(finalCookie);

        return res.json({
            ok: true,
            msg: "Login successful",
            cookie: maskCookie(finalCookie)
        });

    } catch (err) {
        return res.json({ ok: false, error: err.toString() });
    }
});

app.get("/session", (req, res) => {
    res.json({ cookie: maskCookie(savedCookie) });
});

app.get("/fetch-numbers", async (req, res) => {
    if (!savedCookie)
        return res.json({ ok: false, msg: "Login required" });

    const url =
        PANEL_HOST +
        "/NumberPanel/ints/agent/res/data_smsnumbers.php?frange=&fclient=&sEcho=2&iColumns=8&sColumns=%2C%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1";

    try {
        const r = await safeFetch(url, {
            headers: {
                Cookie: savedCookie,
                "User-Agent": "LoginProxy/1.0",
                Accept: "application/json"
            }
        });

        const text = await r.text();
        res.type("json").send(text);

    } catch (err) {
        res.json({ ok: false, error: err.toString() });
    }
});

app.get("/fetch-sms", async (req, res) => {
    if (!savedCookie)
        return res.json({ ok: false, msg: "Login required" });

    const today = new Date().toISOString().split("T")[0];

    const url =
        PANEL_HOST +
        "/NumberPanel/ints/agent/res/data_smscdr.php?fdate1=" +
        today +
        "%2000:00:00&fdate2=" +
        today +
        "%2023:59:59&frange=&fclient=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sEcho=2&iColumns=9&iDisplayStart=0&iDisplayLength=-1";

    try {
        const r = await safeFetch(url, {
            headers: {
                Cookie: savedCookie,
                "User-Agent": "LoginProxy/1.0",
                Accept: "application/json"
            }
        });

        const text = await r.text();
        res.type("json").send(text);

    } catch (err) {
        res.json({ ok: false, error: err.toString() });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy running on port ${PORT}`);
    if (savedCookie) console.log("Loaded session:", maskCookie(savedCookie));
});
