# context-mon

**English** · [繁體中文](#繁體中文)

## English

A Claude Code plugin that monitors prompt-cache efficiency, token consumption and API cost in real time, in Claude Code's own visual style.

Above the prompt it draws a context card and, after every turn, a cost line:

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ ◆ context          90k of 1M · compacts at 987k · cache 56m (ttl 1h)  [ 9% ] │
│ ██▌███████▌▌▌██████████████████████████████████████████████████████████▌████ │
│ ▾ hide legend                                                                │
│ ■ system prompt 4.2k 1%   ■ tools 17k 2%   ■ mcp tools 52k 5%   ■ free 897k   │
╰──────────────────────────────────────────────────────────────────────────────╯
 ╭─ [Cache: 94.2% • Saved: $0.080 • 59m] Turn: $0.012 │ Session: $0.14
```

**Context card**

| Part | Meaning |
|---|---|
| Header | Tokens in the context window, the window size, where auto-compaction runs, and the cache lifetime left with its TTL (`5m` or `1h`) |
| `[ 9% ]` | Share of the window in use; green, amber from 60%, red from 80% |
| Bar | The window by category at full band width; free space dark gray, the compaction reserve lighter, an amber tick at the compaction point |
| Legend | Each category's tokens and share. Collapse or expand it with the `▾ hide legend` / `▸ show legend` button, the `l` hotkey (once the band has focus), or `/context-mon legend` |

**Cost line**

| Part | Meaning |
|---|---|
| `Cache` | Share of this turn's input served from the prompt cache (cache reads ÷ total input) |
| `Saved` | What the cache saved versus paying full input price. Negative (red) on write-heavy turns |
| `59m` | Minutes left before the cache expires; red under a minute, `0m` once lapsed |
| `Turn` / `Session` | Net cost of this turn and the running session total. `~` means priced from a built-in estimate |

### Features

- **Exact cost model.** Prices uncached input, cache writes, cache reads and output separately, per turn and cumulatively.
- **Live price book.** Rates come from the [LiteLLM price book](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json), refreshed at most once a day. Built-in Sonnet, Opus and Haiku rates are the offline fallback.
- **Real cache expiry.** The countdown follows the lifetime the API actually granted (5 minutes or 1 hour), read from the session transcript.
- **Bloat alerts.** A toast when session cost passes each cost step ($1 by default), or after several consecutive turns with a poor cache hit rate.

### Install

This is a Claude Code plugin made of function hooks. Load it for one session:

```bash
claude --plugin-dir /path/to/context-mon
```

Or load it in every session by adding it to the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/plugins/context-mon"
  }
}
```

Start a new session afterwards. The badge appears after the first reply.

### Usage

| Command | Does |
|---|---|
| `/context-mon` | Session summary card: token breakdown (read / write / uncached / out), cache efficiency, expiry, gross cost, savings, net billed |
| `/context-mon reset` | Zero the session totals |
| `/context-mon hide` / `show` | Toggle the band above the prompt |
| `/context-mon legend` | Collapse or expand the context card's legend |
| `/context-mon refresh` | Re-fetch the price book now |

### Options

Set under `pluginConfigs` → `context-mon` → `options` in `~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "context-mon": { "options": { "costThreshold": 2, "missStreak": 3 } }
  }
}
```

| Option | Default | Meaning |
|---|---|---|
| `costThreshold` | `1` | Toast each time session cost crosses another multiple of this many USD |
| `missStreak` | `3` | Alert after this many consecutive main-loop turns with a poor hit rate |
| `missBelowPct` | `50` | A turn is a miss when its hit rate is under this percent |
| `minInputTokens` | `2000` | Turns with less total input than this are never counted as misses |
| `cacheTtlMinutes` | `0` | `0` follows the real lifetime from the transcript; a number forces a value |
| `showBand` | `true` | Draw the badge above the prompt |
| `priceUrl` | LiteLLM URL | Price book to fetch (LiteLLM JSON format) |

### How it works

`hooks/register.mjs` hooks `turn.step` and `turn.complete` to read each response's token usage, keeps session totals in plugin state, and draws the band with a `ui.render` hook. After each turn it reads the window's breakdown by category with `$.session.usage({ breakdown: 'summary' })` (local estimates, no API call); `hooks/contextBar.tsx` draws the context card from it. `hooks/pricing.mjs` holds the cost and cache maths and `hooks/fmt.mjs` the formatting, both free of engine calls so they can be tested with plain `node`.

In the API's usage, `input_tokens` counts only the uncached remainder, so total input is uncached + cache read + cache write.

### Limitations

- Tiered pricing above 200k context is not modelled.
- Cache writes are billed at the 5-minute rate, even when the 1-hour cache is in use.
- Fallback rates for models missing from the price book are estimates.

### Development

```bash
claude plugin validate .
```

See [CLAUDE.md](CLAUDE.md) for the rules the validator enforces and the pitfalls behind the design.

---

## 繁體中文

[English](#english) · **繁體中文**

一個 Claude Code 外掛，即時監控提示快取（prompt cache）效率、token 用量與 API 費用，介面沿用 Claude Code 原生的視覺風格。

輸入框上方會顯示一張上下文卡片，並在每一輪回應結束後顯示一行費用資訊：

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ ◆ context          90k of 1M · compacts at 987k · cache 56m (ttl 1h)  [ 9% ] │
│ ██▌███████▌▌▌██████████████████████████████████████████████████████████▌████ │
│ ▾ hide legend                                                                │
│ ■ system prompt 4.2k 1%   ■ tools 17k 2%   ■ mcp tools 52k 5%   ■ free 897k   │
╰──────────────────────────────────────────────────────────────────────────────╯
 ╭─ [Cache: 94.2% • Saved: $0.080 • 59m] Turn: $0.012 │ Session: $0.14
```

**上下文卡片**

| 部分 | 意義 |
|---|---|
| 標題列 | 上下文視窗中的 token 數、視窗大小、自動壓縮的觸發點，以及快取剩餘時間與其 TTL（`5m` 或 `1h`） |
| `[ 9% ]` | 視窗使用比例；綠色，60% 起轉為琥珀色，80% 起轉為紅色 |
| 長條 | 依類別顯示視窗用量，寬度填滿整列；可用空間為深灰、壓縮保留區為淺灰，琥珀色刻度標示壓縮觸發點 |
| 圖例 | 各類別的 token 數與比例。可透過 `▾ hide legend` / `▸ show legend` 按鈕、`l` 快捷鍵（狀態列取得焦點時）或 `/context-mon legend` 收合或展開 |

**費用資訊列**

| 欄位 | 意義 |
|---|---|
| `Cache` | 本輪輸入中由提示快取提供的比例（快取讀取 ÷ 總輸入） |
| `Saved` | 相較於全額支付輸入價格，快取為你省下的金額。寫入量大的回合會變成負數（紅色） |
| `59m` | 快取到期前剩餘的分鐘數；不到一分鐘時顯示紅色，過期後顯示 `0m` |
| `Turn` / `Session` | 本輪的淨費用與本次工作階段的累計費用。`~` 表示使用內建估算價格計算 |

### 功能

- **精確的費用模型。** 分別計算未快取輸入、快取寫入、快取讀取與輸出的費用，並提供單輪與累計數字。
- **即時價格表。** 費率取自 [LiteLLM 價格表](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json)，最多每天更新一次；離線時使用內建的 Sonnet、Opus、Haiku 費率作為備援。
- **真實的快取到期時間。** 倒數時間依 API 實際給予的有效期限（5 分鐘或 1 小時），從工作階段的對話紀錄（transcript）讀取。
- **上下文膨脹警示。** 當工作階段費用超過每一個費用級距（預設 $1），或連續多輪快取命中率偏低時，顯示提示通知。

### 安裝

這是由函式 hook 組成的 Claude Code 外掛。僅在單次工作階段載入：

```bash
claude --plugin-dir /path/to/context-mon
```

或在 `~/.claude/settings.json` 的 `env` 區塊加入下列設定，讓每個工作階段都自動載入：

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/plugins/context-mon"
  }
}
```

設定後請開啟新的工作階段，第一次回覆之後就會出現狀態列。

### 使用方式

| 指令 | 功能 |
|---|---|
| `/context-mon` | 工作階段摘要卡：token 明細（讀取／寫入／未快取／輸出）、快取效率、到期時間、總費用、節省金額、實際帳單 |
| `/context-mon reset` | 將本次工作階段的累計數字歸零 |
| `/context-mon hide` / `show` | 隱藏或顯示輸入框上方的狀態列 |
| `/context-mon legend` | 收合或展開上下文卡片的圖例 |
| `/context-mon refresh` | 立即重新下載價格表 |

### 設定選項

請在 `~/.claude/settings.json` 的 `pluginConfigs` → `context-mon` → `options` 中設定：

```json
{
  "pluginConfigs": {
    "context-mon": { "options": { "costThreshold": 2, "missStreak": 3 } }
  }
}
```

| 選項 | 預設值 | 說明 |
|---|---|---|
| `costThreshold` | `1` | 工作階段費用每超過此金額（美元）的整數倍，就顯示一次通知 |
| `missStreak` | `3` | 主對話連續出現這麼多輪命中率偏低時發出警示 |
| `missBelowPct` | `50` | 命中率低於此百分比的回合視為未命中 |
| `minInputTokens` | `2000` | 總輸入少於此數量的回合，不會被計為未命中 |
| `cacheTtlMinutes` | `0` | `0` 表示依對話紀錄中的真實有效期限；填入數字則強制使用該值 |
| `showBand` | `true` | 是否在輸入框上方顯示狀態列 |
| `priceUrl` | LiteLLM 網址 | 要下載的價格表（LiteLLM JSON 格式） |

### 運作原理

`hooks/register.mjs` 掛接 `turn.step` 與 `turn.complete` 以讀取每次回應的 token 用量，將累計數字存放在外掛狀態中，並透過 `ui.render` hook 繪製狀態列。每一輪結束後，它以 `$.session.usage({ breakdown: 'summary' })` 讀取視窗的類別明細（本機估算，不呼叫 API），再由 `hooks/contextBar.tsx` 繪製上下文卡片。`hooks/pricing.mjs` 負責費用與快取計算，`hooks/fmt.mjs` 負責格式化；兩者都不呼叫引擎介面，因此可以直接用 `node` 測試。

在 API 的用量資料中，`input_tokens` 只代表未快取的部分，所以總輸入 = 未快取 + 快取讀取 + 快取寫入。

### 限制

- 尚未支援超過 200k 上下文的分級計價。
- 快取寫入一律以 5 分鐘費率計算，即使實際使用的是 1 小時快取。
- 價格表中沒有的模型，其備援費率僅為估算值。

### 開發

```bash
claude plugin validate .
```

驗證器的規則與設計背後的注意事項，請見 [CLAUDE.md](CLAUDE.md)。
