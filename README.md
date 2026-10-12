# 聲音報表（網頁版／PWA）

由原本的 Swift 版（`SoundReport` 資料夾，未做任何修改）改寫而成的網頁 App。
加到 iPhone 主畫面後，用起來就像一般的 App，不會再有 7 天到期的問題，沒有網路也能使用。

## 檔案說明

| 檔案 | 用途 | 對應原版 |
|---|---|---|
| `index.html` | 網頁入口 | `SoundReportApp.swift` |
| `js/app.js` | 所有畫面與操作 | `ContentView.swift` |
| `js/logic.js` | 資料格式、場鏡繼承、搜尋、PDF 分頁與軌道顯示規則 | `Models.swift` |
| `js/pdf.js` | 產生 PDF（版面座標與原版相同，文字可選取、可搜尋） | `PDFManager.swift` |
| `js/ttf.js` | 讀取字型、只把用到的字嵌進 PDF | — |
| `fonts/` | PDF 用的黑體字型（思源黑體子集，開源授權） | — |
| `js/store.js` | 手機本機儲存與自動備份 | `DataStore` |
| `sw.js` | 離線快取 | — |
| `manifest.webmanifest`、`icons/` | App 名稱與圖示 | `Assets.xcassets` |
| `artifact.html` | 只給 Claude 測試網頁用，上架 GitHub 時不需要 | — |

## 上架到 GitHub Pages（免費）

1. 登入 GitHub，右上角「＋」→「New repository」，名稱例如 `sound-report`，選 **Public**，按「Create repository」。
2. 在新的 repository 頁面按「uploading an existing file」，把 `SoundReport-Web` 資料夾**裡面的所有檔案和資料夾**拖進去（不要連 `SoundReport-Web` 這層資料夾一起拖），按「Commit changes」。
3. 到「Settings」→ 左側「Pages」→「Branch」選 `main`、資料夾選 `/ (root)` →「Save」。
4. 等 1～2 分鐘，網址會是 `https://你的帳號.github.io/sound-report/`。

## 裝到 iPhone

1. 用 **Safari** 打開上面的網址（一定要用 Safari）。
2. 按下方「分享」按鈕 →「加入主畫面」→「加入」。
3. 從主畫面的圖示打開，打開一次之後就可以離線使用。

## 以後更新程式

1. 把修改過的檔案重新上傳到 GitHub。
2. 打開 `sw.js`，把 `const VERSION = 'soundreport-v1.3.1';` 的版本號加 1（例如 `v1.3.2`），一起上傳。
3. 手機在有網路時打開 App，下方會出現「有新版本可以使用」，按「更新」即可。資料不會遺失。

## 重要提醒

- 資料只存在手機的 Safari 儲存空間。**刪除主畫面上的 App，或在設定裡清除 Safari 網站資料，資料會一起消失。**
- 請養成收工時按「交接與備份」→「存一份備份」的習慣，存到「檔案」App 或傳到電腦。
- 備份檔／交接檔是 `.json` 格式，可以用「匯入交接檔／備份」還原。
