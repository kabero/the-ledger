import { useCallback, useMemo, useRef, useState } from "react";
import { trpc } from "../trpc";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
// サイズ上限は @theledger/core の MAX_IMAGE_SIZE と同期すること
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function _getExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return map[mime] || "png";
}

interface EntryInputProps {
  onSubmitted?: () => void;
}

export function EntryInput({ onSubmitted }: EntryInputProps = {}) {
  const [text, setText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const addEntry = trpc.addEntry.useMutation({
    onSuccess: () => {
      reset();
      onSubmitted?.();
    },
  });

  const reset = useCallback(() => {
    setText("");
    setImageFile(null);
    setImagePreview(null);
    utils.listEntries.invalidate();
    utils.getUnprocessed.invalidate();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [utils]);

  const attachImage = useCallback((file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      alert("未対応の画像形式です。png, jpg, gif, webp のみ対応。");
      return;
    }
    if (file.size > MAX_SIZE) {
      alert("画像サイズが10MBを超えています。");
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const isBusy = uploading || addEntry.isPending;
  const isMac = useMemo(
    () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform),
    [],
  );
  const placeholder = isMac
    ? "頭の中にあること...  (Cmd+Shift+K)"
    : "頭の中にあること...  (Ctrl+Shift+K)";

  const handleSubmit = useCallback(async () => {
    if (isBusy) return;
    if (!text.trim() && !imageFile) return;

    if (imageFile) {
      // Use /upload endpoint for image uploads
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("raw_text", text.trim() || "");
        formData.append("image", imageFile);
        const res = await fetch("/upload", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "アップロード失敗");
        }
        reset();
        onSubmitted?.();
      } catch (err) {
        alert(err instanceof Error ? err.message : "アップロード失敗");
      } finally {
        setUploading(false);
      }
    } else {
      addEntry.mutate({ raw_text: text.trim() });
    }
  }, [text, imageFile, addEntry, reset, isBusy, onSubmitted]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) attachImage(file);
        return;
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith("image/")) {
      attachImage(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop zone for file drag-and-drop
    <div className="box" onDrop={handleDrop} onDragOver={handleDragOver}>
      <span className="box-title">なんでも投げろ</span>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <textarea
          ref={textareaRef}
          className="input-box"
          placeholder={placeholder}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
          disabled={isBusy}
          style={{ flex: 1, opacity: isBusy ? 0.5 : 1 }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) attachImage(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="btn-img"
          onClick={() => fileInputRef.current?.click()}
          title="画像を添付"
        >
          IMG
        </button>
      </div>
      {imagePreview && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <img
            src={imagePreview}
            alt="preview"
            style={{
              maxWidth: 120,
              maxHeight: 80,
              border: "2px solid var(--border)",
            }}
          />
          <button
            type="button"
            className="btn-del"
            onClick={() => {
              setImageFile(null);
              setImagePreview(null);
            }}
            style={{ fontSize: 14 }}
          >
            x
          </button>
        </div>
      )}
      {isBusy && (
        <div className="input-loading">
          <span className="spinner" />
          <span>{uploading ? "アップロード中..." : "送信中..."}</span>
        </div>
      )}
    </div>
  );
}
