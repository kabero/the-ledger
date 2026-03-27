import { useEffect, useState } from "react";

const FONTS = [
  { key: "DotGothic16", label: "DotGothic16", import: "DotGothic16" },
  { key: "Noto Sans JP", label: "Noto Sans JP", import: "Noto+Sans+JP:wght@400;700" },
  { key: "M PLUS 1 Code", label: "M PLUS 1 Code", import: "M+PLUS+1+Code" },
  { key: "Zen Maru Gothic", label: "Zen Maru Gothic", import: "Zen+Maru+Gothic" },
  { key: "Kiwi Maru", label: "Kiwi Maru", import: "Kiwi+Maru" },
  { key: "Kosugi Maru", label: "Kosugi Maru", import: "Kosugi+Maru" },
  { key: "monospace", label: "monospace (system)", import: null },
];

const STORAGE_KEY = "theledger-font";

function getStoredFont(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "DotGothic16";
}

export function applyFont(fontKey?: string): void {
  const key = fontKey ?? getStoredFont();
  const font = FONTS.find((f) => f.key === key);
  if (!font) return;

  if (font.import) {
    const id = `font-${font.key.replace(/\s+/g, "-")}`;
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${font.import}&display=swap`;
      document.head.appendChild(link);
    }
  }

  document.documentElement.style.setProperty("--font", `"${font.key}", monospace`);
}

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const [selected, setSelected] = useState(getStoredFont);

  useEffect(() => {
    // プレビュー用に全フォントをプリロード
    for (const font of FONTS) {
      if (font.import) {
        const id = `font-${font.key.replace(/\s+/g, "-")}`;
        if (!document.getElementById(id)) {
          const link = document.createElement("link");
          link.id = id;
          link.rel = "stylesheet";
          link.href = `https://fonts.googleapis.com/css2?family=${font.import}&display=swap`;
          document.head.appendChild(link);
        }
      }
    }
  }, []);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleSelect = (key: string) => {
    setSelected(key);
    localStorage.setItem(STORAGE_KEY, key);
    applyFont(key);
  };

  return (
    <div
      className="result-overlay"
      role="dialog"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation */}
      <div className="result-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="result-modal-close" onClick={onClose}>
          x
        </button>
        <div className="result-modal-title">フォント設定</div>
        <div className="settings-font-list">
          {FONTS.map((font) => (
            <button
              type="button"
              key={font.key}
              className={`settings-font-item ${selected === font.key ? "active" : ""}`}
              style={{ fontFamily: `"${font.key}", monospace` }}
              onClick={() => handleSelect(font.key)}
            >
              {font.label}
              <span className="settings-font-preview">あいうえお ABC 123</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
