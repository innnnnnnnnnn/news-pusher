# 📌 News Pusher — Git 版控操作指南

## 分支架構

```
main  ←── 正式版（GitHub Actions 自動推送用）
 └── dev  ←── 開發整合分支
      ├── feat/add-wsj     ← 新功能開發
      ├── fix/telegram-fmt ← Bug 修復
      └── chore/cleanup    ← 雜項維護
```

---

## 🔁 標準開發流程

### 1. 開始新功能 / 修 Bug

```bash
# 從最新的 main 建立功能分支
git checkout main
git pull origin main
git checkout -b feat/add-wsj    # 新功能
# 或
git checkout -b fix/telegram-fmt  # Bug 修復
```

### 2. 開發 → 提交

```bash
git status                        # 查看修改
git add .                         # 加入全部
git add scripts/github-push.mjs   # 或只加特定檔案
git commit -m "feat: add WSJ RSS feed support"
git push origin feat/add-wsj
```

### 3. 合併回 main（透過 Pull Request）

1. 前往 GitHub → Pull requests → New pull request
2. `base: main` ← `compare: feat/add-wsj`
3. 填寫 PR 描述（模板已設好），確認 checklist
4. 等 PR Validation 自動檢查通過 ✅ → Merge

---

## ⏪ 回溯舊版本

```bash
# 查看歷史
git log --oneline --graph -20

# 方式 A：暫時切到舊版查看
git checkout c13ca0a
git checkout main              # 切回來

# 方式 B：安全撤銷（保留歷史，建議）
git revert c13ca0a

# 方式 C：硬回溯（⚠️ 危險，刪除之後的 commit）
git reset --hard c13ca0a
git push origin main --force
```

---

## 🏷️ Commit 訊息格式

```
feat     新功能
fix      Bug 修復
chore    雜項維護
refactor 重構
docs     文件更新
revert   撤銷

範例：
feat: add Wall Street Journal RSS feed
fix: CDATA parsing fails on whitespace
chore: upgrade node to 24
```

---

## 🏷️ 版本標籤（Release）

```bash
git tag -a v1.1.0 -m "v1.1.0: 新增 WSJ 來源"
git push origin v1.1.0
```

---

## 🛠️ 常用指令

| 動作 | 指令 |
|------|------|
| 查看狀態 | `git status` |
| 查看歷史 | `git log --oneline -10` |
| 建立分支 | `git checkout -b feat/xxx` |
| 切換分支 | `git checkout main` |
| 拉取最新 | `git pull origin main` |
| 推送分支 | `git push origin feat/xxx` |
| 刪除本地分支 | `git branch -d feat/xxx` |
| 刪除遠端分支 | `git push origin --delete feat/xxx` |
| 暫存修改 | `git stash` |
| 取回暫存 | `git stash pop` |

---

## 📋 分支說明

| 分支 | 用途 |
|------|------|
| `main` | 正式版，GitHub Actions 在這觸發 |
| `dev` | 開發整合分支 |
