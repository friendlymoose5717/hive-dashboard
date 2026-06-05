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

const SWAP_DEX = new Set([
  "honey-swap","hiveswap","hive-engine","leodex","uswap","uswap.hbd",
  "keychain.swap","graphene-swap","swap.app","capybaraexchange","sw4p",
  "p-hbd","bnb-hbd","logicswap","swapbase","demotruktrade","chaoxing",
  "market.backup","swaplane","swaplane2","quikswap","happycustomer"
]);

// Tooltips
const TOOLTIPS = {
  repCard: "Reputation score based on upvotes received.",
  ageCard: "Number of days since the account was created.",
  hpCard: "Hive Power: your effective stake used for voting.",
  delegationPctCard: "Percentage of total HP that is delegated.",
  postsCard: "Number of posts created in the last 7 days.",
  commentsCard: "Number of comments made in the last 7 days.",
  ratioCard: "Comments divided by posts.",
  transfersCard: "Total outgoing transfers in the last 30 days.",
  downvotesCard: "Incoming downvotes in the last 30 days.",
  keCard: "KE — Rewards/Stake Co-efficient.",
  blacklistCard: "Hivewatchers blacklist status.",
  uniqueUpvotesCard: "Unique authors you upvoted in the last 30 days."
};

// Human‑readable labels voor settings
const BLOCK_LABELS = {
  repCard: "Reputation",
  ageCard: "Account age (days)",
  hpCard: "Active HP",
  delegationPctCard: "Delegation %",
  postsCard: "Posts (7d)",
  commentsCard: "Comments (7d)",
  ratioCard: "Comment/Post ratio",
  transfersCard: "Outgoing transfers (30d)",
  downvotesCard: "Incoming downvotes (30d)",
  keCard: "KE (Rewards/Stake Co-efficient)",
  blacklistCard: "Hivewatchers blacklist",
  uniqueUpvotesCard: "Unique author upvotes (30d)"
};

const BLOCKS = [
  "repCard",
  "ageCard",
  "hpCard",
  "delegationPctCard",
  "keCard",
  "postsCard",
  "commentsCard",
  "ratioCard",
  "transfersCard",
  "downvotesCard",
  "uniqueUpvotesCard",
  "blacklistCard"
];

// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------
const api = (method, params = []) =>
  fetch("https://api.hive.blog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 })
  })
    .then(r => r.json())
    .then(j => j.result);

const daysAgo = d => Date.now() - d * 86400000;

const setCard = (id, value, status) => {
  const el = document.getElementById(id);
  if (!el) return;
  const v = el.querySelector(".value");
  if (v) v.innerHTML = value;
  el.className = "card " + status;
};

const anonId = () => {
  let id = localStorage.getItem("anon_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("anon_id", id);
  }
  return id;
};

// ----------------------------------------------------
// LOGIN STATE
// ----------------------------------------------------
let loggedInUser = null;
let userPreferences = { hiddenBlocks: [] };

// ----------------------------------------------------
// LOGOUT FUNCTION
// ----------------------------------------------------
function logoutUser() {
  loggedInUser = null;
  userPreferences = { hiddenBlocks: [] };

  const statusEl = document.getElementById("loginStatus");
  if (statusEl) statusEl.innerHTML = "";

  const btn = document.getElementById("kcLoginBtn");
  if (btn) {
    btn.innerHTML = "Keychain Login";
    btn.onclick = loginWithKeychain;
  }

  applyBlockVisibility();
  alert("You are now logged out.");
}

// ----------------------------------------------------
// KEYCHAIN LOGIN
// ----------------------------------------------------
async function loginWithKeychain() {
  if (!window.hive_keychain) {
    alert("Hive Keychain is not installed.");
    return;
  }

  const input = document.getElementById("loginUserInput");
  const username = input ? input.value.trim() : "";
  if (!username) {
    alert("Please enter your Hive username first.");
    return;
  }

  hive_keychain.requestSignBuffer(
    username,
    "login-" + Date.now(),
    "Posting",
    async (res) => {
      if (res.success) {
        loggedInUser = username.toLowerCase();

        const statusEl = document.getElementById("loginStatus");
        if (statusEl) {
          statusEl.innerHTML = "Logged in as @" + loggedInUser;
        }

        const btn = document.getElementById("kcLoginBtn");
        if (btn) {
          btn.innerHTML = "Keychain Logout";
          btn.onclick = logoutUser;
        }

        await logLogin(loggedInUser);
        await loadUserPreferences();
        renderSettingsPanel();
      } else {
        alert("Login failed.");
      }
    }
  );
}

// ----------------------------------------------------
// LOAD USER PREFERENCES
// ----------------------------------------------------
async function loadUserPreferences() {
  if (!loggedInUser) {
    userPreferences = { hiddenBlocks: [] };
    return;
  }

  const history = await api("condenser_api.get_account_history", [
    loggedInUser,
    -1,
    1000
  ]);

  userPreferences = { hiddenBlocks: [] };

  for (const h of history.reverse()) {
    const op = h[1].op;
    if (op[0] === "custom_json" && op[1].id === "hive-dashboard-prefs") {
      try {
        const data = JSON.parse(op[1].json);
        userPreferences = data.prefs || { hiddenBlocks: [] };
        return;
      } catch (e) {
        console.error("Prefs parse error:", e);
      }
    }
  }
}

// ----------------------------------------------------
// SAVE USER PREFERENCES
// ----------------------------------------------------
async function saveUserPreferences() {
  if (!loggedInUser) {
    alert("Settings can only be saved when logged in.");
    return;
  }

  const json = {
    app: "hive-account-health-dashboard",
    prefs: userPreferences
  };

  hive_keychain.requestCustomJson(
    loggedInUser,
    "hive-dashboard-prefs",
    "Posting",
    JSON.stringify(json),
    "Save dashboard preferences",
    (res) => {
      if (!res.success) {
        alert("Failed to save preferences.");
      }
    }
  );
}

// ----------------------------------------------------
// SETTINGS PANEL
// ----------------------------------------------------
function renderSettingsPanel() {
  const panel = document.getElementById("settingsPanel");
  const content = document.getElementById("settingsContent");
  if (!panel || !content) return;

  panel.style.display = "block";

  // Close button (X) – één keer toevoegen
  if (!document.getElementById("settingsCloseBtn")) {
    const closeBtn = document.createElement("button");
    closeBtn.id = "settingsCloseBtn";
    closeBtn.innerHTML = "×";
    closeBtn.style.position = "absolute";
    closeBtn.style.top = "8px";
    closeBtn.style.right = "8px";
    closeBtn.style.border = "none";
    closeBtn.style.background = "transparent";
    closeBtn.style.fontSize = "20px";
    closeBtn.style.cursor = "pointer";
    closeBtn.addEventListener("click", () => {
      panel.style.display = "none";
    });
    panel.appendChild(closeBtn);
  }

  if (!loggedInUser) {
    content.innerHTML = `<p>Settings can only be saved when logged in.</p>`;
    return;
  }

  content.innerHTML = BLOCKS.map(id => `
    <label style="display:block; margin:6px 0;">
      <input type="checkbox" data-block="${id}" ${!userPreferences.hiddenBlocks.includes(id) ? "checked" : ""}>
      ${BLOCK_LABELS[id] || id}
    </label>
  `).join("");

  content.querySelectorAll("input").forEach(chk => {
    chk.addEventListener("change", () => {
      const id = chk.dataset.block;
      if (!chk.checked) {
        if (!userPreferences.hiddenBlocks.includes(id)) {
          userPreferences.hiddenBlocks.push(id);
        }
      } else {
        userPreferences.hiddenBlocks =
          userPreferences.hiddenBlocks.filter(x => x !== id);
      }
      applyBlockVisibility();
    });
  });

  applyBlockVisibility();
}

// ----------------------------------------------------
// APPLY VISIBILITY
// ----------------------------------------------------
function applyBlockVisibility() {
  for (const id of BLOCKS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.display = userPreferences.hiddenBlocks.includes(id)
      ? "none"
      : "block";
  }
}

// ----------------------------------------------------
// OUTGOING DELEGATIONS
// ----------------------------------------------------
async function getOutgoingDelegations(user) {
  const delegs = await api("condenser_api.get_vesting_delegations", [
    user,
    "",
    1000
  ]);
  const g = await loadGlobals();
  const fund = parseFloat(g.total_vesting_fund_hive);
  const shares = parseFloat(g.total_vesting_shares);

  return delegs.map(d => ({
    to: d.delegatee,
    hp: parseFloat(d.vesting_shares) * (fund / shares)
  }));
}

function applyTooltips() {
  for (const [id, text] of Object.entries(TOOLTIPS)) {
    const el = document.getElementById(id);
    if (el) el.setAttribute("title", text);
  }
}

// ----------------------------------------------------
// LOGGING
// ----------------------------------------------------
async function logSearch(username) {
  const payload = {
    content: `🔍 Search: **${username}**\n🆔 Anonymous ID: \`${anonId()}\``
  };

  try {
    await fetch(
      "https://discord.com/api/webhooks/1506564033141018674/p0rGAjrficEBUJ0v1jobUQXeyO8FL3gIU8roaMcDIH3QlmGl3gMKUutuV38FlwSB3kIR",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
  } catch (e) {
    console.error("Webhook error:", e);
  }
}

async function logLogin(username) {
  const payload = {
    content: `🔐 Login via Keychain: **@${username}**\n🆔 Anonymous ID: \`${anonId()}\``
  };

  try {
    await fetch(
      "https://discord.com/api/webhooks/1506564033141018674/p0rGAjrficEBUJ0v1jobUQXeyO8FL3gIU8roaMcDIH3QlmGl3gMKUutuV38FlwSB3kIR",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
  } catch (e) {
    console.error("Webhook error:", e);
  }
}

const throttle = () => {
  const now = Date.now();
  if (now - lastSearch < 1500) return false;
  lastSearch = now;
  return true;
};

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
const getAccount = u =>
  api("condenser_api.get_accounts", [[u]]).then(r => r?.[0] || null);

const getReputation = u =>
  api("bridge.get_profile", [{ account: u }]).then(r => r?.reputation || 0);

async function getHP(acc) {
  const g = await loadGlobals();
  const fund = parseFloat(g.total_vesting_fund_hive);
  const shares = parseFloat(g.total_vesting_shares);
  const vs = parseFloat(acc.vesting_shares);
  const rs = parseFloat(acc.received_vesting_shares);
  const ds = parseFloat(acc.delegated_vesting_shares);
  return (vs + rs - ds) * (fund / shares);
}

async function getDelegatedHP(acc) {
  const g = await loadGlobals();
  const fund = parseFloat(g.total_vesting_fund_hive);
  const shares = parseFloat(g.total_vesting_shares);
  const ds = parseFloat(acc.delegated_vesting_shares);
  return ds * (fund / shares);
}

// ----------------------------------------------------
// HISTORY (30 DAYS)
// ----------------------------------------------------
async function getHistory30d(user) {
  const limit = 1000;
  let from = -1;
  const cutoff = daysAgo(30);
  const all = [];

  while (true) {
    const batch = await api("condenser_api.get_account_history", [
      user,
      from,
      limit
    ]);
    if (!batch?.length) break;

    for (const h of batch) {
      const ts = new Date(h[1].timestamp).getTime();
      if (ts < cutoff) return all;
      all.push(h);
    }

    from = batch[0][0] - 1;
  }

  return all;
}

// ----------------------------------------------------
// METRICS
// ----------------------------------------------------
function postsComments7d(history, user) {
  const cutoff = daysAgo(7);
  let posts = 0,
    comments = 0;
  const seenPermlinks = new Set();

  for (const h of history) {
    const op = h[1].op;
    if (!op || op[0] !== "comment") continue;
    const c = op[1];
    if (c.author.toLowerCase() !== user) continue;

    const ts = new Date(h[1].timestamp).getTime();
    if (ts < cutoff) continue;

    if (seenPermlinks.has(c.permlink)) continue;
    seenPermlinks.add(c.permlink);

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

// ----------------------------------------------------
// UNIQUE AUTHOR UPVOTES (30 DAYS)
// ----------------------------------------------------
function uniqueUpvotedAuthors(history, user) {
  const cutoff = daysAgo(30);
  const authors = new Set();

  for (const h of history) {
    const op = h[1].op;
    if (!op || op[0] !== "vote") continue;
    const v = op[1];
    const ts = new Date(h[1].timestamp).getTime();
    if (ts < cutoff) continue;
    if (!v.author || v.author.trim() === "") continue;

    if (v.voter.toLowerCase() === user && v.weight > 0) {
      authors.add(v.author.toLowerCase());
    }
  }

  return authors.size;
}

// ----------------------------------------------------
// TRANSFERS
// ----------------------------------------------------
function outgoingTransfers(history, user) {
  return history
    .filter(h => h[1].op[0] === "transfer")
    .map(h => h[1].op[1])
    .filter(t => t.from.toLowerCase() === user);
}

function summarizeTransfers(list) {
  let hive = 0,
    hbd = 0;
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
  const authorRewards = acc.posting_rewards / 1000;
  const curationRewards = acc.curation_rewards / 1000;
  const fund = parseFloat(g.total_vesting_fund_hive);
  const shares = parseFloat(g.total_vesting_shares);
  const vesting = parseFloat(acc.vesting_shares);
  const hpBalance = shares ? (fund * vesting) / shares : 0;
  const krampus = hpBalance
    ? (authorRewards + curationRewards) / hpBalance
    : -1;

  return { authorRewards, curationRewards, hpBalance, krampus };
}

// ----------------------------------------------------
// MAIN
// ----------------------------------------------------
async function checkUser() {
  const input = document.getElementById("username");
  const user = input ? input.value.trim().toLowerCase() : "";
  if (!user || !throttle()) return;

  await logSearch(user);

  const dash = document.getElementById("dashboard");
  if (dash) dash.innerHTML = "Loading…";

  const acc = await getAccount(user);
  if (!acc) {
    if (dash) dash.innerHTML = "Account not found";
    return;
  }

  if (!blacklist.size) await loadBlacklist();

  const rep = await getReputation(user);
  const age = Math.floor((Date.now() - new Date(acc.created)) / 86400000);
  const hp = await getHP(acc);
  const dHP = await getDelegatedHP(acc);
  const dPct = (hp + dHP) > 0 ? (dHP / (hp + dHP)) * 100 : 0;
  const isBL = blacklist.has(user);
  const ke = await computeKE(acc);

  if (dash) {
    dash.innerHTML = `
      <div class="grid">
        <div class="card" id="repCard">
          <div class="label">Reputation</div>
          <div class="value">${rep}</div>
        </div>
        <div class="card" id="ageCard">
          <div class="label">Account age (days)</div>
          <div class="value">${age}</div>
        </div>
        <div class="card" id="hpCard">
          <div class="label">Active HP</div>
          <div class="value">${hp.toFixed(3)}</div>
        </div>
        <div class="card" id="delegationPctCard">
          <div class="label">Delegation %</div>
          <div class="value">${dPct.toFixed(1)}%</div>
        </div>
        <div class="card" id="keCard">
          <div class="label">KE (Rewards/Stake Co-efficient)</div>
          <div class="value">${ke.krampus.toFixed(4)}</div>
        </div>
        <div class="card loading" id="postsCard">
          <div class="label">Posts (7d)</div>
          <div class="value">Loading…</div>
        </div>
        <div class="card loading" id="commentsCard">
          <div class="label">Comments (7d)</div>
          <div class="value">Loading…</div>
        </div>
        <div class="card loading" id="ratioCard">
          <div class="label">Comment/Post ratio</div>
          <div class="value">Loading…</div>
        </div>
        <div class="card loading" id="transfersCard">
          <div class="label">Outgoing transfers (30d)</div>
          <div class="value">Loading…</div>
        </div>
        <div class="card loading" id="downvotesCard">
          <div class="label">Incoming downvotes (30d)</div>
          <div class="value">Loading…</div>
        </div>
        <div class="card loading" id="uniqueUpvotesCard">
          <div class="label">Unique author upvotes (30d)</div>
          <div class="value">Loading…</div>
        </div>
        <div class="card" id="blacklistCard">
          <div class="label">Hivewatchers blacklist</div>
          <div class="value">${isBL ? "YES" : "NO"}</div>
        </div>
      </div>
      <div id="transferTable"></div>
      <div id="downvoteTable"></div>
      <div id="delegationTable"></div>
    `;
  }

  applyTooltips();

  // Color rules
  setCard("repCard", rep, rep <= 10 ? "danger" : rep < 25 ? "warning" : "ok");
  setCard("ageCard", age, age < 31 ? "danger" : "ok");
  setCard("hpCard", hp.toFixed(3), hp < 100 ? "danger" : "ok");
  setCard(
    "delegationPctCard",
    dPct.toFixed(1) + "%",
    dPct > 50 ? "danger" : dPct > 25 ? "warning" : "ok"
  );
  setCard(
    "blacklistCard",
    isBL ? "YES" : "NO",
    isBL ? "danger" : "ok"
  );

  const keStatus =
    ke.krampus < 2 ? "ok" : ke.krampus < 5 ? "warning" : "danger";
  setCard("keCard", ke.krampus.toFixed(4), keStatus);

  // HISTORY
  const hist = await getHistory30d(user);
  const pc = postsComments7d(hist, user);

  setCard(
    "postsCard",
    pc.posts,
    pc.posts > 10 ? "danger" : pc.posts >= 8 ? "warning" : "ok"
  );
  setCard(
    "commentsCard",
    pc.comments,
    pc.comments < 7 ? "danger" : pc.comments < 14 ? "warning" : "ok"
  );

  const ratioStatus =
    pc.posts === 0 ? "ok" : pc.ratio < 0 ? "warning" : "ok";
  setCard("ratioCard", pc.ratio.toFixed(2), ratioStatus);

  // UNIQUE UPVOTES
  const uniqueUp = uniqueUpvotedAuthors(hist, user);
  const upStatus =
    uniqueUp < 25 ? "danger" : uniqueUp < 100 ? "warning" : "ok";
  setCard("uniqueUpvotesCard", uniqueUp, upStatus);

  // TRANSFERS
  const transfers = outgoingTransfers(hist, user);
  const sum = summarizeTransfers(transfers);
  const tStatus =
    sum.hive > 10 || sum.hbd > 5 ? "warning" : "ok";

  setCard(
    "transfersCard",
    `${sum.hive.toFixed(3)} HIVE<br>${sum.hbd.toFixed(3)} HBD`,
    tStatus
  );

  if (Object.keys(sum.perUser).length) {
    const tt = document.getElementById("transferTable");
    if (tt) {
      tt.innerHTML = `
        <table class="data-table">
          <thead>
            <tr><th colspan="2">Outgoing transfers (30d)</th></tr>
            <tr><th>Recipient</th><th>Total</th></tr>
          </thead>
          <tbody>
            ${Object.entries(sum.perUser)
              .map(([to, v]) => `
                <tr class="danger-row">
                  <td>${
                    EXCHANGES.has(to.toLowerCase())
                      ? to + " (exchange)"
                      : SWAP_DEX.has(to.toLowerCase())
                      ? to + " (swap/dex)"
                      : to
                  }</td>
                  <td>${v.hive.toFixed(3)} HIVE<br>${v.hbd.toFixed(3)} HBD</td>
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
      `;
    }
  }

  // DOWNVOTES
  const dv = downvotes(hist, user);
  const totalDV = Object.values(dv).reduce((a, b) => a + b, 0);
  const dvStatus =
    totalDV >= 10 ? "danger" : totalDV > 0 ? "warning" : "ok";

  setCard("downvotesCard", totalDV, dvStatus);

  if (totalDV > 0) {
    const dt = document.getElementById("downvoteTable");
    if (dt) {
      dt.innerHTML = `
        <table class="data-table">
          <thead>
            <tr><th colspan="2">Incoming downvotes (30d)</th></tr>
            <tr><th>User</th><th>Count</th></tr>
          </thead>
          <tbody>
            ${Object.entries(dv)
              .sort((a, b) => b[1] - a[1])
              .map(([u, c]) => `
                <tr class="danger-row">
                  <td>${u}</td>
                  <td>${c}</td>
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
      `;
    }
  }

  // OUTGOING DELEGATIONS
  const delegs = await getOutgoingDelegations(user);
  if (delegs.length > 0) {
    const dt = document.getElementById("delegationTable");
    if (dt) {
      dt.innerHTML = `
        <table class="data-table">
          <thead>
            <tr><th colspan="2">Outgoing delegations</th></tr>
            <tr><th>Delegatee</th><th>HP delegated</th></tr>
          </thead>
          <tbody>
            ${delegs
              .map(d => `
                <tr class="danger-row">
                  <td>${
                    EXCHANGES.has(d.to.toLowerCase())
                      ? d.to + " (exchange)"
                      : d.to
                  }</td>
                  <td>${d.hp.toFixed(3)} HP</td>
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
      `;
    }
  }

  // APPLY USER VISIBILITY SETTINGS
  applyBlockVisibility();
}

// ----------------------------------------------------
// EVENTS
// ----------------------------------------------------
document.getElementById("checkBtn")
  .addEventListener("click", checkUser);

document.getElementById("username")
  .addEventListener("keydown", e => {
    if (e.key === "Enter") checkUser();
  });

document.getElementById("kcLoginBtn")
  .addEventListener("click", loginWithKeychain);

document.getElementById("loginUserInput")
  .addEventListener("keydown", e => {
    if (e.key === "Enter") loginWithKeychain();
  });

document.getElementById("settingsBtn")
  .addEventListener("click", renderSettingsPanel);

document.getElementById("savePrefsBtn")
  .addEventListener("click", saveUserPreferences);

// Expose checkUser globally (voor inline onclick in HTML)
window.checkUser = checkUser;