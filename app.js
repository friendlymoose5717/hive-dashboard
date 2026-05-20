// ----------------------------------------------------
// GLOBALS
// ----------------------------------------------------
let blacklist = new Set();
let globals = null;
let lastSearch = 0;

// Exchange accounts (niet meetellen in sommige stats)
const EXCHANGES = new Set(["binance-hot", "orinoco", "mxchive", "bdhivesteem"]);

// Hive API endpoint
const HIVE_API = "https://api.hive.blog";

// ----------------------------------------------------
// HELPER: API CALL
// ----------------------------------------------------
async function hiveApiCall(method, params = []) {
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
        throw new Error(`Hive API error: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    if (json.error) {
        throw new Error(`Hive RPC error: ${JSON.stringify(json.error)}`);
    }
    return json.result;
}

// ----------------------------------------------------
// GLOBALS LADEN
// ----------------------------------------------------
async function loadGlobals() {
    if (globals) return globals;

    const dgp = await hiveApiCall("condenser_api.get_dynamic_global_properties", []);
    globals = {
        total_vesting_fund_hive: parseFloat(dgp.total_vesting_fund_hive.split(" ")[0]),
        total_vesting_shares: parseFloat(dgp.total_vesting_shares.split(" ")[0]),
        head_block_number: dgp.head_block_number,
        time: dgp.time
    };
    return globals;
}

// ----------------------------------------------------
// CONVERSIES
// ----------------------------------------------------
function hiveToVests(hiveAmount) {
    if (!globals) return 0;
    const { total_vesting_fund_hive, total_vesting_shares } = globals;
    return hiveAmount * (total_vesting_shares / total_vesting_fund_hive);
}

function vestsToHP(vests) {
    if (!globals) return 0;
    const { total_vesting_fund_hive, total_vesting_shares } = globals;
    return vests * (total_vesting_fund_hive / total_vesting_shares);
}

// ----------------------------------------------------
// ACCOUNT DATA
// ----------------------------------------------------
async function getAccount(username) {
    const res = await hiveApiCall("condenser_api.get_accounts", [[username]]);
    if (!res || !res.length) {
        throw new Error("Account niet gevonden");
    }
    return res[0];
}

async function getRC(username) {
    const res = await hiveApiCall("rc_api.find_rc_accounts", [{ accounts: [username] }]);
    if (!res || !res.rc_accounts || !res.rc_accounts.length) return null;
    return res.rc_accounts[0];
}

async function getAccountHistory(username, limit = 1000) {
    // laatste N operaties
    const res = await hiveApiCall("condenser_api.get_account_history", [username, -1, limit]);
    return res || [];
}

async function getVestingDelegationsOut(username, limit = 1000) {
    const res = await hiveApiCall("condenser_api.get_vesting_delegations", [username, "", limit]);
    return res || [];
}

async function getVestingDelegationsIn(username, limit = 1000) {
    const res = await hiveApiCall("condenser_api.get_vesting_delegations", ["", username, limit]);
    // filter op ontvangen delegaties
    return (res || []).filter(d => d.delegatee === username);
}

// Pending rewards
async function getRewardFund() {
    const res = await hiveApiCall("condenser_api.get_reward_fund", ["post"]);
    return res;
}

// ----------------------------------------------------
// REPUTATION
// ----------------------------------------------------
function rawReputationToScore(rawRep) {
    if (rawRep == null) return 25;
    let rep = Number(rawRep);
    if (isNaN(rep)) return 25;
    let neg = rep < 0;
    rep = Math.abs(rep);
    let out = Math.log10(rep);
    if (isNaN(out)) out = 0;
    out = Math.max(out - 9, 0);
    if (neg) out *= -1;
    out = out * 9 + 25;
    return Math.round(out * 100) / 100;
}

// ----------------------------------------------------
// KE METRIC (voorbeeld)
// ----------------------------------------------------
// KE = HP + liquid HIVE + (HBD * 1)  (je kunt dit zelf tweaken)
function calculateKE({ hp, liquidHive, hbd }) {
    return hp + liquidHive + hbd;
}

// ----------------------------------------------------
// BLACKLIST
// ----------------------------------------------------
function addToBlacklist(username) {
    blacklist.add(username.toLowerCase());
    renderBlacklist();
}

function removeFromBlacklist(username) {
    blacklist.delete(username.toLowerCase());
    renderBlacklist();
}

function isBlacklisted(username) {
    return blacklist.has(username.toLowerCase());
}

// ----------------------------------------------------
// RENDER HELPERS
// ----------------------------------------------------
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setHtml(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = value;
}

function setClass(id, className) {
    const el = document.getElementById(id);
    if (el) el.className = className;
}

// KE kleur op basis van thresholds
function getKEClass(ke) {
    if (ke >= 10000) return "ke-high";
    if (ke >= 1000) return "ke-mid";
    return "ke-low";
}

// HP kleur
function getHPClass(hp) {
    if (hp >= 1000) return "hp-high";
    if (hp >= 100) return "hp-mid";
    return "hp-low";
}

// RC kleur (percentage)
function getRCClass(rcPercent) {
    if (rcPercent >= 80) return "rc-high";
    if (rcPercent >= 40) return "rc-mid";
    return "rc-low";
}

// ----------------------------------------------------
// RENDER BLACKLIST
// ----------------------------------------------------
function renderBlacklist() {
    const container = document.getElementById("blacklistContainer");
    if (!container) return;

    if (blacklist.size === 0) {
        container.innerHTML = "<em>Geen accounts in blacklist</em>";
        return;
    }

    const items = Array.from(blacklist).sort();
    container.innerHTML = items
        .map(
            u =>
                `<span class="badge bg-danger me-1">${u} <button data-user="${u}" class="btn btn-sm btn-light remove-blacklist-btn">x</button></span>`
        )
        .join("");

    container.querySelectorAll(".remove-blacklist-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            const user = e.target.getAttribute("data-user");
            removeFromBlacklist(user);
        });
    });
}

// ----------------------------------------------------
// DELEGATION TABLES
// ----------------------------------------------------
function renderDelegationsOut(username, delegations) {
    const tbody = document.getElementById("delegationsOutBody");
    if (!tbody) return;

    if (!delegations.length) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center">Geen uitgaande delegaties</td></tr>`;
        return;
    }

    tbody.innerHTML = delegations
        .map(d => {
            const delegatee = d.delegatee;
            const vests = parseFloat(d.vesting_shares.split(" ")[0]);
            const hp = vestsToHP(vests);
            const isEx = EXCHANGES.has(delegatee);
            return `
                <tr class="${isEx ? "table-warning" : ""}">
                    <td>${delegatee}</td>
                    <td class="text-end">${hp.toFixed(3)}</td>
                    <td>${isEx ? "Exchange" : ""}</td>
                </tr>
            `;
        })
        .join("");
}

function renderDelegationsIn(username, delegations) {
    const tbody = document.getElementById("delegationsInBody");
    if (!tbody) return;

    if (!delegations.length) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center">Geen inkomende delegaties</td></tr>`;
        return;
    }

    tbody.innerHTML = delegations
        .map(d => {
            const delegator = d.delegator;
            const vests = parseFloat(d.vesting_shares.split(" ")[0]);
            const hp = vestsToHP(vests);
            const isEx = EXCHANGES.has(delegator);
            return `
                <tr class="${isEx ? "table-warning" : ""}">
                    <td>${delegator}</td>
                    <td class="text-end">${hp.toFixed(3)}</td>
                    <td>${isEx ? "Exchange" : ""}</td>
                </tr>
            `;
        })
        .join("");
}

// ----------------------------------------------------
// MAIN RENDER ACCOUNT
// ----------------------------------------------------
async function renderAccount(username) {
    username = username.trim().toLowerCase();
    if (!username) return;

    const now = Date.now();
    if (now - lastSearch < 1000) {
        // simpele throttle
        return;
    }
    lastSearch = now;

    setText("statusText", "Laden...");
    setClass("statusText", "text-muted");

    try {
        await loadGlobals();

        const [account, rc, delegOut, delegIn] = await Promise.all([
            getAccount(username),
            getRC(username),
            getVestingDelegationsOut(username),
            getVestingDelegationsIn(username)
        ]);

        // --- Basis balances
        const balanceHive = parseFloat(account.balance.split(" ")[0]);
        const balanceHbd = parseFloat(account.hbd_balance.split(" ")[0]);
        const savingsHive = parseFloat(account.savings_balance.split(" ")[0]);
        const savingsHbd = parseFloat(account.savings_hbd_balance.split(" ")[0]);

        const vestingShares = parseFloat(account.vesting_shares.split(" ")[0]);
        const receivedVestingShares = parseFloat(account.received_vesting_shares.split(" ")[0]);
        const delegatedVestingShares = parseFloat(account.delegated_vesting_shares.split(" ")[0]);

        const ownVests = vestingShares - delegatedVestingShares;
        const ownHP = vestsToHP(ownVests);
        const receivedHP = vestsToHP(receivedVestingShares);
        const delegatedHP = vestsToHP(delegatedVestingShares);
        const totalHP = vestsToHP(vestingShares + receivedVestingShares - delegatedVestingShares);

        const reputation = rawReputationToScore(account.reputation);

        // RC
        let rcPercent = null;
        if (rc && rc.max_rc > 0) {
            rcPercent = (rc.rc_manabar.current_mana / rc.max_rc) * 100;
        }

        // KE
        const ke = calculateKE({
            hp: totalHP,
            liquidHive: balanceHive + savingsHive,
            hbd: balanceHbd + savingsHbd
        });

        // Blacklist status
        const blacklisted = isBlacklisted(username);

        // --- Render basics
        setText("accountName", account.name);
        setText("accountReputation", reputation.toFixed(2));
        setText("accountCreated", account.created.split("T")[0]);

        setText("balanceHive", balanceHive.toFixed(3));
        setText("balanceHbd", balanceHbd.toFixed(3));
        setText("savingsHive", savingsHive.toFixed(3));
        setText("savingsHbd", savingsHbd.toFixed(3));

        setText("hpOwn", ownHP.toFixed(3));
        setText("hpReceived", receivedHP.toFixed(3));
        setText("hpDelegated", delegatedHP.toFixed(3));
        setText("hpTotal", totalHP.toFixed(3));

        setText("keValue", ke.toFixed(3));
        setClass("keCard", `card ${getKEClass(ke)}`);

        if (rcPercent != null) {
            setText("rcPercent", rcPercent.toFixed(1) + " %");
            setClass("rcCard", `card ${getRCClass(rcPercent)}`);
        } else {
            setText("rcPercent", "n/a");
            setClass("rcCard", "card rc-low");
        }

        setClass("hpCard", `card ${getHPClass(totalHP)}`);

        // Blacklist knop
        const blBtn = document.getElementById("blacklistToggleBtn");
        if (blBtn) {
            blBtn.textContent = blacklisted ? "Verwijder uit blacklist" : "Voeg toe aan blacklist";
            blBtn.onclick = () => {
                if (isBlacklisted(username)) {
                    removeFromBlacklist(username);
                } else {
                    addToBlacklist(username);
                }
                renderAccount(username); // refresh status
            };
        }

        // Delegaties
        renderDelegationsOut(username, delegOut);
        renderDelegationsIn(username, delegIn);

        setText("statusText", "Klaar");
        setClass("statusText", "text-success");
    } catch (err) {
        console.error(err);
        setText("statusText", "Fout: " + err.message);
        setClass("statusText", "text-danger");
    }
}

// ----------------------------------------------------
// INIT UI
// ----------------------------------------------------
function initUI() {
    const input = document.getElementById("accountInput");
    const btn = document.getElementById("searchBtn");

    if (btn && input) {
        btn.addEventListener("click", () => {
            const username = input.value;
            renderAccount(username);
        });

        input.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                renderAccount(input.value);
            }
        });
    }

    renderBlacklist();
}

// ----------------------------------------------------
// DOM READY
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    initUI();
});
