import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, deleteDoc, query, where, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

const CATS = { mon: "週一晚上課", cc: "社大課程分享", nk: "週四寧光堂精華", other: "其他" };
const CAT_SHORT = { mon: "週一晚上課", cc: "社大課程分享", nk: "週四寧光堂精華", other: "其他" };
const REACTS = [{ k: "like", e: "👍", n: "讚" }, { k: "love", e: "❤️", n: "愛心" }, { k: "bow", e: "🙏", n: "頂禮" }];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const local = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { } },
};

const state = { sessions: [], stats: {}, user: null, admin: false, adminDoc: null, drive: null, filter: "all", loaded: false, myReact: local.get("gx.myReact", {}) };

// ---------- helpers ----------
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2400) }
const fmtDate = d => { const [y, m, dd] = d.split("-"); const w = "日一二三四五六"[new Date(d + "T00:00").getDay()]; return { y, m: +m, d: +dd, w } };
const st = id => state.stats[id] || { views: 0, like: 0, love: 0, bow: 0 };
const score = s => { const x = st(s.id); return x.views + (x.like + x.love + x.bow) * 2 };
const driveId = url => (url.match(/\/d\/([\w-]{20,})/) || url.match(/[?&]id=([\w-]{20,})/) || [])[1];
const imgSrc = url => { const id = driveId(url); return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1600` : url };
const ytList = url => (url.match(/[?&]list=([\w-]+)/) || [])[1];
const ytId = url => (url.match(/(?:youtu\.be\/|v=|\/embed\/|\/live\/|\/shorts\/)([\w-]{11})/) || [])[1];
// 檔案類型：依上傳時記下的 mime、檔名或網址判斷
function fileKind(o) {
  const t = `${o.mime || ""} ${o.url || ""} ${o.file || ""}`.toLowerCase();
  if (/docs\.google\.com\/presentation|presentation|powerpoint|\.pptx?\b/.test(t)) return { tag: "PPT", label: "簡報", cls: "k-ppt", thumb: true };
  if (/application\/pdf|\.pdf\b/.test(t)) return { tag: "PDF", label: "PDF 檔", cls: "k-pdf", thumb: true };
  if (/^image\/|\.(jpe?g|png|gif|webp|heic)\b/.test(t)) return { tag: "圖", label: "圖片", cls: "k-img", thumb: true };
  if (/docs\.google\.com\/document|wordprocessing|msword|\.docx?\b/.test(t)) return { tag: "DOC", label: "Word 文件", cls: "k-doc", thumb: true };
  if (/docs\.google\.com\/spreadsheets|spreadsheet|excel|\.xlsx?\b/.test(t)) return { tag: "XLS", label: "試算表", cls: "k-xls", thumb: true };
  if (/^audio\/|\.(mp3|m4a|wav)\b/.test(t)) return { tag: "♪", label: "錄音", cls: "k-av", thumb: false };
  if (/^video\/|\.(mp4|mov)\b/.test(t)) return { tag: "▶", label: "影片檔", cls: "k-av", thumb: true };
  if (/notebooklm/.test(t)) return { tag: "AI", label: "NotebookLM 筆記", cls: "k-ai", thumb: false };
  if (driveId(o.url || "")) return { tag: "檔", label: "Drive 檔案", cls: "k-doc", thumb: true };
  return { tag: "↗", label: "網頁連結", cls: "k-link", thumb: false };
}
const docThumb = o => { const id = driveId(o.url || ""); return id && fileKind(o).thumb ? `https://drive.google.com/thumbnail?id=${id}&sz=w400` : "" };
// 可以在 app 裡直接閱讀的網址（Google Drive 檔案、Google 文件／簡報／試算表）
function previewUrl(url) {
  const g = url.match(/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]+)/);
  if (g) return `https://docs.google.com/${g[1]}/d/${g[2]}/preview`;
  const id = driveId(url);
  return id && /drive\.google\.com/.test(url) ? `https://drive.google.com/file/d/${id}/preview` : "";
}
function openViewer(title, url, original) {
  closeViewer(true);
  const v = document.createElement("div");
  v.className = "viewer"; v.id = "viewer"; v.setAttribute("role", "dialog"); v.setAttribute("aria-label", title);
  v.innerHTML = `<div class="vbar"><button class="btn vclose" id="vclose">✕ 關閉</button><b class="vtitle">${esc(title)}</b></div>
    <div class="vbody"><div class="vloading">文件載入中，請稍候…</div><iframe src="${esc(url)}" title="${esc(title)}" allow="autoplay; fullscreen" allowfullscreen></iframe></div>
    <div class="vfoot"><a href="${esc(original)}" target="_blank" rel="noopener">看不到內容？點這裡用 Google Drive 開啟</a></div>`;
  document.body.appendChild(v); document.body.classList.add("noscroll");
  v.querySelector("iframe").onload = () => v.querySelector(".vloading")?.remove();
  $("#vclose").onclick = () => history.state?.viewer ? history.back() : closeViewer();
  history.pushState({ viewer: 1 }, "");
}
function closeViewer(silent) { const v = $("#viewer"); if (v) { v.remove(); document.body.classList.remove("noscroll") } }
window.addEventListener("popstate", () => closeViewer());
function docCard(o) {
  const k = fileKind(o), th = docThumb(o), pv = previewUrl(o.url || "");
  return `<a class="doc" href="${esc(o.url)}" target="_blank" rel="noopener" ${pv ? `data-pv="${esc(pv)}" data-title="${esc(o.name)}"` : ""}>
    <span class="dthumb ${k.cls}">${th ? `<img src="${esc(th)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}<span class="ic">${k.tag}</span></span>
    <span class="dtext"><span class="kind ${k.cls}">${k.label}</span><span class="dname">${esc(o.name)}</span></span></a>`;
}
// 手機上直接開 YouTube App；電腦上開 YouTube 網站
function ytAppLink(url, vid) {
  const ua = navigator.userAgent, list = ytList(url);
  const path = vid ? `watch?v=${vid}${list ? `&list=${list}` : ""}` : list ? `playlist?list=${list}` : "";
  if (path && /Android/i.test(ua)) return `intent://www.youtube.com/${path}#Intent;package=com.google.android.youtube;scheme=https;S.browser_fallback_url=${encodeURIComponent(url)};end`;
  if (path && /iPhone|iPad|iPod/i.test(ua)) return `youtube://www.youtube.com/${path}`;
  return url;
}
function ytEmbed(url) {
  const vid = ytId(url), list = ytList(url);
  if (vid) return `https://www.youtube.com/embed/${vid}?playsinline=1&rel=0${list ? `&list=${list}` : ""}`;
  if (list) return `https://www.youtube.com/embed/videoseries?list=${list}&playsinline=1&rel=0`;
  return "";
}
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// ---------- data ----------
async function load() {
  const q = state.admin ? collection(db, "sessions") : query(collection(db, "sessions"), where("confirmed", "==", true));
  const [ss, stats] = await Promise.all([getDocs(q), getDocs(collection(db, "stats"))]);
  state.sessions = ss.docs.map(d => ({ id: d.id, photos: [], docs: [], ...d.data() }));
  state.stats = Object.fromEntries(stats.docs.map(d => [d.id, d.data()]));
  state.loaded = true;
}
async function bump(id, changes) {
  const s = { ...st(id) }; for (const k in changes) s[k] = Math.max(0, (s[k] || 0) + changes[k]);
  state.stats[id] = s;
  const inc = {}; for (const k in changes) inc[k] = increment(changes[k]);
  try { await setDoc(doc(db, "stats", id), inc, { merge: true }) } catch (e) { console.warn(e) }
}

// ---------- auth ----------
// 管理者 = 輸入過管理密碼並綁定 Google 帳號的人（Firestore admins/{uid}）。每次進後台都要再輸入一次密碼。
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const provider = () => { const p = new GoogleAuthProvider(); p.addScope(DRIVE_SCOPE); p.setCustomParameters({ prompt: "select_account" }); return p };
const unlocked = () => { try { return sessionStorage.getItem("gx.unlocked") === "1" } catch { return false } };
const setUnlocked = v => { try { v ? sessionStorage.setItem("gx.unlocked", "1") : sessionStorage.removeItem("gx.unlocked") } catch { } };
async function readAdminDoc(user) {
  if (!user) return null;
  try { const d = await getDoc(doc(db, "admins", user.uid)); return d.exists() ? d.data() : null } catch { return null }
}
function keepToken(result) {
  const cred = GoogleAuthProvider.credentialFromResult(result);
  if (cred?.accessToken) state.drive = { token: cred.accessToken, at: Date.now() };
}
async function driveToken() {
  if (state.drive && Date.now() - state.drive.at < 50 * 60 * 1000) return state.drive.token;
  const r = await reauthenticateWithPopup(auth.currentUser, provider()); keepToken(r);
  if (!state.drive) throw new Error("沒有取得 Google Drive 權限");
  return state.drive.token;
}
onAuthStateChanged(auth, async user => {
  if (state.loggingIn) return;
  state.user = user; state.adminDoc = await readAdminDoc(user);
  state.admin = !!state.adminDoc && unlocked();
  try { await load() } catch (e) { console.error(e); $("#app").innerHTML = `<div class="empty">資料載入失敗，請重新整理頁面。</div>`; return }
  route();
});

// ---------- routing ----------
function route() {
  if (!state.loaded) return;
  const h = location.hash.slice(1);
  $("#adminBtn").textContent = state.admin ? "後台" : "管理者登入";
  if (h.startsWith("s-")) return renderDetail(h.slice(2));
  if (h === "admin") return state.admin ? renderAdmin() : renderLogin();
  if (h.startsWith("edit-") && state.admin) return renderEdit(h.slice(5));
  renderHome();
}
window.addEventListener("hashchange", () => { closeViewer(); route(); window.scrollTo(0, 0) });
$("#brand").onclick = () => { location.hash = "home" };
$("#brand").onkeydown = e => { if (e.key === "Enter") location.hash = "home" };
$("#adminBtn").onclick = () => { location.hash = "admin" };

// ---------- viewer ----------
function renderHome() {
  const byDate = (x, y) => y.date.localeCompare(x.date);
  const hot = state.sessions.filter(s => s.confirmed).sort((a, b) => score(b) - score(a)).slice(0, 3).filter(s => score(s) > 0);
  const group = k => state.sessions.filter(s => s.cat === k).sort(byDate);
  let listHtml;
  const g = state.filter === "all" ? [...state.sessions].sort(byDate) : group(state.filter);
  listHtml = `<div class="list">${g.map(card).join("") || `<div class="empty">這個主題還沒有內容</div>`}</div>`;
  $("#app").innerHTML = `
  <figure class="hero"><picture><source media="(min-width: 700px)" srcset="img/hero-wide.jpg"><img src="img/hero-tall.jpg" alt="共學講堂：佛學、養生、生活智慧" width="1215" height="1295"></picture></figure>
  <section id="topics"><h2 class="sec">選擇主題</h2><div class="tabs" role="group" aria-label="主題">${[["all", "全部"], ...Object.entries(CAT_SHORT)].map(([k, n]) => `<button class="tab" data-f="${k}" aria-pressed="${state.filter === k}">${n}</button>`).join("")}</div></section>
  <section><h2 class="sec">講座列表 <span>${state.filter === "all" ? "全部" : CAT_SHORT[state.filter]}・依日期排列，新的在前</span></h2>${listHtml}</section>
  ${hot.length ? `<section><h2 class="sec">熱門篇章 <span>依點閱與心情回饋排序</span></h2>
    <div class="hot">${hot.map((s, i) => `<button class="hotcard" data-id="${s.id}"><span class="rank">${i + 1}</span><span><b>${esc(s.title)}</b><small>${CAT_SHORT[s.cat]}・${st(s.id).views} 次點閱</small></span></button>`).join("")}</div>
  </section>` : ""}`;
  document.querySelectorAll("[data-id]").forEach(b => b.onclick = () => openSession(b.dataset.id));
  document.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { state.filter = b.dataset.f; renderHome(); $("#topics").scrollIntoView({ block: "start" }) });
}
function card(s) {
  const d = fmtDate(s.date), x = st(s.id);
  return `<button class="card" data-id="${s.id}"><div class="date"><div class="m">${d.m} 月</div><div class="d">${d.d}</div><div class="m">週${d.w}</div></div>
  <div class="body"><div class="meta"><span class="chip ${s.cat}">${CAT_SHORT[s.cat]}</span>${s.confirmed ? "" : `<span class="chip pending">待確認</span>`}</div>
  <div class="t">${esc(s.title)}</div>
  <div class="meta"><span class="has">${s.yt ? `<i class="h-yt">▶ 影片</i>` : ""}${s.photos.length ? `<i class="h-img">摘要圖 ${s.photos.length}</i>` : ""}${s.docs.length ? `<i class="h-doc">文檔 ${s.docs.length}</i>` : ""}</span><span>👁 ${x.views}</span><span>${REACTS.map(r => r.e + " " + (x[r.k] || 0)).join("　")}</span></div></div></button>`;
}
function openSession(id) {
  if (!state.admin) { const seen = local.get("gx.seen", {}); if (!seen[id]) { seen[id] = 1; local.set("gx.seen", seen); bump(id, { views: 1 }) } }
  location.hash = "s-" + id;
}
function renderDetail(id) {
  const s = state.sessions.find(x => x.id === id);
  if (!s) { $("#app").innerHTML = `<div class="empty">找不到這堂課，可能還沒公開。<br><br><button class="btn" onclick="location.hash='home'">回到列表</button></div>`; return }
  const d = fmtDate(s.date), x = st(id), mine = state.myReact[id], vid = s.yt && ytId(s.yt);
  $("#app").innerHTML = `
  <button class="btn ghost back" id="back">← 回到列表</button>
  <div class="dhead"><div class="meta"><span class="chip ${s.cat}">${CATS[s.cat]}</span><span>${d.y} 年 ${d.m} 月 ${d.d} 日（週${d.w}）</span><span>👁 ${x.views} 次點閱</span></div>
  <h1>${esc(s.title)}</h1></div>
  ${s.yt ? `<section><h2 class="sec">課程錄影</h2>${ytEmbed(s.yt) ? `<div class="yt"><iframe src="${esc(ytEmbed(s.yt))}" title="${esc(s.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div><p class="yt-hint">按上面影片中間的 ▶ 就能在這裡直接播放${!ytId(s.yt) && ytList(s.yt) ? "（這是播放清單，會從第一部開始）" : ""}</p>` : ""}<a class="video" id="ytApp" href="${esc(ytAppLink(s.yt, vid))}" ${/^(intent|youtube):/.test(ytAppLink(s.yt, vid)) ? "" : `target="_blank" rel="noopener"`}><span class="play"></span><span><b>用 YouTube App 觀看</b><small>畫面較大，可以調整字幕和速度</small></span></a></section>` : ""}
  ${s.photos.length ? `<section><h2 class="sec">摘要圖</h2><div class="photos">${s.photos.map(p => `<a href="${esc(p)}" target="_blank" rel="noopener"><img src="${esc(imgSrc(p))}" alt="${esc(s.title)} 摘要圖" loading="lazy" referrerpolicy="no-referrer"></a>`).join("")}</div></section>` : ""}
  ${s.summary ? `<section><h2 class="sec">摘要</h2><div class="summary"><div class="sumtext clamp" id="sum">${esc(s.summary)}</div></div><button class="btn more-btn" id="sumBtn" hidden>▼ 展開全部摘要</button></section>` : ""}
  ${s.docs.length ? `<section><h2 class="sec">文檔資料</h2><div class="docs">${s.docs.map(docCard).join("")}</div></section>` : ""}
  <section><h2 class="sec">聽完的心情 <span>點一下回饋給老師與同學</span></h2>
    <div class="react">${REACTS.map(r => `<button class="rbtn" data-r="${r.k}" aria-pressed="${mine === r.k}"><span class="e">${r.e}</span>${r.n}<small>${x[r.k] || 0}</small></button>`).join("")}</div></section>
  <section class="row"><button class="btn" id="share">分享這堂課</button>${state.admin ? `<button class="btn" id="edit">編輯這堂課</button>` : ""}</section>`;
  $("#back").onclick = () => { location.hash = "home" };
  const sum = $("#sum"), sumBtn = $("#sumBtn");
  if (sum && sum.scrollHeight > sum.clientHeight + 4) {
    sumBtn.hidden = false;
    const toggle = () => { const open = sum.classList.toggle("clamp"); sumBtn.textContent = open ? "▼ 展開全部摘要" : "▲ 收起摘要"; };
    sumBtn.onclick = toggle; sum.onclick = () => { if (sum.classList.contains("clamp")) toggle() };
  }
  document.querySelectorAll("a.doc[data-pv]").forEach(el => el.onclick = e => { e.preventDefault(); openViewer(el.dataset.title, el.dataset.pv, el.href) });
  document.querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
    const k = b.dataset.r, prev = state.myReact[id], ch = {};
    if (prev) ch[prev] = -1;
    if (prev === k) delete state.myReact[id]; else { ch[k] = (ch[k] || 0) + 1; state.myReact[id] = k }
    local.set("gx.myReact", state.myReact); bump(id, ch); renderDetail(id);
  });
  $("#share").onclick = async () => {
    const url = location.href.split("#")[0] + "#s-" + id;
    if (navigator.share) { try { await navigator.share({ title: s.title, url }); return } catch { } }
    try { await navigator.clipboard.writeText(url); toast("已複製連結，可以貼到 LINE") } catch { toast(url) }
  };
  if ($("#edit")) $("#edit").onclick = () => { location.hash = "edit-" + id };
}

// ---------- admin ----------
function renderLogin() {
  $("#app").innerHTML = `<form class="panel" id="lf"><h2 class="sec">管理者登入</h2>
  <div class="field"><label for="code">管理密碼</label><input type="password" id="code" inputmode="numeric" autocomplete="off"></div>
  <p class="who" id="lmsg">${state.adminDoc ? `已綁定的 Google 帳號：${esc(state.user.email)}` : "第一次登入時，輸入密碼後會請你選一個 Google 帳號綁定。之後你上傳的檔案，會存到這個帳號的 Google Drive。"}</p>
  <div class="row"><button class="btn primary" id="go" type="submit">進入後台</button><button class="btn ghost" id="cancel" type="button">回到首頁</button>${state.user ? `<button class="btn ghost" id="logout" type="button">換一個 Google 帳號</button>` : ""}</div></form>`;
  $("#lf").onsubmit = async e => {
    e.preventDefault();
    const code = $("#code").value.trim(); if (!code) return toast("請輸入管理密碼");
    $("#go").disabled = true; state.loggingIn = true;
    try {
      if (state.adminDoc) {
        if (state.adminDoc.code !== code) { toast("密碼不對"); return }
      } else {
        const r = state.user ? await reauthenticateWithPopup(state.user, provider()) : await signInWithPopup(auth, provider());
        keepToken(r);
        const u = r.user;
        let ad = await readAdminDoc(u);
        if (!ad) {
          ad = { code, email: u.email, name: u.displayName || u.email, createdAt: serverTimestamp() };
          try { await setDoc(doc(db, "admins", u.uid), ad) } catch { toast("密碼不對"); return }
        } else if (ad.code !== code) { toast("密碼不對"); return }
        state.user = u; state.adminDoc = ad;
      }
      setUnlocked(true); state.admin = true; await load(); location.hash = "admin"; route();
    } catch (err) { console.error(err); toast("Google 登入沒有完成，請再試一次") }
    finally { state.loggingIn = false; if ($("#go")) $("#go").disabled = false }
  };
  if ($("#logout")) $("#logout").onclick = async () => { setUnlocked(false); await signOut(auth) };
  $("#cancel").onclick = () => { location.hash = "home" };
  $("#code").focus();
}
function renderAdmin() {
  const all = [...state.sessions].sort((a, b) => b.date.localeCompare(a.date));
  const pending = all.filter(s => !s.confirmed).length;
  const views = all.reduce((a, s) => a + st(s.id).views, 0);
  $("#app").innerHTML = `
  <div class="row"><h2 class="sec" style="flex:1;margin:0">後台管理 <span>${esc(state.adminDoc?.name || state.user.email)}・檔案存到 ${esc(state.user.email)} 的 Drive</span></h2><button class="btn primary" id="new">＋ 新增一堂</button><button class="btn ghost" id="logout">離開後台</button></div>
  <div class="stats"><div class="stat"><b>${all.length}</b><small>堂課</small></div><div class="stat"><b>${pending}</b><small>標題待確認</small></div><div class="stat"><b>${views}</b><small>總點閱</small></div></div>
  <div class="panel atable">${all.map(s => `<div class="arow"><span class="dd">${s.date}</span><span class="tt"><span class="chip ${s.cat}">${CAT_SHORT[s.cat]}</span> ${esc(s.title)} ${s.confirmed ? "" : `<span class="chip pending">待確認</span>`}</span><button class="btn" data-e="${s.id}">編輯</button></div>`).join("") || `<div class="empty">還沒有課程，按「新增一堂」開始。</div>`}</div>`;
  $("#new").onclick = () => { location.hash = "edit-new" };
  $("#logout").onclick = () => { setUnlocked(false); state.admin = false; state.drive = null; location.hash = "home" };
  document.querySelectorAll("[data-e]").forEach(b => b.onclick = () => { location.hash = "edit-" + b.dataset.e });
}
async function ytTitle(url) {
  for (const u of [`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, `https://noembed.com/embed?url=${encodeURIComponent(url)}`]) {
    try { const r = await fetch(u); if (r.ok) { const j = await r.json(); if (j.title) return j.title } } catch { }
  }
  return null;
}
// ---------- Google Drive 上傳 ----------
async function gapi(url, opt = {}) {
  const token = await driveToken();
  const r = await fetch(url, { ...opt, headers: { Authorization: `Bearer ${token}`, ...(opt.headers || {}) } });
  if (r.status === 401) { state.drive = null; throw new Error("Google 授權過期，請再按一次上傳") }
  if (!r.ok) throw new Error(`Google Drive 回應 ${r.status}`);
  return r;
}
async function appFolder() {
  if (state.adminDoc?.folderId) return state.adminDoc.folderId;
  const r = await gapi("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "共學講堂 上傳檔案", mimeType: "application/vnd.google-apps.folder" }),
  });
  const { id } = await r.json();
  state.adminDoc.folderId = id;
  try { await setDoc(doc(db, "admins", auth.currentUser.uid), { folderId: id }, { merge: true }) } catch (e) { console.warn(e) }
  return id;
}
async function uploadToDrive(file, onProgress) {
  const folder = await appFolder();
  const meta = { name: file.name, parents: [folder] };
  const start = await gapi("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,webViewLink", {
    method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": file.type || "application/octet-stream" },
    body: JSON.stringify(meta),
  });
  const loc = start.headers.get("Location");
  const up = await fetch(loc, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (!up.ok) throw new Error(`上傳失敗（${up.status}）`);
  const f = await up.json();
  // 自動改成「知道連結的任何人都能查看」
  await gapi(`https://www.googleapis.com/drive/v3/files/${f.id}/permissions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  return { id: f.id, name: f.name, mime: f.mimeType || file.type, url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view` };
}
async function readPdfTitle(file) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const meta = await pdf.getMetadata().catch(() => ({})); let t = meta?.info?.Title;
    if (!t) { const pg = await pdf.getPage(1); const tc = await pg.getTextContent(); t = tc.items.map(i => i.str).join("").trim().slice(0, 40) }
    return t || file.name.replace(/\.pdf$/i, "");
  } catch { return file.name.replace(/\.pdf$/i, "") }
}

function renderEdit(id) {
  const isNew = id === "new";
  const src = isNew ? { id: doc(collection(db, "sessions")).id, date: today(), cat: "mon", title: "", titleSrc: "", confirmed: false, yt: "", photos: [], docs: [], summary: "" } : state.sessions.find(s => s.id === id);
  if (!src) { location.hash = "admin"; return }
  const f = JSON.parse(JSON.stringify(src));
  const SRC = { youtube: "來自 YouTube 標題，請確認", pdf: "來自 PDF 檔，請確認", manual: "手動輸入" };
  $("#app").innerHTML = `
  <button class="btn ghost back" id="back">← 回到後台</button>
  <div class="panel">
    <h2 class="sec">${isNew ? "新增一堂課" : "編輯課程"}</h2>
    <div class="grid2">
      <div class="field"><label for="f-date">日期</label><input type="date" id="f-date" value="${f.date}"></div>
      <div class="field"><label for="f-cat">主題</label><select id="f-cat">${Object.entries(CATS).map(([k, n]) => `<option value="${k}" ${f.cat === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label for="f-yt">YouTube 連結</label><div class="row"><input type="url" id="f-yt" value="${esc(f.yt)}" placeholder="https://youtu.be/…"><button class="btn" id="fetchYt">抓取標題</button></div></div>
    <div class="field"><label for="f-title">標題</label><input type="text" id="f-title" value="${esc(f.title)}" placeholder="可由系統抓取，再手動修改"><span class="src" id="srcHint">${f.titleSrc ? SRC[f.titleSrc] : ""}</span></div>
    <div class="field"><label for="up-img">摘要圖</label>
      <input type="file" id="up-img" accept="image/*" multiple>
      <span class="hint">選好圖片就會上傳到你的 Google Drive，並自動設成公開，大家都看得到。</span>
      <p class="sort-hint">按住左邊的 ⠿ 上下拖拉，就能調整順序</p><div class="thumbs" id="thumbs"></div>
      <details><summary class="hint">或貼上已經在 Drive 裡的圖片連結</summary><div class="row"><input type="url" id="p-url" placeholder="Drive 圖片連結"><button class="btn" type="button" id="addPhoto">加入</button></div></details></div>
    <div class="field"><label for="up-doc">文檔資料（PDF 或其他檔案）</label>
      <input type="file" id="up-doc" multiple>
      <span class="hint">上傳 PDF 時，如果還沒有標題，會自動讀出 PDF 的標題。</span>
      <p class="sort-hint">按住左邊的 ⠿ 上下拖拉，就能調整順序</p><div class="docs" id="docs"></div>
      <details><summary class="hint">或貼上連結（Google 文件、NotebookLM 等）</summary><div class="row"><input type="text" id="d-name" placeholder="名稱"><input type="url" id="d-url" placeholder="連結"><button class="btn" type="button" id="addDoc">加入</button></div></details></div>
    <p class="who" id="upMsg" hidden></p>
    <div class="field"><label for="f-sum">摘要文字（可留空）</label><textarea id="f-sum">${esc(f.summary)}</textarea></div>
    <label class="publish" for="f-ok"><input type="checkbox" id="f-ok" ${f.confirmed ? "checked" : ""}><span><b>公開給大家看</b><small>標題與內容都確認好了，再打勾。沒打勾的話，只有管理者看得到。</small></span></label>
    <div class="row"><button class="btn primary" id="saveBtn">儲存</button>${isNew ? "" : `<button class="btn danger" id="del">刪除這堂課</button>`}<span id="delConfirm"></span></div>
  </div>`;
  const setTitle = (t, k) => { if (!t) return; $("#f-title").value = t.trim(); f.titleSrc = k; $("#srcHint").textContent = SRC[k]; $("#f-ok").checked = false };
  $("#f-title").oninput = () => { f.titleSrc = "manual"; $("#srcHint").textContent = SRC.manual };
  // 按住左邊的 ⠿（或整列）拖拉排序，手機也可以
  const sortable = (sel, arr, redraw) => {
    const el = $(sel); if (!window.Sortable || !el) return;
    if (el._sortable) el._sortable.destroy();
    el._sortable = Sortable.create(el, { animation: 180, handle: ".handle", ghostClass: "drag-ghost", chosenClass: "drag-chosen", delay: 0,
      onEnd: e => { if (e.oldIndex === e.newIndex) return; const [it] = arr.splice(e.oldIndex, 1); arr.splice(e.newIndex, 0, it); redraw() } });
  };
  const drawThumbs = () => {
    $("#thumbs").innerHTML = f.photos.map((p, i) => `<div class="arrange"><span class="handle" aria-label="按住拖拉排序">⠿</span><img class="athumb" src="${esc(imgSrc(p))}" alt="摘要圖 ${i + 1}" referrerpolicy="no-referrer"><span class="aname">第 ${i + 1} 張</span>
      <span class="abtns"><button type="button" class="btn danger" data-rm="${i}">移除</button></span></div>`).join("");
    document.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { f.photos.splice(+b.dataset.rm, 1); drawThumbs() });
    sortable("#thumbs", f.photos, drawThumbs);
  };
  const drawDocs = () => {
    $("#docs").innerHTML = f.docs.map((o, i) => { const k = fileKind(o), th = docThumb(o); return `<div class="arrange"><span class="handle" aria-label="按住拖拉排序">⠿</span><span class="dthumb ${k.cls} small">${th ? `<img src="${esc(th)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}<span class="ic">${k.tag}</span></span>
      <span class="aname"><span class="kind ${k.cls}">${k.label}</span><input type="text" value="${esc(o.name)}" data-dn="${i}" aria-label="文檔名稱"></span>
      <span class="abtns"><button type="button" class="btn danger" data-rd="${i}">移除</button></span></div>` }).join("");
    document.querySelectorAll("[data-rd]").forEach(b => b.onclick = () => { f.docs.splice(+b.dataset.rd, 1); drawDocs() });
    sortable("#docs", f.docs, drawDocs);
    document.querySelectorAll("[data-dn]").forEach(inp => inp.oninput = () => { f.docs[+inp.dataset.dn].name = inp.value });
  };
  drawThumbs(); drawDocs();
  $("#back").onclick = () => { location.hash = "admin" };
  $("#fetchYt").onclick = async () => {
    const u = $("#f-yt").value.trim(); if (!u) return toast("先貼上 YouTube 連結");
    const t = await ytTitle(u); t ? setTitle(t, "youtube") : toast("抓不到標題，請確認連結或手動輸入");
  };
  $("#f-yt").onchange = async () => { const u = $("#f-yt").value.trim(); if (u && !$("#f-title").value.trim()) { const t = await ytTitle(u); if (t) setTitle(t, "youtube") } };
  const busy = (msg) => { const m = $("#upMsg"); m.hidden = !msg; m.textContent = msg || ""; $("#saveBtn").disabled = !!msg };
  $("#up-img").onchange = async e => {
    const files = [...e.target.files]; e.target.value = "";
    for (const [i, file] of files.entries()) {
      busy(`上傳圖片 ${i + 1}/${files.length}：${file.name}…`);
      try { const r = await uploadToDrive(file); f.photos.push(r.url); drawThumbs() } catch (err) { console.error(err); toast(err.message || "上傳失敗") }
    }
    busy("");
  };
  $("#up-doc").onchange = async e => {
    const files = [...e.target.files]; e.target.value = "";
    for (const [i, file] of files.entries()) {
      busy(`上傳文檔 ${i + 1}/${files.length}：${file.name}…`);
      let name = file.name.replace(/\.[^.]+$/, "");
      if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
        const t = await readPdfTitle(file); name = t;
        if (!$("#f-title").value.trim()) setTitle(t, "pdf");
      }
      try { const r = await uploadToDrive(file); f.docs.push({ name, url: r.url, mime: r.mime || file.type, file: file.name }); drawDocs() } catch (err) { console.error(err); toast(err.message || "上傳失敗") }
    }
    busy("");
  };
  $("#addPhoto").onclick = () => { const u = $("#p-url").value.trim(); if (!u) return toast("請貼上圖片連結"); f.photos.push(u); $("#p-url").value = ""; drawThumbs() };
  $("#addDoc").onclick = () => { const n = $("#d-name").value.trim(), u = $("#d-url").value.trim(); if (!u) return toast("請貼上文檔連結"); f.docs.push({ name: n || u, url: u }); $("#d-name").value = ""; $("#d-url").value = ""; drawDocs() };
  $("#saveBtn").onclick = async () => {
    f.date = $("#f-date").value; f.cat = $("#f-cat").value; f.yt = $("#f-yt").value.trim(); f.title = $("#f-title").value.trim(); f.summary = $("#f-sum").value; f.confirmed = $("#f-ok").checked;
    if (!f.date || !f.title) return toast("日期和標題要填");
    const { id: sid, ...data } = f;
    data.updatedBy = state.user.email; data.updatedAt = serverTimestamp(); if (isNew) data.createdBy = state.user.email;
    $("#saveBtn").disabled = true;
    // 舊資料補上檔案類型（需要已連上 Google Drive）
    if (f.docs.some(o => !o.mime && driveId(o.url || ""))) {
      try { await driveToken() } catch { }
      if (state.drive) for (const o of f.docs) {
        const id = driveId(o.url || ""); if (o.mime || !id) continue;
        try { const r = await gapi(`https://www.googleapis.com/drive/v3/files/${id}?fields=mimeType,name`); const j = await r.json(); o.mime = j.mimeType; o.file = j.name } catch { }
      }
      data.docs = f.docs;
    }
    try {
      await setDoc(doc(db, "sessions", sid), data, { merge: true });
      const i = state.sessions.findIndex(s => s.id === sid); const rec = { ...f };
      if (i >= 0) state.sessions[i] = rec; else state.sessions.push(rec);
      toast(f.confirmed ? "已儲存並公開" : "已儲存（尚未公開）"); location.hash = "admin";
    } catch (e) { console.error(e); toast("儲存失敗，請確認你是用管理者帳號登入"); $("#saveBtn").disabled = false }
  };
  if ($("#del")) $("#del").onclick = () => {
    $("#delConfirm").innerHTML = `確定刪除？<button class="btn danger" id="del2">刪除</button>`;
    $("#del2").onclick = async () => {
      try { await deleteDoc(doc(db, "sessions", f.id)); state.sessions = state.sessions.filter(s => s.id !== f.id); toast("已刪除"); location.hash = "admin" }
      catch { toast("刪除失敗") }
    };
  };
}
