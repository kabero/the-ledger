# The Ledger — Design Document

## Vision

ADHD向け「第二の脳」ツール。考えたことを投げるだけ、整理は外注。

**コアコンセプト:** 入力のハードルを極限まで下げ、整理はLLMに委ね、出力は「今日はこの3つだけ」に絞る。

## Data Model

### Entry

エントリは**無型で投入**され、**LLMが後から型付け**する二段階モデル。

#### Raw Entry (投入時)

| Field       | Type     | Description          |
| ----------- | -------- | -------------------- |
| id          | string   | UUID                 |
| raw_text    | string   | ユーザーが投げた生テキスト |
| created_at  | datetime | 投入日時              |
| processed   | boolean  | LLMが処理済みか        |

#### Processed Entry (処理後に追加されるフィールド)

| Field      | Type              | Description                              |
| ---------- | ----------------- | ---------------------------------------- |
| type       | enum              | task / event / note / wish               |
| title      | string            | LLMが生成した短いタイトル                    |
| tags       | string[]          | LLMが自動付与したタグ                        |
| priority   | number (1-5)      | LLMが判定した優先度 (taskのみ)               |
| due_date   | datetime \| null  | ローカル抽出した期限 (task/eventのみ)          |
| status     | enum              | pending / done (taskのみ)                 |

### Type Enum

| Type  | Description                    | 固有の振る舞い                |
| ----- | ------------------------------ | -------------------------- |
| task  | やるべきこと                     | 完了/未完了、優先度、期限、スコアリング対象 |
| event | 日時が紐づくもの                  | 日時必須                     |
| note  | メモ・アイデア                   | 永続、蓄積される               |
| wish  | 買いたいもの・やりたいこと          | 緊急性なし                    |

### Tags & Graph View

- タグはLLMが自動付与（複数可）
- グラフビューはタグ共有でエントリ間の関連を導出（ストレージ上に明示的なエッジは持たない）
- 「育てる感覚」— 投げたものが増えて繋がっていく様子を可視化するフィードバック装置

## Processing Flow

```
投入 → [ローカル] 日時抽出 (chrono-node等)
     → [ローカル] 重複検出 (FTS5)
     → [LLM 1回] 型 + タグ + タイトル + 優先度 (バッチ, 上限10-20件)
     → 処理済みエントリ完成
```

- LLMはアプリ外。MCP経由で外部エージェントが処理
- LLM呼び出しはバッチ処理（未処理エントリをまとめて1回で処理）

## Scoring: "Today's 3"

「今日はこの3つだけ」をローカルスコアリングで算出。

- スコア = f(期限までの近さ, 優先度, 鮮度)
- 上位3件のみ表示
- ADHDには「選択肢を減らす」ことが最大の支援

## Architecture

```
[React] ←tRPC→ [Hono + tRPCルーター]
                       ↓
                 [Controller]  ←── [MCPサーバー]
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
| Database         | SQLite                      |
| MCP Server       | TypeScript                  |

## Monorepo Structure

```
theledger/
├── packages/
│   ├── core/         — Service, Repository, DB schema, type definitions
│   ├── api/          — Hono + tRPC router + Controller
│   ├── mcp/          — MCP server
│   └── web/          — React frontend
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## MCP Server Tools

| Tool               | Description                          |
| ------------------ | ------------------------------------ |
| get_unprocessed    | 未処理エントリをN件取得                 |
| submit_processed   | 処理結果（型、タグ、タイトル、優先度）を書き戻す |
| add_entry          | 新規エントリ投入（raw_textだけ）         |
| list_entries       | フィルタ・検索付き一覧取得               |
| update_entry       | エントリ更新                           |
| delete_entry       | エントリ削除                           |
| get_today_tasks    | 「今日の3つ」を取得                     |

## UI Design

**Undertale aesthetic:**
- ピクセルフォント (8bit風)
- 黒背景 + 白テキスト
- 対話ボックス風UI (RPGテキストウィンドウ的な枠線)
- キャラクターなし、サウンドなし

### Screen Components

1. **入力欄** — 常に画面上部。テキストを投げるだけ
2. **「今日の3つ」** — 最も目立つ位置。タスクのチェックボックス付き
3. **タイプ別タブ** — task / event / note / wish フィルタリング
4. **グラフビュー** — タグ共有ベースの関連可視化
5. **完了履歴** — 振り返り用。自己肯定感のフィードバック
6. **未処理バッジ** — LLMがまだ処理してない件数表示

## Future Considerations

- Tauri化（デスクトップアプリ、ホットキーで入力窓）
- cron/スケジューラでの自動LLM処理
- グラフビューのライブラリ選定
- スコアリングの計算式チューニング
- ピクセルフォント選定
