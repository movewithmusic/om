# om・共學講堂

Master Fu's classroom

週一晚上課、週四社區大學課精華分享、週四寧光堂精華的錄影與筆記。

- 網站：放在 GitHub Pages，推送到 main 會自動上線（.github/workflows/pages.yml）
- 登入與資料：Firebase Authentication（Google 登入）＋ Cloud Firestore
- 摘要圖與文檔：管理者從後台上傳，存到管理者自己的 Google Drive「共學講堂 上傳檔案」資料夾，自動設成知道連結者可檢視
- 管理者：輸入管理密碼後綁定 Google 帳號（`admins/{uid}`），之後每次進後台都要再輸入密碼

## 設定
1. 把 Firebase 主控台拿到的 firebaseConfig 貼到 `config.js`。
2. 把 `firestore.rules` 裡的 ADMIN_CODE 換成管理密碼，貼到 Firestore 的「規則」分頁並發布。
4. Google Cloud 主控台為同一個專案啟用 Google Drive API（上傳檔案用）。
3. Firebase Authentication → 設定 → 授權網域，加入 `<帳號>.github.io`。

## 資料
- `sessions/{id}`：date, cat (mon|cc|nk), title, titleSrc, confirmed, yt, photos[], docs[{name,url}], summary
- `stats/{id}`：views, like, love, bow（任何人可 ±1）
