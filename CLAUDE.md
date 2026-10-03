# context-mon

Claude Code mod that shows prompt-cache efficiency, token cost and cache expiry in real time. It is a plugin of **function hooks** (not shell-command hooks): `hooks/hooks.json` names one module, `hooks/register.mjs`, which exports `register(on, options)`.

## Layout

- `.claude-plugin/plugin.json`: manifest and `userConfig` options. `"types"` points at `types/index.d.ts`.
- `types/index.d.ts`: contract for every `$.state` value (`session`, `last`, `isHidden`, `cacheAt`, `cacheTtl`). Add a key here before using it in an atom.
- `hooks/pricing.mjs`: pure maths. Rates, `turnStats`, session totals, price-book parsing, `cacheFromTranscript`. No engine access.
- `hooks/fmt.mjs`: pure formatting. Lines are built as styled segments, then rendered as ANSI (`/context-mon` card); `register.mjs` maps the same segments onto `<Text>` for the band above the prompt. The status line is deliberately unused (it duplicated the band).
- `hooks/register.mjs`: hooks, atoms, the price-book refresh, the `/context-mon` command.

## Commands

```bash
claude plugin validate ~/plugins/context-mon     # run after every edit
claude --plugin-dir ~/plugins/context-mon         # load for one session
```

Headless smoke test (`-p` draws nothing; read the debug log for hook errors):

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude -p "Reply with just: ok" --plugin-dir ~/plugins/context-mon --debug-file /tmp/cm.log < /dev/null
```

Loading the plugin regenerates `tsconfig.json` and `.claude-plugin/types/` in this folder. They are editor aids; delete them rather than commit them.

## Rules the validator enforces

- `$` may only be passed to **top-level** function declarations (`refreshPrices`, `syncCache`, `cacheExpiry`), never to closures or nested functions. Hook bodies and timer callbacks may use `$` directly.
- `turn.step` streams: it must be `async function* ($, e, next)` using `yield* next(e)`.
- `$.state` keys must be string literals in source and declared in `types/index.d.ts`. Write them only from hooks or handlers, not while a `ui.render` hook draws.
- Module-level variables reset on every hot reload; `$.state` and `$.store` survive. Keep anything that must outlive a reload in an atom (this is why the model name is read from the `last` atom, not a variable).
- Session totals are updated inside the `update` callback so overlapping turns (subagent plus main loop) don't overwrite each other. Keep read-modify-write inside the updater.

## Domain facts that are easy to get wrong

- In the API's usage, `input_tokens` is only the **uncached** remainder. Total input is `uncached + cache_read + cache_creation`; hit rate is `cache_read / total input`.
- "Saved" is gross (no caching) minus actual cost, so it is negative on write-heavy turns. That is intended.
- The cache lifetime is not in the hook API's `ModelUsage`. It is read from the transcript tail (`cache_creation.ephemeral_5m` / `ephemeral_1h`) via `tail -c` from the path in `classic.UserPromptSubmit`, because transcripts exceed the 4 MiB `$.fs.read` limit. Subagent (`isSidechain`) rows are skipped. Until the transcript shows it, 5 minutes is assumed; `cacheTtlMinutes > 0` forces a value.
- The expiry clock is stamped at request start (`turn.step`), not when streaming ends. The transcript only seeds it when empty (reload, resume).
- Prices: the LiteLLM price book is refreshed at most daily, off the turn's path, and stored in `$.store`. An unknown model gets the built-in family rate and is flagged `isEstimated` (`~` before the turn cost). Do not add prefix matching: it prices new models with older generations' rates.
- Not modelled: tiered pricing above 200k context, the 1-hour cache-write rate (writes are billed at the 5-minute rate).

## Conventions

- Visual language: amber accent (`#D97706` / `\x1b[33m`), dim gray chrome (`\x1b[90m`), green savings (`\x1b[32m`), red for warnings. Light Unicode box drawing (`╭ ─ │ ╰ •`), no emoji.
- The countdown shows only minutes remaining (`59m`), never `59m/60m`.
- Keep `pricing.mjs` and `fmt.mjs` pure so they can be tested with plain `node -e`.
