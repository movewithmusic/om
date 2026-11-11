import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, deleteDoc, query, where, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

const CATS = { mon: "週一晚上課", cc: "週四社區大學課精華分享", nk: "週四寧光堂精華" };
const CAT_SHORT = { mon: "週一晚上課", cc: "週四社大精華", nk: "週四寧光堂精華" };
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
const ytId = url => (url.match(/(?:youtu\.be\/|v=|\/embed\/|\/live\/|\/shorts\/)([\w-]{11})/) || [])[1];
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
window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0) });
$("#brand").onclick = () => { location.hash = "home" };
$("#brand").onkeydown = e => { if (e.key === "Enter") location.hash = "home" };
$("#adminBtn").onclick = () => { location.hash = "admin" };

// ---------- viewer ----------
function renderHome() {
  const list = state.sessions.filter(s => state.filter === "all" || s.cat === state.filter).sort((a, b) => b.date.localeCompare(a.date));
  const hot = state.sessions.filter(s => s.confirmed).sort((a, b) => score(b) - score(a)).slice(0, 3).filter(s => score(s) > 0);
  $("#app").innerHTML = `
  ${hot.length ? `<section><h2 class="sec">熱門篇章 <span>依點閱與心情回饋排序</span></h2>
    <div class="hot">${hot.map((s, i) => `<button class="hotcard" data-id="${s.id}"><span class="rank">${i + 1}</span><span><b>${esc(s.title)}</b><small>${CAT_SHORT[s.cat]}・${st(s.id).views} 次點閱</small></span></button>`).join("")}</div>
  </section>` : ""}
  <section><div class="tabs" role="group" aria-label="主題">${[["all", "全部"], ...Object.entries(CAT_SHORT)].map(([k, n]) => `<button class="tab" data-f="${k}" aria-pressed="${state.filter === k}">${n}</button>`).join("")}</div></section>
  <section><h2 class="sec">講座列表 <span>${list.length} 堂</span></h2>
    <div class="list">${list.map(card).join("") || `<div class="empty">這個主題還沒有內容</div>`}</div>
  </section>`;
  document.querySelectorAll("[data-id]").forEach(b => b.onclick = () => openSession(b.dataset.id));
  document.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { state.filter = b.dataset.f; renderHome() });
}
function card(s) {
  const d = fmtDate(s.date), x = st(s.id);
  return `<button class="card" data-id="${s.id}"><div class="date"><div class="m">${d.m} 月</div><div class="d">${d.d}</div><div class="m">週${d.w}</div></div>
  <div class="body"><div class="meta"><span class="chip ${s.cat}">${CAT_SHORT[s.cat]}</span>${s.confirmed ? "" : `<span class="chip pending">待確認</span>`}</div>
  <div class="t">${esc(s.title)}</div>
  <div class="meta"><span class="has">${s.yt ? "<i>影片</i>" : ""}${s.photos.length ? `<i>摘要圖 ${s.photos.length}</i>` : ""}${s.docs.length ? `<i>文檔 ${s.docs.length}</i>` : ""}</span><span>👁 ${x.views}</span><span>${REACTS.map(r => r.e + " " + (x[r.k] || 0)).join("　")}</span></div></div></button>`;
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
  ${s.yt ? `<section><h2 class="sec">課程錄影</h2>${vid ? `<div class="yt"><iframe src="https://www.youtube-nocookie.com/embed/${vid}" title="${esc(s.title)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>` : `<a class="video" href="${esc(s.yt)}" target="_blank" rel="noopener"><span class="play"></span><span><b>到 YouTube 觀看完整錄影</b><small>${esc(s.yt)}</small></span></a>`}</section>` : ""}
  ${s.photos.length ? `<section><h2 class="sec">摘要圖</h2><div class="photos">${s.photos.map(p => `<a href="${esc(p)}" target="_blank" rel="noopener"><img src="${esc(imgSrc(p))}" alt="${esc(s.title)} 摘要圖" loading="lazy" referrerpolicy="no-referrer"></a>`).join("")}</div></section>` : ""}
  ${s.summary ? `<section><h2 class="sec">摘要</h2><div class="summary">${esc(s.summary)}</div></section>` : ""}
  ${s.docs.length ? `<section><h2 class="sec">文檔資料</h2><div class="docs">${s.docs.map(o => `<a class="doc" href="${esc(o.url)}" target="_blank" rel="noopener"><span class="ic">${/pdf/i.test(o.url + o.name) ? "PDF" : "DOC"}</span><span>${esc(o.name)}</span></a>`).join("")}</div></section>` : ""}
  <section><h2 class="sec">聽完的心情 <span>點一下回饋給老師與同學</span></h2>
    <div class="react">${REACTS.map(r => `<button class="rbtn" data-r="${r.k}" aria-pressed="${mine === r.k}"><span class="e">${r.e}</span>${r.n}<small>${x[r.k] || 0}</small></button>`).join("")}</div></section>
  <section class="row"><button class="btn" id="share">分享這堂課</button>${state.admin ? `<button class="btn" id="edit">編輯這堂課</button>` : ""}</section>`;
  $("#back").onclick = () => { location.hash = "home" };
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
  const start = await gapi("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink", {
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
  return { id: f.id, name: f.name, url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view` };
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
      <div class="thumbs" id="thumbs"></div>
      <details><summary class="hint">或貼上已經在 Drive 裡的圖片連結</summary><div class="row"><input type="url" id="p-url" placeholder="Drive 圖片連結"><button class="btn" type="button" id="addPhoto">加入</button></div></details></div>
    <div class="field"><label for="up-doc">文檔資料（PDF 或其他檔案）</label>
      <input type="file" id="up-doc" multiple>
      <span class="hint">上傳 PDF 時，如果還沒有標題，會自動讀出 PDF 的標題。</span>
      <div class="docs" id="docs"></div>
      <details><summary class="hint">或貼上連結（Google 文件、NotebookLM 等）</summary><div class="row"><input type="text" id="d-name" placeholder="名稱"><input type="url" id="d-url" placeholder="連結"><button class="btn" type="button" id="addDoc">加入</button></div></details></div>
    <p class="who" id="upMsg" hidden></p>
    <div class="field"><label for="f-sum">摘要文字（可留空）</label><textarea id="f-sum">${esc(f.summary)}</textarea></div>
    <label class="row" style="font-size:14px"><input type="checkbox" id="f-ok" ${f.confirmed ? "checked" : ""}> 標題與內容已確認，公開給大家看</label>
    <div class="row"><button class="btn primary" id="saveBtn">儲存</button>${isNew ? "" : `<button class="btn danger" id="del">刪除這堂課</button>`}<span id="delConfirm"></span></div>
  </div>`;
  const setTitle = (t, k) => { if (!t) return; $("#f-title").value = t.trim(); f.titleSrc = k; $("#srcHint").textContent = SRC[k]; $("#f-ok").checked = false };
  $("#f-title").oninput = () => { f.titleSrc = "manual"; $("#srcHint").textContent = SRC.manual };
  const drawThumbs = () => { $("#thumbs").innerHTML = f.photos.map((p, i) => `<figure><img src="${esc(imgSrc(p))}" alt="摘要圖 ${i + 1}" referrerpolicy="no-referrer"><button data-rm="${i}" aria-label="移除">✕</button></figure>`).join(""); document.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { f.photos.splice(+b.dataset.rm, 1); drawThumbs() }) };
  const drawDocs = () => { $("#docs").innerHTML = f.docs.map((o, i) => `<div class="doc"><span class="ic">DOC</span><span style="flex:1">${esc(o.name)}<br><small style="color:var(--muted)">${esc(o.url)}</small></span><button class="btn ghost" data-rd="${i}">移除</button></div>`).join(""); document.querySelectorAll("[data-rd]").forEach(b => b.onclick = () => { f.docs.splice(+b.dataset.rd, 1); drawDocs() }) };
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
      try { const r = await uploadToDrive(file); f.docs.push({ name, url: r.url }); drawDocs() } catch (err) { console.error(err); toast(err.message || "上傳失敗") }
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
