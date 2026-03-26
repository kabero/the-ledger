import { ModalOverlay } from "./ModalOverlay";

interface ConfirmModalProps {
  message: string;
  onOk: () => void;
  onCancel: () => void;
  okLabel?: string;
}

export function ConfirmModal({ message, onOk, onCancel, okLabel = "戻す" }: ConfirmModalProps) {
  return (
    <ModalOverlay onClose={onCancel}>
      <div className="confirm-modal">
        <div className="confirm-message">{message}</div>
        <div className="confirm-buttons">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onCancel}>
            やめる
          </button>
          <button type="button" className="confirm-btn confirm-btn-ok" onClick={onOk}>
            {okLabel}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
