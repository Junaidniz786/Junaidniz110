const axios = require('axios');

const CREDENTIALS = {
    username: "Junaidali786",
    password: "Junaidali786"
};

const BASE_URL = "http://51.89.99.105/NumberPanel";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": `${BASE_URL}/client/MySMSNumbers`
};

let cachedCookie = null;

async function performLogin() {
    try {
        const session = axios.create({
            withCredentials: true,
            headers: { ...HEADERS, "Upgrade-Insecure-Requests": "1" }
        });

        const loginPage = await session.get(`${BASE_URL}/login`);
        
        let initialCookie = "";
        if (loginPage.headers['set-cookie']) {
            const tempCookies = loginPage.headers['set-cookie'];
            const phpSession = tempCookies.find(c => c.startsWith('PHPSESSID'));
            if (phpSession) {
                initialCookie = phpSession.split(';')[0];
            }
        }

        const match = loginPage.data.match(/What is (\d+) \+ (\d+) = \?/);
        if (!match) throw new Error("Captcha not found");

        const num1 = parseInt(match[1]);
        const num2 = parseInt(match[2]);
        const answer = num1 + num2;

        const params = new URLSearchParams();
        params.append('username', CREDENTIALS.username);
        params.append('password', CREDENTIALS.password);
        params.append('capt', answer);

        const loginResp = await session.post(`${BASE_URL}/signin`, params, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "http://51.89.99.105",
                "Referer": `${BASE_URL}/login`,
                "Cookie": initialCookie
            },
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400
        });

        const newCookies = loginResp.headers['set-cookie'];
        if (newCookies) {
            const newPhpSession = newCookies.find(c => c.startsWith('PHPSESSID'));
            if (newPhpSession) {
                cachedCookie = newPhpSession.split(';')[0];
                return cachedCookie;
            }
        }

        if (initialCookie) {
            cachedCookie = initialCookie;
            return cachedCookie;
        }

        throw new Error("No cookie returned");
    } catch (e) {
        return null;
    }
}

module.exports = async (req, res) => {
    const { type } = req.query; 

    let targetUrl = "";
    if (type === 'numbers') {
        targetUrl = `${BASE_URL}/client/res/data_smsnumbers.php?frange=&fclient=&sEcho=2&iColumns=6&sColumns=%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1&_=1765425845351`;
    } else if (type === 'sms') {
        targetUrl = `${BASE_URL}/client/res/data_smscdr.php?fdate1=2025-12-11%2000:00:00&fdate2=2125-12-11%2023:59:59&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sesskey=Q05RRkJQUEJBUg==&sEcho=2&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=-1&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=1765425809322`;
    } else {
        return res.status(400).json({ error: "Invalid type" });
    }

    try {
        if (!cachedCookie) {
            await performLogin();
        }

        let response = await axios.get(targetUrl, {
            headers: { ...HEADERS, "Cookie": cachedCookie }
        });

        if (typeof response.data === 'string' && (response.data.includes('login') || response.data.includes('Direct Script'))) {
            await performLogin();
            response = await axios.get(targetUrl, {
                headers: { ...HEADERS, "Cookie": cachedCookie }
            });
        }

        return res.status(200).json(response.data);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
