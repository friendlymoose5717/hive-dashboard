// ----------------------------------------------------
// HIVE ACCOUNT HEALTH DASHBOARD — FULL REWRITE
// ----------------------------------------------------

let hiveGlobals = null;
let blacklist = new Set();
let lastSearch = 0;

// Exchange accounts (highlight transfers)
const EXCHANGE_ACCOUNTS = new Set([
    "binance-hot",
    "orinoco",
    "mxchive",
    "bdhivesteem"
]);

// ----------------------------------------------------
// UTILITIES
// ----------------------------------------------------

const api = async (method, params = []) => {
    const res = await fetch("https://api.hive.blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method,
            params,
            id: 1
        })
    });
    const json = await res.json();
    return json.result;
};

const throttle = (ms = 1500) => {
    const now = Date.now();
    if (now - lastSearch < ms) return false;
    lastSearch = now;
    return true;
};

const daysAgo = d => Date.now() - d * 24 * 60 * 60 * 1000;

// ----------------------------------------------------
// LOGGING
// ----------------------------------------------------

const logSearch = async username => {
    try {
        await fetch(
            "https://discord.com/api/webhooks/1506564033141018674/p0rGAjrficEBUJ0v1jobUQXeyO8FL3gIU8roaMcDIH3QlmGl3gMKUutuV38FlwSB3kIR",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: `🔍 Zoekopdracht: **${username}**`
                })
            }
        );
    } catch (e) {
        console.error("Webhook error:", e);
    }
};

// ----------------------------------------------------
// GLOBALS + BLACKLIST
// ----------------------------------------------------

const loadGlobals = async () => {
    if (hiveGlobals) return hiveGlobals;
    hiveGlobals = await api("condenser_api.get_dynamic_global_properties");
    return hiveGlobals;
};

const loadBlacklist = async () => {
    try {
        const res = await fetch("https://spaminator.me/api/bl/all.json");
        const data = await res.json();
        blacklist = new Set(data.result || []);
    } catch (e) {
        console.error("Blacklist load error:", e);
    }
};

// ----------------------------------------------------
// ACCOUNT DATA
// ----------------------------------------------------

const getAccount = username =>
    api("condenser_api.get_accounts", [[username]]).then(r => r?.[0] || null);

const getReputation = username =>
    api("bridge.get_profile", [{ account: username }]).then(r => r?.reputation || 0);

const getMuteList = username =>
    api("bridge.list_muted", [{ account: username }]).then(r => r?.muted_by || []);

// ----------------------------------------------------
// HISTORY (30 DAYS)
// ----------------------------------------------------

const getHistory30d = async username => {
    const limit = 1000;
    let from = -1;
    const cutoff = daysAgo(30);
    const all = [];

    while (true) {
        const batch = await api("condenser_api.get_account_history", [
            username,
            from,
            limit
        ]);

        if (!batch?.length) break;

        for (const item of batch) {
            const ts = new Date(item[1].timestamp).getTime();
            if (ts < cutoff) return all;
            all.push(item);
        }

        from = batch[0][0] - 1;
    }

    return all;
};

// ----------------------------------------------------
// METRICS
// ----------------------------------------------------

const computeHP = async account => {
    const g = await loadGlobals();
    const totalFund = parseFloat(g.total_vesting_fund_hive);
    const totalShares = parseFloat(g.total_vesting_shares);

    const vs = parseFloat(account.vesting_shares);
    const rs = parseFloat(account.received_vesting_shares);
    const ds = parseFloat(account.delegated_vesting_shares);

    const userVests = vs + rs - ds;
    return userVests * (totalFund / totalShares);
};

const computeKE = (account, globals) => {
    const author = account.posting_rewards / 1000;
    const cur = account.curation_rewards / 1000;

    const hp =
        (parseFloat(globals.total_vesting_fund_hive) *
            (parseFloat(account.vesting_shares) /
                parseFloat(globals.total_vesting_shares))) ||
        0;

    const krampus = hp ? (author + cur) / hp : -1;

    return { author, cur, hp, krampus };
};

// ----------------------------------------------------
// HISTORY ANALYSIS
// ----------------------------------------------------

const extractPostsComments7d = (history, username) => {
    const cutoff = daysAgo(7);
    const user = username.toLowerCase();

    const excluded = new Set([
        "peak.snaps",
        "ecency.waves",
        "leothreads",
        "liketu.moments"
    ]);

    let posts = 0;
    let comments = 0;

    for (const h of history) {
        const op = h[1].op;
        if (!op || op[0] !== "comment") continue;

        const data = op[1];
        if (data.author.toLowerCase() !== user) continue;

        const ts = new Date(h[1].timestamp).getTime();
        if (ts < cutoff) continue;

        if (excluded.has(data.parent_author.toLowerCase())) continue;

        if (data.parent_author === "") posts++;
        else comments++;
    }

    return {
        posts,
        comments,
        ratio: posts ? comments / posts : 0
    };
};

const extractDownvotes = (history, username) => {
    const cutoff = daysAgo(30);
    const user = username.toLowerCase();
    const map = {};

    for (const h of history) {
        const op = h[1].op;
        if (!op || op[0] !== "vote") continue;

        const v = op[1];
        const ts = new Date(h[1].timestamp).getTime();
        if (ts < cutoff) continue;

        if (v.weight < 0 && v.author.toLowerCase() === user) {
            map[v.voter] = (map[v.voter] || 0) + 1;
        }
    }

    return map;
};

const extractTransfers = (history, username) => {
    const user = username.toLowerCase();

    return history
        .filter(h => h[1].op[0] === "transfer")
        .map(h => ({ ...h[1].op[1], date: h[1].timestamp }))
        .filter(t => t.from.toLowerCase() === user);
};

const summarizeTransfers = transfers => {
    const perUser = {};
    let hive = 0;
    let hbd = 0;

    for (const t of transfers) {
        const [amount, currency] = t.amount.split(" ");
        const val = parseFloat(amount);

        if (currency === "HIVE") hive += val;
        if (currency === "HBD") hbd += val;

        if (!perUser[t.to]) perUser[t.to] = { hive: 0, hbd: 0 };
        if (currency === "HIVE") perUser[t.to].hive += val;
        if (currency === "HBD") perUser[t.to].hbd += val;
    }

    return { hive, hbd, perUser };
};

// ----------------------------------------------------
// MAIN
// ----------------------------------------------------

window.checkUser = async () => {
    const username = document.getElementById("username").value.trim();
    const dashboard = document.getElementById("dashboard");

    if (!username) return;
    if (!throttle()) return;

    logSearch(username);

    dashboard.innerHTML = "Loading…";

    const account = await getAccount(username);
    if (!account) {
        dashboard.innerHTML = "Account not found";
        return;
    }

    if (!blacklist.size) await loadBlacklist();

    const globals = await loadGlobals();
    const reputation = await getReputation(username);
    const ageDays = (Date.now() - new Date(account.created)) / 86400000;
    const hp = await computeHP(account);
    const ke = computeKE(account, globals);
    const blacklisted = blacklist.has(username);

    // Render base cards
    dashboard.innerHTML = `
        <div class="grid">
            ${card("Reputation", reputation, "repCard")}
            ${card("Account age (days)", Math.floor(ageDays))}
            ${card("Active HP", hp.toFixed(3))}
            ${loadingCard("Posts (7d)", "posts7d")}
            ${loadingCard("Comments (7d)", "comments7d")}
            ${loadingCard("Comment/Post ratio (7d)", "ratio7d")}
            ${loadingCard("Outgoing transfers (30d)", "transfersCard")}
            ${loadingCard("Incoming downvotes (30d)", "downvotesCard")}
            ${loadingCard("Muted by", "mutedCard")}
            ${card("Rewards/Stake Co-efficient (KE)", ke.krampus.toFixed(2))}
            ${card("Hivewatchers blacklist", blacklisted ? "YES" : "NO")}
        </div>

        <div id="transferTable"></div>
        <div id="downvoteTable"></div>
        <div id="muteTable"></div>
    `;

    // Apply color rules
    applyCardColors(reputation, ageDays, hp, ke.krampus, blacklisted);

    // HISTORY
    const history = await getHistory30d(username);

    // POSTS & COMMENTS
    const { posts, comments, ratio } = extractPostsComments7d(history, username);
    updateValue("posts7d", posts);
    updateValue("comments7d", comments);
    updateValue("ratio7d", ratio.toFixed(2));

    colorPostsComments(posts, comments, ratio);

    // TRANSFERS
    const transfers = extractTransfers(history, username);
    const summary = summarizeTransfers(transfers);

    renderTransfers(summary);

    // DOWNVOTES
    const downvotes = extractDownvotes(history, username);
    renderDownvotes(downvotes);

    // MUTES
    const muted = await getMuteList(username);
    renderMutes(muted);
};

// ----------------------------------------------------
// UI HELPERS
// ----------------------------------------------------

const card = (label, value, id = "") => `
    <div class="card" ${id ? `id="${id}"` : ""}>
        <div class="label">${label}</div>
        <div class="value">${value}</div>
    </div>
`;

const loadingCard = (label, id) => `
    <div class="card loading" id="${id}">
        <div class="label">${label}</div>
        <div class="value">Loading…</div>
    </div>
`;

const updateValue = (id, value) =>
    (document.getElementById(id).querySelector(".value").innerText = value);

const applyCardColors = (rep, age, hp, ke, blacklisted) => {
    const repCard = document.getElementById("repCard");
    repCard.className =
        rep <= 10 ? "card danger" : rep < 25 ? "card warning" : "card ok";

    document.getElementById("ageCard").className =
        "card " + (age < 31 ? "danger" : "ok");

    document.getElementById("hpCard").className =
        "card " + (hp < 100 ? "danger" : "ok");

    const keCard = document.getElementById("keCard");
    keCard.className =
        ke < 2 ? "card ok" : ke < 5 ? "card warning" : "card danger";

    document.getElementById("blacklistCard").className =
        "card " + (blacklisted ? "danger" : "ok");
};

const colorPostsComments = (posts, comments, ratio) => {
    const p = document.getElementById("postsCard");
    p.className = posts > 10 ? "card danger" : posts >= 8 ? "card warning" : "card ok";

    const c = document.getElementById("commentsCard");
    c.className =
        comments < 7 ? "card danger" : comments < 14 ? "card warning" : "card ok";

    const r = document.getElementById("ratioCard");
    r.className =
        ratio <= 0 ? "card danger" : ratio < 5 ? "card warning" : "card ok";
};

const renderTransfers = summary => {
    const card = document.getElementById("transfersCard");
    const total = summary.hive + summary.hbd;

    card.className =
        total === 0
            ? "card ok"
            : total <= 100
            ? "card warning"
            : "card danger";

    card.querySelector(".value").innerHTML = `
        ${summary.hive.toFixed(3)} HIVE<br>
        ${summary.hbd.toFixed(3)} HBD
    `;

    if (!Object.keys(summary.perUser).length) return;

    document.getElementById("transferTable").innerHTML = `
        <h3>Outgoing transfers (30d)</h3>
        <table>
            <tr><th>Recipient</th><th>Total</th></tr>
            ${Object.entries(summary.perUser)
                .map(([to, v]) => {
                    const label = EXCHANGE_ACCOUNTS.has(to.toLowerCase())
                        ? `${to} (exchange)`
                        : to;

                    return `
                        <tr class="danger-row">
                            <td>${label}</td>
                            <td>${v.hive.toFixed(3)} HIVE<br>${v.hbd.toFixed(3)} HBD</td>
                        </tr>
                    `;
                })
                .join("")}
        </table>
    `;
};

const renderDownvotes = map => {
    const total = Object.values(map).reduce((a, b) => a + b, 0);
    const card = document.getElementById("downvotesCard");

    card.className = "card " + (total > 0 ? "danger" : "ok");
    card.querySelector(".value").innerText = total;

    if (!total) return;

    document.getElementById("downvoteTable").innerHTML = `
        <h3>Incoming downvotes (30d)</h3>
        <table>
            <tr><th>User</th><th>Count</th></tr>
            ${Object.entries(map)
                .sort((a, b) => b[1] - a[1])
                .map(
                    ([user, count]) => `
                <tr class="danger-row">
                    <td>${user}</td>
                    <td>${count}</td>
                </tr>`
                )
                .join("")}
        </table>
    `;
};

const renderMutes = list => {
    const card = document.getElementById("mutedCard");
    const count = list.length;

    card.className =
        count >= 5 ? "card danger" : count > 0 ? "card warning" : "card ok";
    card.querySelector(".value").innerText = count;

    if (!count) return;

    document.getElementById("muteTable").innerHTML = `
        <table>
            <tr><th>User</th></tr>
            ${list
                .map(
                    u => `
                <tr class="danger-row">
                    <td>${u}</td>
                </tr>`
                )
                .join("")}
        </table>
    `;
};

// ----------------------------------------------------
// ENTER KEY SUPPORT
// ----------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("username");
    if (!input) return;

    input.addEventListener("keydown", e => {
        if (e.key === "Enter") checkUser();
    });
});
