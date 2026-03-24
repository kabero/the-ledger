import { useState, useRef } from "react";
import { trpc } from "../trpc";

export function EntryInput() {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const utils = trpc.useUtils();

  const addEntry = trpc.addEntry.useMutation({
    onSuccess: () => {
      setText("");
      utils.listEntries.invalidate();
      utils.getUnprocessed.invalidate();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    },
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) {
        addEntry.mutate({ raw_text: text.trim() });
      }
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = e.target.scrollHeight + "px";
  };

  return (
    <div className="box">
      <span className="box-title">なんでも投げろ</span>
      <textarea
        ref={textareaRef}
        className="input-box"
        placeholder="頭の中にあること..."
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        rows={1}
      />
    </div>
  );
}
