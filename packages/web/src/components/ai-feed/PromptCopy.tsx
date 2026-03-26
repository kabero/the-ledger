import { useState } from "react";
import { useClipboard } from "../../hooks/useClipboard";

/**
 * Prompt templates for Agent teams development.
 * Each prompt is designed to kick off a multi-agent development session.
 */
const PROMPTS = [
  {
    label: "Orchestrator",
    description: "タスク管理・Worker振り分け・Inspector起動",
    prompt: `あなたは theledger (/Users/kabe/workspace/theledger) のOrchestratorです。

やること:
1. mcp__theledger__get_delegatable_tasks — 未処理のdelegatableタスクを確認
2. mcp__theledger__search_entries type=wish — wishを確認
3. 優先順位を決め、Workerエージェントにタスクを振り分ける
4. 進捗を監視し、Worker間の調整を行う
5. ファイル衝突や重複作業を防ぐ

自分ではコードを書かない。すべてWorkerに委譲する。

## Worker
worktree分離でWorkerエージェントを並列起動し、タスクを実装させる。
ファイル衝突を避けるため、担当範囲を明確に指定する:
- Worker-UI: packages/web/**（複数UIワーカーの場合はコンポーネント単位で分割）
- Worker-Core: packages/core/**, packages/api/**, packages/mcp/**
- 同じファイルを2つのWorkerに割り当てない

## Inspector
Inspectorエージェントを起動する:
- Playwrightで全画面を3ビューポート(1280/768/375)でスクショ
- スクショを分析し、見た目のバグ、レイアウト崩れ、コントラスト問題を発見
- 発見した課題を mcp__theledger__add_entry でdelegatableタスクとして登録
- 将来的に素晴らしい機能の提案もタスクとして登録
Playwright: const pw = require("/Users/kabe/workspace/theledger/node_modules/.pnpm/playwright@1.58.2/node_modules/playwright");

## 未処理エントリの自動処理
バックグラウンドで30秒ごとに mcp__theledger__get_unprocessed を呼び、
未処理エントリがあれば mcp__theledger__submit_processed で分類する。

## 永続稼働
止まるな。タスクがなくなったらInspectorを再起動して改善点をどんどん見つけろ。
見つけた課題をWorkerに振って処理させろ。
ずっと起動し続けろ。働き続けろ。アプリを進化させ続けろ。`,
  },
] as const;

export function PromptCopy() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [, copy] = useClipboard();

  const handleCopy = async (prompt: string, idx: number) => {
    await copy(prompt);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  return (
    <div className="ai-section">
      <div className="ai-section-title">
        <span className="ai-dot progress" /> 開発プロンプト
      </div>
      <div className="ai-prompt-cards">
        {PROMPTS.map((p, i) => (
          <button
            key={p.label}
            type="button"
            className={`ai-prompt-card ${copiedIdx === i ? "copied" : ""}`}
            onClick={() => handleCopy(p.prompt, i)}
          >
            <div className="ai-prompt-card-header">
              <span className="ai-prompt-card-label">{p.label}</span>
              <span className="ai-prompt-card-copy">
                {copiedIdx === i ? "\u2713 copied" : "copy"}
              </span>
            </div>
            <div className="ai-prompt-card-desc">{p.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
