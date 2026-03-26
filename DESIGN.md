# The Ledger — Design Document

## Vision

ADHD向け「第二の脳」ツール。考えたことを投げるだけ、整理はLLMに外注。

**コアコンセプト:** 入力のハードルを極限まで下げ、整理はLLMに委ね、人間は結果を確認するだけ。

## Data Model

### Entry

エントリは**無型で投入**されるか、**分類済みで直接投入**される二つの経路を持つ。

#### Raw Entry (投入時)

| Field       | Type     | Description          |
| ----------- | -------- | -------------------- |
| id          | string   | UUID                 |
| raw_text    | string   | ユーザーが投げた生テキスト |
| created_at  | datetime | 投入日時              |
| processed   | boolean  | LLMが処理済みか        |

#### Processed Fields (処理後 or 分類済み投入時に追加)

| Field       | Type             | Description                           |
| ----------- | ---------------- | ------------------------------------- |
| type        | enum             | task / note / wish / trash            |
| title       | string           | 短いタイトル                            |
| tags        | string[]         | タグ（自動 or 手動）                     |
| urgent      | boolean          | 緊急フラグ                              |
| due_date    | date \| null     | 期限 (task用)                          |
| status      | enum \| null     | pending / done (taskのみ)              |
| delegatable | boolean          | LLMに委任可能か                         |
| source      | string \| null   | 情報の出どころ (slack, email, auto-summary等) |
| result      | string \| null   | タスク完了時の結果 (Markdown)             |
| result_seen | boolean          | ユーザーが結果を確認済みか                 |
| completed_at| datetime \| null | 完了日時                                |
| image_path  | string \| null   | 添付画像パス                             |

### Type Enum

| Type  | Description                    | 固有の振る舞い            |
| ----- | ------------------------------ | ---------------------- |
| task  | やるべきこと                     | 完了/未完了、期限         |
| note  | メモ・アイデア・サマリ             | 永続、蓄積される          |
| wish  | 買いたいもの・やりたいこと          | 緊急性なし              |
| trash | 不要なエントリ                    | 表示されない             |

> **予定(event)は持たない。** カレンダーアプリが既にある。予定はGoogle Calendar等に任せ、MCP連携する。

### Tags & Graph View

- タグはLLMが自動付与（複数可）、または分類済み投入時に指定
- `get_tag_vocabulary` で既存タグ一覧と言語傾向を取得し、一貫性を維持
- グラフビューはタグ共有でエントリ間の関連を導出（明示的なエッジは持たない）

## Processing Flow

### 経路1: 未分類投入 → LLM処理

```
投入 (raw_text のみ)
  → 未処理キューに入る (processed = false)
  → LLMが get_unprocessed で取得
  → LLMが get_tag_vocabulary でタグ語彙を取得
  → LLMが submit_processed (バッチ) で分類結果を書き戻す
  → 処理済みエントリ完成
```

### 経路2: 分類済み投入 (外部LLM連携)

```
外部LLMが add_entry に type + title + tags + source を付けて投入
  → processed = true で即登録（処理キューをスキップ）
  → ソース情報 (slack, email, calendar等) が記録される
```

## Architecture

```
[React] ←tRPC→ [Hono + tRPCルーター]
                       ↓
                 [Controller]  ←── [MCPサーバー] ←── [外部LLM (Claude Desktop等)]
                       ↓
                   [Service]
                       ↓
                  [Repository]
                       ↓
                   [SQLite]
```

### Layer Responsibilities

| Layer      | Responsibility                                     |
| ---------- | -------------------------------------------------- |
| Controller | リクエスト変換、バリデーション                          |
| Service    | ビジネスロジック（エントリ作成、ステータス変更、タグ操作等） |
| Repository | SQLiteへのCRUD                                      |

## Tech Stack

| Component        | Technology                  |
| ---------------- | --------------------------- |
| Monorepo         | pnpm workspaces + turborepo |
| Backend          | TypeScript + Hono + tRPC    |
| Backend Build    | tsup                        |
| Frontend         | React + Vite                |
| API Boundary     | tRPC                        |
| Database         | SQLite (better-sqlite3)     |
| Linter/Formatter | Biome                       |
| MCP Server       | TypeScript + @modelcontextprotocol/sdk |
| Graph            | react-force-graph-2d        |
| Charts           | Recharts                    |

## Monorepo Structure

```
theledger/
├── packages/
│   ├── core/         — Service, Repository, DB schema, type definitions
│   ├── api/          — Hono + tRPC router + REST endpoints
│   ├── mcp/          — MCP server (7 tools)
│   └── web/          — React frontend (PWA)
├── biome.json
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## MCP Server Tools

外部LLMとの最小限のインターフェース。3つの役割に分かれる。

### 投げ込む

| Tool        | Description                                                |
| ----------- | ---------------------------------------------------------- |
| add_entry   | エントリ投入。raw_textのみ or type+title付きで分類済み投入。source記録可 |

### 整理する

| Tool               | Description                                   |
| ------------------ | --------------------------------------------- |
| get_unprocessed    | 未処理エントリをN件取得（画像含む）                 |
| get_tag_vocabulary | 既存タグ一覧＋使用頻度＋言語傾向＋プリセット          |
| submit_processed   | 分類結果をバッチ送信 (type, title, tags, urgent等)  |

### 働く・調べる

| Tool                 | Description                            |
| -------------------- | -------------------------------------- |
| get_delegatable_tasks| LLMに委任可能なpendingタスクを取得         |
| complete_task        | タスク完了＋結果(Markdown)を書き込む        |
| search_entries       | FTS検索、タグ・タイプ・期間フィルタ           |

## UI Design

**Undertale aesthetic:**
- ピクセルフォント (DotGothic16)
- 黒背景 + 白テキスト + 黄色アクセント
- RPGテキストウィンドウ的な枠線

### Screen Components

1. **入力欄** — 常に画面上部。テキスト＋画像を投げるだけ
2. **タイプ別タブ** — タスク / おつかい(delegatable) / メモ / ほしい
3. **エントリリスト** — ステータス切り替え、結果モーダル、スワイプ操作
4. **AIダッシュボード** — パイプライン可視化、進行中/完了/外部入力のカード表示
5. **グラフビュー** — タグ共有ベースの関連可視化 (zoomToFit)
6. **統計ビュー** — ストリーク、週間完了、リードタイム分布、時間帯分布
7. **未処理バッジ** — LLMがまだ処理してない件数表示
8. **設定** — フォント選択、スケジュールタスク管理

## Future Considerations

- Tauri化（デスクトップアプリ、ホットキーで入力窓）
- エントリ間の明示的な関連付け (link_entries)
- タスク分解 (add_subtasks)
- 定期サマリ自動生成の強化
- source別の統計・可視化
