// ----------------------------------------------------
// GLOBALS
// ----------------------------------------------------
let blacklist = new Set();
let globals = null;
let lastSearch = 0;

// Exchange accounts
const EXCHANGES = new Set(["binance-hot", "orinoco", "mxchive", "bdhivesteem"]);

// Hive API endpoint
const HIVE_API = "https://api.hive.blog";

// ----------------------------------------------------
// BASIC HELPERS
// ----------------------------------------------------
async function hiveCall(method, params) {
    const body = {
        jsonrpc: "2.0",
        id: 1,
        method,
        params
    };

    const res = await fetch(HIVE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        throw new Error(`Hive API HTTP ${res.status}`);
    }

    const json = await res.json();
    if (json.error) {
        throw new Error(json.error.message || "Hive API error");
    }
    return json.result;
}

function $(id) {
    return document.getElementById(id);
}

function show(el) {
    el.classList.remove("hidden");
}

function hide(el) {
    el.classList.add("hidden");
}

function setText(id, text, extraClass) {
    const el = $(id);
    el.textContent = text;
    el.className = "value";
    if (extraClass) el.classList.add(extraClass);
}

// ----------------------------------------------------
// GLOBAL PROPS + BLACKLIST
// ----------------------------------------------------
async function loadGlobals() {
    if (globals) return globals;
    globals = await hiveCall("condenser_api.get_dynamic_global_properties", []);
    return globals;
}

function initBlacklist() {
    blacklist = new Set([
        // voeg hier accounts toe indien gewenst
    ]);
}

// ----------------------------------------------------
// ACCOUNT FETCH
// ----------------------------------------------------
async function getAccount(name) {
    const res = await hiveCall("condenser_api.get_accounts", [[name]]);
    return res && res.length ? res[0] : null;
}

async function getAccountHistory(name, limit = 50) {
    const res = await hiveCall("condenser_api.get_account_history", [name, -1, limit]);
    return res || [];
}

async function getRcAccount(name) {
    try {
        const res = await hiveCall("rc_api.find_rc_accounts", [{ accounts: [name] }]);
        if (res && res.rc_accounts && res.rc_accounts.length) {
            return res.rc_accounts[0];
        }
    } catch (e) {
        console.warn("RC API error", e);
    }
    return null;
}

// ----------------------------------------------------
// CALCULATIONS
// ----------------------------------------------------
function repToScore(rawRep) {
    if (!rawRep) return 25;
    let rep = parseInt(rawRep, 10);
    if (isNaN(rep)) return 25;
    let neg = rep < 0;
    rep = Math.abs(rep);
    let out = Math.log10(rep);
    if (isNaN(out)) out = 0;
    out = Math.max(out - 9, 0);
    out = (neg ? -1 : 1) * out;
    out = out * 9 + 25;
    return out.toFixed(2);
}

function vestingToHp(vestingShares, totalVestingFundHive, totalVestingShares) {
    const vs = parseFloat(vestingShares.split(" ")[0]);
    const tvf = parseFloat(totalVestingFundHive.split(" ")[0]);
    const tvs = parseFloat(totalVestingShares.split(" ")[0]);
    if (!tvs) return 0;
    return (vs * tvf) / tvs;
}

function calcVotingPower(account, globals) {
    const now = Date.now();
    const vp = account.voting_power;
    const lastVoteTime = new Date(account.last_vote_time + "Z").getTime();
    const secondsPassed = (now - lastVoteTime) / 1000;
    let regenerated = (secondsPassed * 10000) / (5 * 24 * 60 * 60);
    let currentVp = Math.min(10000, vp + regenerated);
    return (currentVp / 100).toFixed(2);
}

function calcRcPercent(rcAccount) {
    if (!rcAccount) return null;
    const max = parseFloat(rcAccount.max_rc);
    const current = parseFloat(rcAccount.rc_manabar.current_mana);
    if (!max) return null;
    return ((current / max) * 100).toFixed(2);
}

// ----------------------------------------------------
// KE – KRAMPUS EFFICIENCY
// ----------------------------------------------------
function computeKE(account, globals) {
    if (!account || !globals) {
        return {
            authorRewards: 0,
            curationRewards: 0,
            hpBalance: 0,
            krampus: -1
        };
    }

    const authorRewards = account.posting_rewards / 1000;
    const curationRewards = account.curation_rewards / 1000;

    const totalVestingFundHive = parseFloat(globals.total_vesting_fund_hive.split(" ")[0]);
    const totalVestingShares = parseFloat(globals.total_vesting_shares.split(" ")[0]);
    const vestingShares = parseFloat(account.vesting_shares.split(" ")[0]);

    const hpBalance = totalVestingShares
        ? (totalVestingFundHive * vestingShares) / totalVestingShares
        : 0;

    const krampus = hpBalance ? (authorRewards + curationRewards) / hpBalance : -1;

    return {
        authorRewards,
        curationRewards,
        hpBalance,
        krampus
    };
}

// ----------------------------------------------------
// RENDERING
// ----------------------------------------------------
function renderAccount(account) {
    const isBlacklisted = blacklist.has(account.name);
    const isExchange = EXCHANGES.has(account.name);

    setText("accName", account.name);
    setText("accCreated", account.created.split("T")[0]);
    setText("accRep", repToScore(account.reputation));

    setText("accBlacklist", isBlacklisted ? "Ja" : "Nee", isBlacklisted ? "bad" : "good");
    setText("accExchange", isExchange ? "Ja" : "Nee", isExchange ? "bad" : "good");

    show($("accountSection"));
}

async function renderBalances(account) {
    const g = await loadGlobals();

    const hp = vestingToHp(
        account.vesting_shares,
        g.total_vesting_fund_hive,
        g.total_vesting_shares
    );

    setText("balHive", account.balance);
    setText("balHbd", account.hbd_balance);
    setText("balHp", hp.toFixed(3) + " HP");
    setText("balHiveSavings", account.savings_balance);
    setText("balHbdSavings", account.savings_hbd_balance);

    show($("balancesSection"));
}

async function renderVpRc(account) {
    const g = await loadGlobals();
    const vp = calcVotingPower(account, g);
    setText("vp", vp + " %");

    const rcAcc = await getRcAccount(account.name);
    const rc = calcRcPercent(rcAcc);
    if (rc === null) {
        setText("rc", "n.v.t.");
    } else {
        setText("rc", rc + " %");
    }

    show($("vpRcSection"));
}

async function renderKE(account) {
    const g = await loadGlobals();
    const ke = computeKE(account, g);

    setText("keValue", ke.krampus.toFixed(4));
    setText("keHp", ke.hpBalance.toFixed(3) + " HP");
    setText("keAuthor", ke.authorRewards.toFixed(3));
    setText("keCuration", ke.curationRewards.toFixed(3));

    show($("keSection"));
}

function renderHistory(history) {
    const tbody = $("historyBody");
    tbody.innerHTML = "";

    history
        .slice()
        .reverse()
        .forEach(([idx, op]) => {
            const tr = document.createElement("tr");

            const ts = op.timestamp || op[1]?.timestamp;
            const type = op.op ? op.op[0] : op[1]?.op?.[0];
            const data = op.op ? op.op[1] : op[1]?.op?.[1];

            const timeStr = ts ? ts.replace("T", " ").replace("Z", "") : "";
            const details = JSON.stringify(data).slice(0, 120) + (JSON.stringify(data).length > 120 ? "…" : "");

            tr.innerHTML = `
                <td>${idx}</td>
                <td>${timeStr}</td>
                <td>${type}</td>
                <td>${details}</td>
            `;

            tbody.appendChild(tr);
        });

    show($("historySection"));
}

// ----------------------------------------------------
// SEARCH FLOW
// ----------------------------------------------------
function showError(msg) {
    const el = $("error");
    el.textContent = msg;
    show(el);
}

function clearError() {
    hide($("error"));
}

function setLoading(on) {
    if (on) show($("loading"));
    else hide($("loading"));
}

async function searchUser(rawName) {
    const now = Date.now();
    if (now - lastSearch < 800) return;
    lastSearch = now;

    const name = (rawName || "").trim().toLowerCase();
    if (!name) {
        showError("Voer een gebruikersnaam in.");
        return;
    }

    clearError();
    setLoading(true);

    hide($("accountSection"));
    hide($("balancesSection"));
    hide($("vpRcSection"));
    hide($("keSection"));
    hide($("historySection"));

    try {
        const acc = await getAccount(name);
        if (!acc) {
            showError(`Account '${name}' bestaat niet.`);
            setLoading(false);
            return;
        }

        renderAccount(acc);
        await renderBalances(acc);
        await renderVpRc(acc);
        await renderKE(acc);

        const hist = await getAccountHistory(name, 50);
        renderHistory(hist);

    } catch (e) {
        console.error(e);
        showError("Er ging iets mis bij het ophalen van de gegevens.");
    } finally {
        setLoading(false);
    }
}

// ----------------------------------------------------
// URL SHORT USERNAME HANDLING
// ----------------------------------------------------
function getUsernameFromUrl() {
    const qs = window.location.search;
    if (!qs) return null;

    if (qs.startsWith("?") && !qs.includes("=")) {
        return decodeURIComponent(qs.substring(1));
    }

    const params = new URLSearchParams(qs);
    return params.get("user") || params.get("username") || null;
}

// ----------------------------------------------------
// INIT
// ----------------------------------------------------
function initEvents() {
    $("searchBtn").addEventListener("click", () => {
        searchUser($("username").value);
    });

    $("username").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            searchUser($("username").value);
        }
    });
}

async function init() {
    initBlacklist();
    initEvents();

    const fromUrl = getUsernameFromUrl();
    if (fromUrl) {
        $("username").value = fromUrl;
        searchUser(fromUrl);
    }
}

document.addEventListener("DOMContentLoaded", init);
