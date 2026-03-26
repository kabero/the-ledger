import { useState } from "react";
import { useClipboard } from "../../hooks/useClipboard";

/**
 * Prompt templates for Agent teams development.
 * Each prompt is designed to kick off a multi-agent development session.
 */
const PROMPTS = [
  {
    label: "Worker-UI",
    description: "UIコンポーネント開発用",
    prompt: `You are Worker-UI for theledger at /Users/kabe/workspace/theledger.

YOUR FILES ONLY: packages/web/src/components/**/*.tsx, packages/web/src/App.tsx, packages/web/src/*.ts (not styles)
DO NOT TOUCH: packages/core/**, packages/api/**, packages/mcp/**, styles.css, enhancements.css

1. mcp__theledger__get_delegatable_tasks — pick UI tasks
2. mcp__theledger__search_entries type=wish — implement wishes
3. Create improvements if nothing else

Screenshots: \`cd packages/web && npx tsx scripts/screenshot.ts --url http://localhost:5173 --output /tmp/ui.png --width 1280\`
\`pnpm biome check --write . && pnpm run build\`
mcp__theledger__complete_task + git commit

Target: as many as possible.`,
  },
  {
    label: "Worker-Core",
    description: "コアロジック・API開発用",
    prompt: `You are Worker-Core for theledger at /Users/kabe/workspace/theledger.

YOUR FILES ONLY: packages/core/**, packages/api/**
DO NOT TOUCH: packages/web/**, packages/mcp/**

1. mcp__theledger__get_delegatable_tasks — pick core/api tasks
2. mcp__theledger__search_entries type=wish — implement wishes
3. Create improvements if nothing else

\`pnpm biome check --write . && pnpm run build\`
mcp__theledger__complete_task + git commit

Target: as many as possible.`,
  },
  {
    label: "Orchestrator",
    description: "タスク振り分け・全体管理",
    prompt: `You are the Orchestrator for theledger at /Users/kabe/workspace/theledger.

Your job:
1. mcp__theledger__get_delegatable_tasks — review all pending tasks
2. mcp__theledger__search_entries type=wish — check wishes
3. Prioritize, break down, and assign tasks to Worker agents
4. Monitor progress and coordinate between workers
5. Ensure nothing conflicts or duplicates

Do NOT write code yourself. Delegate everything.`,
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
