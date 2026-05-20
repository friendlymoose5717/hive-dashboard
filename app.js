let blacklist = new Set();
let hiveGlobals = null;
let lastSearch = 0;

// --------------------
// EXCHANGE ACCOUNTS
// --------------------
const EXCHANGE_ACCOUNTS = new Set([
    "binance-hot",
    "orinoco",
    "mxchive",
    "bdhivesteem"
]);

// --------------------
// DISCORD LOGGING
// --------------------
async function logSearch(username) {
    const webhookUrl = "https://discord.com/api/webhooks/1506564033141018674/p0rGAjrficEBUJ0v1jobUQXeyO8FL3gIU8roaMcDIH3QlmGl3gMKUutuV38FlwSB3kIR";

    const payload = {
        content: `🔍 Zoekopdracht: **${username}**`
    };

    try {
        await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error("Webhook fout:", err);
    }
}

function throttleSearch(username) {
    const now = Date.now();
    if (now - lastSearch < 1500) return;
    lastSearch = now;
    logSearch(username);
}

// --------------------
// LOAD GLOBAL PROPS
// --------------------
async function loadHiveGlobals() {
    if (hiveGlobals) return hiveGlobals;

    const res = await fetch("https://api.hive.blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "condenser_api.get_dynamic_global_properties",
            params: [],
            id: 1
        })
    });

    const json = await res.json();
    hiveGlobals = json.result;
    return hiveGlobals;
}

// --------------------
// BLACKLIST (SPAMINATOR)
// --------------------
async function loadBlacklist() {
    try {
        const res = await fetch("https://spaminator.me/api/bl/all.json");
        const data = await res.json();
        blacklist = new Set(data.result || []);
    } catch (err) {
        console.error("Error loading blacklist", err);
    }
}

function isBlacklisted(user) {
    return blacklist.has(user);
}

// --------------------
// ACCOUNT
// --------------------
async function getHiveAccount(username) {
    const res = await fetch("https://api.hive.blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "condenser_api.get_accounts",
            params: [[username]],
            id: 1
        })
    });

    const json = await res.json();
    return json.result?.[0] || null;
}

// --------------------
// REPUTATION
// --------------------
async function getReputation(username) {
    const res = await fetch("https://api.hive.blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "bridge.get_profile",
            params: { account: username },
            id: 1
        })
    });

    const json = await res.json();
    return json.result?.reputation || 0;
}

// --------------------
// HISTORY (30D)
// --------------------
async function getAccountHistory30d(username) {
    const limit = 1000;
    let from = -1;
    let all = [];

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let stop = false;

    while (!stop) {
        const res = await fetch("https://api.hive.blog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "condenser_api.get_account_history",
                params: [username, from, limit],
                id: 1
            })
        });

        const json = await res.json();
        const batch = json.result || [];

        if (!batch.length) break;

        for (const item of batch) {
            const ts = new Date(item[1].timestamp).getTime();
            if (ts < cutoff) {
                stop = true;
                break;
            }
            all.push(item);
        }

        from = batch[0][0] - 1;
    }

    return all;
}

// --------------------
// HELPERS
// --------------------
function getAgeDays(created) {
    return (Date.now() - new Date(created)) / (1000 * 60 * 60 * 24);
}

// --------------------
// KE CALCULATION
// --------------------
function computeKE(accountData, globalProperties) {
    const authorRewards = accountData ? accountData.posting_rewards / 1000 : 0;
    const curationRewards = accountData ? accountData.curation_rewards / 1000 : 0;

    const hpBalance =
        !accountData ||
        !globalProperties.total_vesting_shares ||
        !globalProperties.total_vesting_fund_hive
            ? 0
            : parseFloat(
                  (
                      parseFloat(globalProperties.total_vesting_fund_hive) *
                      (parseFloat(accountData.vesting_shares?.amount || accountData.vesting_shares) /
                          parseFloat(globalProperties.total_vesting_shares))
                  ).toFixed(3)
              );

    const krampus = hpBalance ? (authorRewards + curationRewards) / hpBalance : -1;

    return {
        authorRewards,
        curationRewards,
        hpBalance,
        krampus
    };
}

// --------------------
// POSTS & COMMENTS (7d)
// --------------------
function extractPostsAndComments7d(history, username) {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const user = username.toLowerCase();

    const excludedParents = [
        "peak.snaps",
        "ecency.waves",
        "leothreads",
        "liketu.moments"
    ];

    let posts = 0;
    let comments = 0;

    for (const item of history) {
        const op = item[1].op;
        if (!op || op[0] !== "comment") continue;

        const data = op[1];

        if (data.author.toLowerCase() !== user) continue;

        const ts = new Date(item[1].timestamp).getTime();
        if (ts < cutoff) continue;

        if (excludedParents.includes(data.parent_author.toLowerCase())) continue;

        if (data.parent_author === "") posts++;
        else comments++;
    }

    const ratio = posts > 0 ? comments / posts : 0;

    return { posts, comments, ratio };
}

// --------------------
// DOWNVOTES
// --------------------
function extractDownvotes(history, username) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const votes = {};
    const user = username.toLowerCase();

    for (const item of history) {
        const op = item[1].op;
        if (!op || op[0] !== "vote") continue;

        const vote = op[1];
        const ts = item[1].timestamp;

        const time = new Date(ts).getTime();
        if (time < cutoff) continue;

        if (vote.weight < 0 && vote.author.toLowerCase() === user) {
            votes[vote.voter] = {
                count: (votes[vote.voter]?.count || 0) + 1
            };
        }
    }

    return votes;
}

// --------------------
// OUTGOING TRANSFERS
// --------------------
function extractOutgoingTransfers(history, username) {
    const user = username.toLowerCase();

    return history
        .filter(h => h[1].op[0] === "transfer")
        .map(h => ({
            op: h[1].op[1],
            date: h[1].timestamp
        }))
        .filter(t => t.op.from.toLowerCase() === user)
        .map(t => ({
            to: t.op.to,
            amount: t.op.amount,
            memo: t.op.memo || "",
            date: t.date
        }));
}

// --------------------
// TRANSFER SUMMARY
// --------------------
function summarizeTransfers(transfers) {
    let totalHive = 0;
    let totalHbd = 0;
    const perUser = {};

    for (const t of transfers) {
        const [amountStr, currency] = t.amount.split(" ");
        const amount = parseFloat(amountStr);

        if (currency === "HIVE") totalHive += amount;
        if (currency === "HBD") totalHbd += amount;

        if (!perUser[t.to]) {
            perUser[t.to] = { totalHive: 0, totalHbd: 0 };
        }

        if (currency === "HIVE") perUser[t.to].totalHive += amount;
        if (currency === "HBD") perUser[t.to].totalHbd += amount;
    }

    return { totalHive, totalHbd, perUser };
}

// --------------------
// HP
// --------------------
async function getHP(account) {
    const globals = await loadHiveGlobals();

    const totalVestingFundHive = parseFloat(globals.total_vesting_fund_hive);
    const totalVestingShares = parseFloat(globals.total_vesting_shares);

    const vestingShares = parseFloat(account.vesting_shares);
    const receivedShares = parseFloat(account.received_vesting_shares);
    const delegatedShares = parseFloat(account.delegated_vesting_shares);

    const userVests = vestingShares + receivedShares - delegatedShares;

    const hp = userVests * (totalVestingFundHive / totalVestingShares);

    return hp;
}

// --------------------
// MAIN
// --------------------
async function checkUser() {
    const username = document.getElementById("username").value.trim();
    const dashboard = document.getElementById("dashboard");

    if (!username) return;

    throttleSearch(username);

    dashboard.innerHTML = "Loading...";

    const account = await getHiveAccount(username);

    if (!account || !account.name) {
        dashboard.innerHTML = "Account not found";
        return;
    }

    if (!blacklist.size) {
        await loadBlacklist();
    }

    const blacklisted = isBlacklisted(username);
    const ageDays = getAgeDays(account.created);
    const hp = await getHP(account);
    const globals = await loadHiveGlobals();
    const keData = computeKE(account, globals);
    const reputation = await getReputation(username);

    dashboard.innerHTML = `
        <div class="grid">

            <div class="card" id="repCard">
                <div class="label">Reputation</div>
                <div class="value" id="repValue">${reputation}</div>
            </div>

            <div class="card" id="ageCard">
                <div class="label">Account age (days)</div>
                <div class="value">${Math.floor(ageDays)}</div>
            </div>

            <div class="card" id="hpCard">
                <div class="label">Active HP</div>
                <div class="value">${hp.toFixed(3)}</div>
            </div>

            <div class="card loading" id="postsCard">
                <div class="label">Posts (7d)</div>
                <div class="value" id="posts7d">Loading…</div>
            </div>

            <div class="card loading" id="commentsCard">
                <div class="label">Comments (7d)</div>
                <div class="value" id="comments7d">Loading…</div>
            </div>

            <div class="card loading" id="ratioCard">
                <div class="label">Comment/Post ratio (7d)</div>
                <div class="value" id="ratio7d">Loading…</div>
            </div>

            <div class="card loading" id="transfersCard">
                <div class="label">Outgoing transfers (30d)</div>
                <div class="value">Loading…</div>
            </div>

            <div class="card loading" id="downvotesCard">
                <div class="label">Incoming downvotes (30d)</div>
                <div class="value">Loading…</div>
            </div>

            <div class="card" id="keCard">
                <div class="label">Rewards/Stake Co-efficient (KE)</div>
                <div class="value" id="keValue">${keData.krampus.toFixed(2)}</div>
            </div>

            <div class="card" id="blacklistCard">
                <div class="label">Hivewatchers blacklist</div>
                <div class="value">${blacklisted ? "YES" : "NO"}</div>
            </div>

        </div>

        <div id="transferTable"></div>
        <div id="downvoteTable"></div>
    `;

    // COLOR RULES
    const repCard = document.getElementById("repCard");
    if (reputation <= 10) repCard.className = "card danger";
    else if (reputation < 25) repCard.className = "card warning";
    else repCard.className = "card ok";

    document.getElementById("ageCard").className =
        "card " + (ageDays < 31 ? "danger" : "ok");

    document.getElementById("hpCard").className =
        "card " + (hp < 100 ? "danger" : "ok");

    const keCard = document.getElementById("keCard");
    if (keData.krampus < 2) keCard.className = "card ok";
    else if (keData.krampus < 5) keCard.className = "card warning";
    else keCard.className = "card danger";

    document.getElementById("blacklistCard").className =
        "card " + (blacklisted ? "danger" : "ok");

    // HISTORY
    const history = await getAccountHistory30d(username);

    const { posts, comments, ratio } = extractPostsAndComments7d(history, username);

    document.getElementById("posts7d").innerText = posts;
    document.getElementById("comments7d").innerText = comments;
    document.getElementById("ratio7d").innerText = ratio.toFixed(2);

    const postsCard = document.getElementById("postsCard");
    if (posts > 10) postsCard.className = "card danger";
    else if (posts >= 8) postsCard.className = "card warning";
    else postsCard.className = "card ok";

    const commentsCard = document.getElementById("commentsCard");
    if (comments < 7) commentsCard.className = "card danger";
    else if (comments < 14) commentsCard.className = "card warning";
    else commentsCard.className = "card ok";

    const ratioCard = document.getElementById("ratioCard");
    if (ratio <= 0) ratioCard.className = "card danger";
    else if (ratio < 5) ratioCard.className = "card warning";
    else ratioCard.className = "card ok";

    // TRANSFERS
    const outgoingTransfers = extractOutgoingTransfers(history, username);
    const summary = summarizeTransfers(outgoingTransfers);

    const totalHive = summary.totalHive;

    const transfersCard = document.getElementById("transfersCard");

    if (totalHive > 10) transfersCard.className = "card warning";
    else transfersCard.className = "card ok";

    transfersCard.querySelector(".value").innerHTML = `
        ${summary.totalHive.toFixed(3)} HIVE<br>
        ${summary.totalHbd.toFixed(3)} HBD
    `;

    if (Object.keys(summary.perUser).length > 0) {
        document.getElementById("transferTable").innerHTML = `
            <div class="table-title">Outgoing transfers (30d)</div>
            <table>
                <tr>
                    <th>Recipient</th>
                    <th>Total amount (30d)</th>
                </tr>

                ${Object.entries(summary.perUser)
                    .map(([to, data]) => {
                        const label = EXCHANGE_ACCOUNTS.has(to.toLowerCase())
                            ? `${to} (exchange)`
                            : to;

                        return `
                            <tr class="danger-row">
                                <td>${label}</td>
                                <td>
                                    ${data.totalHive.toFixed(3)} HIVE<br>
                                    ${data.totalHbd.toFixed(3)} HBD
                                </td>
                            </tr>
                        `;
                    }).join("")}
            </table>
        `;
    }

    // DOWNVOTES
    const downvotes = extractDownvotes(history, username);
    const totalDownvotes = Object.values(downvotes)
        .reduce((a, b) => a + (b.count || 0), 0);

    const downvotesCard = document.getElementById("downvotesCard");
    downvotesCard.className = "card " + (totalDownvotes > 0 ? "danger" : "ok");
    downvotesCard.querySelector(".value").innerText = totalDownvotes;

    if (totalDownvotes > 0) {
        document.getElementById("downvoteTable").innerHTML = `
            <div class="table-title">Incoming downvotes (30d)</div>
            <table>
                <tr>
                    <th>User</th>
                    <th>Count (30d)</th>
                </tr>

                ${Object.entries(downvotes)
                    .sort((a, b) => b[1].count - a[1].count)
                    .map(([user, data]) => `
                        <tr class="danger-row">
                            <td>${user}</td>
                            <td>${data.count}</td>
                        </tr>
                    `).join("")}
            </table>
        `;
    }

    // DISCORD LINK
    dashboard.innerHTML += `
        <div style="text-align:center; margin-top:20px;">
            <a href="https://discord.gg/txTGEH5zr4"
