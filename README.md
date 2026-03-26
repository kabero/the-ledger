# The Ledger

ADHD向け「第二の脳」。考えたことを投げるだけ、整理はLLMに外注。

## Quick Start

```bash
pnpm install
pnpm dev        # API + Web を起動
```

## Monorepo Structure

```
packages/
  core/   — DB, Repository, Service, types
  api/    — Hono + tRPC server
  mcp/    — MCP server (外部LLM向け)
  web/    — React frontend (PWA)
```

## MCP Tools (7)

外部LLM (Claude Desktop等) がこのアプリとやり取りするためのインターフェース。

| Tool | Description |
|------|-------------|
| `add_entry` | エントリ投入。raw_textのみ or type+title付きで分類済み投入 |
| `get_unprocessed` | 未処理エントリ取得 |
| `get_tag_vocabulary` | 既存タグ一覧＋言語傾向＋プリセット |
| `submit_processed` | 分類結果をバッチ送信 |
| `search_entries` | FTS検索、タグ・タイプ・期間フィルタ |
| `get_delegatable_tasks` | 委任可能なpendingタスク取得 |
| `complete_task` | タスク完了＋結果書き込み |

## Data Model

Entry は `source` フィールドで情報の出どころ (slack, email, auto-summary等) を記録。
`delegatable` なタスクはLLMが自律的に作業して `result` に結果を書き込む。

## Tech Stack

TypeScript, Hono, tRPC, React, Vite, SQLite (better-sqlite3), Biome, MCP SDK
