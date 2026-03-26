import Markdown from "react-markdown";
import { useClipboard } from "../hooks/useClipboard";
import { remarkPlugins, safeUrlTransform } from "../markdown";
import { ModalOverlay } from "./ModalOverlay";

interface ResultModalProps {
  title: string;
  result: string;
  onClose: () => void;
}

export function ResultModal({ title, result, onClose }: ResultModalProps) {
  const [copied, copy] = useClipboard();

  return (
    <ModalOverlay ariaLabel={title} onClose={onClose}>
      <div className="result-modal">
        <div className="result-modal-header">
          <button
            type="button"
            className={`result-modal-copy ${copied ? "copied" : ""}`}
            onClick={() => copy(result)}
          >
            {copied ? "\u2713 copied" : "copy"}
          </button>
          <button type="button" className="result-modal-close" onClick={onClose}>
            x
          </button>
        </div>
        <div className="result-modal-title">{title}</div>
        <div className="result-modal-body">
          <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
            {result.replace(/\\n/g, "\n")}
          </Markdown>
        </div>
      </div>
    </ModalOverlay>
  );
}
