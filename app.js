// ----------------------------------------------------
// GLOBALS
// ----------------------------------------------------
let blacklist = new Set();
let globals = null;
let lastSearch = 0;

// Exchange accounts
const EXCHANGES = new Set([
    "deepcrypto8","binance-hot","poloniex","bittrex","upbitsteem",
    "hot.dunamu","hot1.dunamu","hot2.dunamu","hot3.dunamu","hot4.dunamu","hot5.dunamu",
    "bithumbsend2","bithumbrecv2","bt20hivedkdnel","blocktrades","huobi-withdrawal",
    "huobi-pro","user.dunamu","cold.dunamu","gateiodeposit","indodaxofficial",
    "orinoco","xbts","ionomy","cryptex24","upbitshotwallet1","upbitsusers","xbtsio",
    "mxchive","bdhivesteem"
]);

// Swap / DEX services
const DEX_SERVICES = new Set([
    "honey-swap","hiveswap","hive-engine","leodex","uswap","uswap.hbd",
    "keychain.swap","graphene-swap","swap.app","capybaraexchange","sw4p",
    "p-hbd","bnb-hbd","logicswap","swapbase","demotruktrade","chaoxing",
    "market.backup","swaplane","swaplane2","quikswap","happycustomer"
]);

// ----------------------------------------------------
// SAFE API WRAPPER WITH TIMEOUT
// ----------------------------------------------------
async function api(method, params = [], timeout = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        const r = await fetch("https://api.hive.blog", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 })
        });

        clearTimeout(timer);
        const j = await r.json();
        return j.result;
    } catch (e) {
        console.error("API timeout/error:", method, e);
        return null;
    }
}

const daysAgo = d => Date.now() - d * 86400000;

function setCard(id, value, status) {
    const el = document.getElementById(id);
    el.querySelector(".value").innerHTML = value;
    el.className = "card " + status;
}

function anonId() {
    let id = localStorage.getItem("anon_id");
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem("anon_id", id);
    }
    return id;
}

// ----------------------------------------------------
// LOGGING
// ----------------------------------------------------
async function logSearch(username) {
    try {
        await fetch(
            "https://discord.com/api/webhooks/1506564033141018674/p0rGAjrficEBUJ0v1jobUQXeyO8FL3gIU8roaMcDIH3QlmGl3gMKUutuV38FlwSB3kIR",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: `🔍 Search: **${username}**\n🆔 Anonymous ID: \`${anonId()}\``
                })
            }
        );
    } catch (e) {
        console.error("Webhook error:", e);
    }
}

function throttle() {
    const now = Date.now();
    if (now - lastSearch < 1500) return false;
    lastSearch = now;
    return true;
}

// ----------------------------------------------------
// LOADERS
// ----------------------------------------------------
async function loadGlobals() {
    if (globals) return globals;
    globals = await api("condenser_api.get_dynamic_global_properties");
    return globals;
}

async function loadBlacklist() {
    try {
        const res = await fetch("https://spaminator.me/api/bl/all.json");
        const data = await res.json();
        blacklist = new Set(data.result || []);
    } catch (e) {
        console.error("Blacklist load error:", e);
    }
}

// ----------------------------------------------------
// ACCOUNT DATA
// ----------------------------------------------------
async function getAccount(u) {
    const r = await api("condenser_api.get_accounts", [[u]]);
    return r?.[0] || null;
}

// Reputation (no bridge.get_profile)
function calcRep(raw) {
    if (!raw) return 25;
    const rep = Math.log10(Math.abs(raw));
    let out = Math.max((rep - 9) * 9 + 25, 0);
    if (raw < 0) out = 50 - out;
    return out.toFixed(2);
}

async function getHP(acc) {
    const g = await loadGlobals();
    if (!g) return 0;

    const fund = parseFloat(g.total_vesting_fund_hive);
    const shares = parseFloat(g.total_vesting_shares);

    const vs = parseFloat(acc.vesting_shares);
    const rs = parseFloat(acc.received_vesting_shares);
    const ds = parseFloat(acc.delegated_vesting_shares);

    return (vs + rs - ds) * (fund / shares);
}

async function getDelegatedHP(acc) {
    const g = await loadGlobals();
    if (!g) return 0;

    const fund = parseFloat(g.total_vesting_fund_hive);
    const shares = parseFloat(g.total_vesting_shares);
    const ds = parseFloat(acc.delegated_vesting_shares);

    return ds * (fund / shares);
}

// ----------------------------------------------------
// FAST HISTORY LOADER (1 batch max)
// ----------------------------------------------------
async function getHistory30d(user) {
    const limit = 1000;
    const batch = await api("condenser_api.get_account_history", [user, -1, limit]);

    if (!batch) return [];

    const cutoff = daysAgo(30);
    const out = [];

    for (const h of batch) {
        const ts = new Date(h[1].timestamp).getTime();
        if (ts >= cutoff) out.push(h);
    }

    return out;
}

// ----------------------------------------------------
// METRICS
// ----------------------------------------------------
function postsComments7d(history, user) {
    const cutoff = daysAgo(7);
    let posts = 0, comments = 0;
    const seen = new Set();

    for (const h of history) {
        const op = h[1].op;
        if (!op || op[0] !== "comment") continue;

        const c = op[1];
        if (c.author.toLowerCase() !== user) continue;

        const ts = new Date(h[1].timestamp).getTime();
        if (ts < cutoff) continue;

        if (seen.has(c.permlink)) continue;
        seen.add(c.permlink);

        const isPost =
            c.parent_author === "" &&
            c.title.trim().length > 0 &&
            !c.permlink.startsWith("re-");

        if (isPost) posts++;
        else comments++;
    }

    return { posts, comments, ratio: posts ? comments / posts : 0 };
}

function downvotes(history, user) {
    const cutoff = daysAgo(30);
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
}

function outgoingTransfers(history, user) {
    return history
        .filter(h => h[1].op[0] === "transfer")
        .map(h => h[1].op[1])
        .filter(t => t.from.toLowerCase() === user);
}

function summarizeTransfers(list) {
    let hive = 0, hbd = 0;
    const perUser = {};

    for (const t of list) {
        const [amt, cur] = t.amount.split(" ");
        const v = parseFloat(amt);

        if (cur === "HIVE") hive += v;
        if (cur === "HBD") hbd += v;

        if (!perUser[t.to]) perUser[t.to] = { hive: 0, hbd: 0 };
        if (cur === "HIVE") perUser[t.to].hive += v;
        if (cur === "HBD") perUser[t.to].hbd += v;
    }

    return { hive, hbd, perUser };
}

// ----------------------------------------------------
// KE — KRAMPUS EFFICIENCY
// ----------------------------------------------------
async function computeKE(acc) {
    const g = await loadGlobals();
    if (!g) return { authorRewards: 0, curationRewards: 0, hpBalance: 0, krampus: 0 };

    const authorRewards = acc.posting_rewards / 1000;
    const curationRewards = acc.curation_rewards / 1000;

    const fund = parseFloat(g.total_vesting_fund_hive);
    const shares = parseFloat(g.total_vesting_shares);
    const vesting = parseFloat(acc.vesting_shares);

    const hpBalance = shares ? (fund * vesting) / shares : 0;
    const krampus = hpBalance ? (authorRewards + curationRewards) / hpBalance : 0;

    return { authorRewards, curationRewards, hpBalance, krampus };
}
// ----------------------------------------------------
// MAIN
// ----------------------------------------------------
async function checkUser() {
    const user = document.getElementById("username").value.trim().toLowerCase();
    if (!user || !throttle()) return;

    logSearch(user);

    const dash = document.getElementById("dashboard");
    dash.innerHTML = "Loading…";

    const acc = await getAccount(user);
    if (!acc) return dash.innerHTML = "Account not found";

    if (!blacklist.size) await loadBlacklist();

    const rep = calcRep(acc.reputation);
    const age = Math.floor((Date.now() - new Date(acc.created)) / 86400000);
    const hp = await getHP(acc);
    const dHP = await getDelegatedHP(acc);
    const dPct = (hp + dHP) > 0 ? (dHP / (hp + dHP)) * 100 : 0;
    const isBL = blacklist.has(user);

    const ke = await computeKE(acc);

    dash.innerHTML = `
        <div class="grid">
            <div class="card" id="repCard"><div class="label">Reputation</div><div class="value">${rep}</div></div>
            <div class="card" id="ageCard"><div class="label">Account age (days)</div><div class="value">${age}</div></div>
            <div class="card" id="hpCard"><div class="label">Active HP</div><div class="value">${hp.toFixed(3)}</div></div>

            <div class="card" id="delegatedCard"><div class="label">Delegated HP</div><div class="value">${dHP.toFixed(3)}</div></div>
            <div class="card" id="delegationPctCard"><div class="label">Delegation %</div><div class="value">${dPct.toFixed(1)}%</div></div>

            <div class="card" id="keCard"><div class="label">KE (Krampus Efficiency)</div><div class="value">${ke.krampus.toFixed(4)}</div></div>

            <div class="card loading" id="postsCard"><div class="label">Posts (7d)</div><div class="value">Loading…</div></div>
            <div class="card loading" id="commentsCard"><div class="label">Comments (7d)</div><div class="value">Loading…</div></div>
            <div class="card loading" id="ratioCard"><div class="label">Comment/Post ratio</div><div class="value">Loading…</div></div>

            <div class="card loading" id="transfersCard"><div class="label">Outgoing transfers (30d)</div><div class="value">Loading…</div></div>
            <div class="card loading" id="downvotesCard"><div class="label">Incoming downvotes (30d)</div><div class="value">Loading…</div></div>

            <div class="card" id="blacklistCard"><div class="label">Hivewatchers blacklist</div><div class="value">${isBL ? "YES" : "NO"}</div></div>
        </div>

        <h3>Outgoing transfers (30d)</h3>
        <div id="transferTable"></div>

        <h3>Incoming downvotes (30d)</h3>
        <div id="downvoteTable"></div>
    `;

    // Color rules
    setCard("repCard", rep, rep <= 10 ? "danger" : rep < 25 ? "warning" : "ok");
    setCard("ageCard", age, age < 31 ? "danger" : "ok");
    setCard("hpCard", hp.toFixed(3), hp < 100 ? "danger" : "ok");

    setCard("delegatedCard", dHP.toFixed(3), dHP > 25000 ? "warning" : "ok");
    setCard("delegationPctCard", dPct.toFixed(1) + "%", dPct > 50 ? "danger" : dPct > 25 ? "warning" : "ok");

    setCard("blacklistCard", isBL ? "YES" : "NO", isBL ? "danger" : "ok");

    const keStatus =
        ke.krampus < 2 ? "ok" :
        ke.krampus < 5 ? "warning" :
        "danger";

    setCard("keCard", ke.krampus.toFixed(4), keStatus);

    // HISTORY
    const hist = await getHistory30d(user);

    const pc = postsComments7d(hist, user);
    setCard("postsCard", pc.posts, pc.posts > 10 ? "danger" : pc.posts >= 8 ? "warning" : "ok");
    setCard("commentsCard", pc.comments, pc.comments < 7 ? "danger" : pc.comments < 14 ? "warning" : "ok");

    const ratioStatus =
        pc.posts === 0 ? "ok" :
        pc.ratio < 0 ? "warning" :
        "ok";

    setCard("ratioCard", pc.ratio.toFixed(2), ratioStatus);

    // TRANSFERS
    const transfers = outgoingTransfers(hist, user);
    const sum = summarizeTransfers(transfers);

    const tStatus = (sum.hive > 10 || sum.hbd > 5) ? "warning" : "ok";
    setCard("transfersCard", `${sum.hive.toFixed(3)} HIVE<br>${sum.hbd.toFixed(3)} HBD`, tStatus);

    if (Object.keys(sum.perUser).length) {
        document.getElementById("transferTable").innerHTML = `
            <table>
                <tr><th>Recipient</th><th>Total</th></tr>
                ${Object.entries(sum.perUser).map(([to, v]) => `
                    <tr class="danger-row">
                        <td>
                            ${
                                EXCHANGES.has(to.toLowerCase())
                                    ? to + " (exchange)"
                                    : DEX_SERVICES.has(to.toLowerCase())
                                        ? to + " (Swap/DEX service)"
                                        : to
                            }
                        </td>
                        <td>${v.hive.toFixed(3)} HIVE<br>${v.hbd.toFixed(3)} HBD</td>
                    </tr>
                `).join("")}
            </table>
        `;
    }

    // DOWNVOTES
    const dv = downvotes(hist, user);
    const totalDV = Object.values(dv).reduce((a, b) => a + b, 0);

    const dvStatus = totalDV >= 10 ? "danger" : totalDV > 0 ? "warning" : "ok";
    setCard("downvotesCard", totalDV, dvStatus);

    if (totalDV > 0) {
        document.getElementById("downvoteTable").innerHTML = `
            <table>
                <tr><th>User</th><th>Count</th></tr>
                ${Object.entries(dv).sort((a, b) => b[1] - a[1]).map(([u, c]) => `
                    <tr class="danger-row"><td>${u}</td><td>${c}</td></tr>
                `).join("")}
            </table>
        `;
    }
}

// ----------------------------------------------------
// ENTER KEY
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("username").addEventListener("keydown", e => {
        if (e.key === "Enter") checkUser();
    });
});
