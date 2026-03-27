# Ruby Taiwan Assistant

## Purpose

為 Ruby Taiwan 社群營運人員提供自動化資訊彙整與查詢工具，減少手動追蹤 GitHub 專案進度與 Discord 社群討論的負擔。

## Users

| 使用者 | 角色 | 目標 |
|--------|------|------|
| 社群營運人員 | Ruby Taiwan 核心團隊成員 | 掌握社群動態、追蹤專案進度、快速回應社群需求 |

## Impacts

| 行為變化 | 現狀 | 目標狀態 |
|----------|------|----------|
| 資訊彙整 | 營運人員需手動瀏覽 GitHub 和 Discord 才能掌握動態 | 系統每日自動彙整並推送摘要 |
| 資料查詢 | 需切換到 GitHub 介面搜尋 Issue 或 Project 狀態 | 在 Discord 中直接下指令查詢 |

## Success Criteria

- 營運人員每日收到一則涵蓋 GitHub 與 Discord 動態的 AI 摘要
- 營運人員可在 Discord 中查詢 Issue 狀態與專案進度並即時取得回覆

## Non-goals

- 不處理 Discord 的使用者權限管理
- 不提供 GitHub Issue 的建立或修改功能（唯讀存取）
- 不提供面向一般社群成員的功能（僅限營運人員使用）

## Features

### 1. 每日 AI 摘要

系統於每日台灣時間 00:00（UTC+8）收集 GitHub Issues、Project 活動以及營運團隊指定 Discord 頻道過去一天的討論內容，透過 AI 產生待辦清單格式的摘要，發送至該 Discord 頻道。

**User Journey:**

| Context | Action | Outcome |
|---------|--------|---------|
| 營運人員在每日開始工作時 | 系統已自動將摘要發送至 Discord 頻道 | 營運人員閱讀摘要即可掌握前一日動態 |

### 2. Discord 互動指令（尚未支援）

營運人員在 Discord 中透過 Slash Command 下達查詢指令，系統透過 GitHub App 取得資料後回覆。

> 此功能尚未支援，以下為預定的使用流程，具體行為待後續定義。

**User Journey:**

| Context | Action | Outcome |
|---------|--------|---------|
| 待定義 | 待定義 | 待定義 |

### 3. GitHub App 整合

系統作為 GitHub App 安裝於 Ruby Taiwan 組織，以唯讀權限存取 Project 與 Issues 資料，作為每日摘要與互動指令的資料來源。

**User Journey:**

| Context | Action | Outcome |
|---------|--------|---------|
| 系統需要存取 GitHub 資料 | 透過 GitHub App 認證後發送 API 請求 | 取得 Project 和 Issues 的最新資料 |

## System Boundary

| 類型 | 系統內 | 系統外 |
|------|--------|--------|
| 責任 | 資料收集、AI 摘要產生、查詢回覆 | Discord 伺服器管理、GitHub 專案管理 |
| 互動 | 接收 Discord Interaction Webhook；呼叫 GitHub API 與 AI 服務；讀取營運團隊指定頻道歷史訊息 | Discord 使用者認證；GitHub 權限設定；Discord 頻道配置 |
| 控制 | 摘要排程與內容格式 | Discord 頻道配置；GitHub Project 結構 |

## Behaviors

### 每日 AI 摘要

| 狀態 | 操作 | 結果 |
|------|------|------|
| 台灣時間 00:00（UTC+8）到達 | 觸發摘要產生流程 | 系統開始收集資料 |
| GitHub 資料收集成功 | 取得前一日 Issues 與 Project 活動 | 資料暫存供 AI 處理 |
| Discord 歷史訊息收集成功 | 取得營運團隊指定頻道過去 24 小時的討論內容 | 資料暫存供 AI 處理 |
| 所有資料收集完成 | AI 產生待辦清單格式摘要 | 摘要為條目式清單，每項標註狀態（如：`- [待辦] 蒼時需要更新官網`） |
| 摘要產生完成 | 發送至營運團隊指定 Discord 頻道 | 營運人員可在頻道中閱讀摘要 |

### Discord 互動指令（尚未支援）

| 狀態 | 操作 | 結果 |
|------|------|------|
| 收到 Discord Interaction Webhook | 驗證請求簽章 | 驗證通過則處理指令；驗證失敗則拒絕請求 |

> 具體指令行為待後續定義。

### GitHub App 整合

| 狀態 | 操作 | 結果 |
|------|------|------|
| 需要存取 GitHub 資料 | 使用 App 憑證取得 Installation Access Token | 取得有時效性的存取權杖 |
| Access Token 有效 | 發送 GitHub API 請求 | 取得所需資料 |
| Access Token 過期 | 重新取得 Installation Access Token | 更新權杖後重試請求 |

## Error Scenarios

| 場景 | 系統行為 |
|------|----------|
| GitHub API 請求失敗（網路錯誤、速率限制） | 套用「自動退避重試」；永久性失敗記錄至日誌 |
| Discord API 請求失敗（發送摘要失敗） | 套用「自動退避重試」；永久性失敗記錄至日誌 |
| AI 服務無法產生摘要 | 套用「自動退避重試」；重試皆失敗後，發送原始資料摘要（不含 AI 分析）至 Discord 頻道，並附上錯誤提示 |
| Discord 歷史訊息收集失敗 | 套用「自動退避重試」；重試皆失敗後，僅使用 GitHub 資料產生摘要，並註明 Discord 資料缺失 |
| GitHub App 認證失敗 | 套用「自動退避重試」；重試皆失敗後，記錄錯誤至日誌，不發送摘要 |
| 互動指令逾時（Cloudflare Workers 限制） | 回覆逾時提示訊息，建議稍後重試 |

## Patterns

### 自動退避重試

外部服務呼叫（GitHub API、Discord API、AI 服務）發生暫時性失敗時，系統以指數退避方式自動重試，最多 3 次。3 次重試皆失敗後，視為永久性失敗，依各 Error Scenario 定義的降級行為處理。

## Terminology

| 用語 | 定義 |
|------|------|
| 摘要 | 系統透過 AI 彙整後產生的結構化資訊報告 |
| 營運人員 | Ruby Taiwan 核心團隊中負責社群營運的成員 |
| 指令 | 營運人員在 Discord 中透過 Slash Command 發出的查詢請求 |
| 待辦清單 | 摘要的呈現格式，每項以 `- [狀態] 描述` 表示，狀態包含「待辦」「進行中」「完成」等 |
| 排程 | 系統定時觸發摘要產生流程的機制（Cloudflare Workers Cron Trigger） |

## Contracts

| 互動點 | 契約 |
|--------|------|
| Discord Interaction Webhook | 系統接收 HTTP POST 請求，驗證 Ed25519 簽章後處理指令，回傳 JSON 回應 |
| GitHub API | 系統以 GitHub App Installation Token 進行唯讀 REST/GraphQL API 呼叫 |
| Discord Bot API | 系統透過 Bot Token 發送訊息至指定頻道、讀取頻道歷史訊息 |
| AI Service | 系統將收集的文字資料送至 AI 服務，接收結構化摘要文字 |
| Cron Trigger | Cloudflare Workers 依設定排程觸發 `scheduled` 事件 |
