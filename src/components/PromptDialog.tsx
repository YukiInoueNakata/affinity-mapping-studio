import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
  onSubmit(value: string): void;
  onCancel(): void;
}

export function PromptDialog({
  open,
  title,
  label,
  initialValue = '',
  placeholder,
  okLabel = 'OK',
  cancelLabel = 'キャンセル',
  onSubmit,
  onCancel,
}: Props) {
  const [value, setValue] = useState<string>(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      const t = setTimeout(() => inputRef.current?.select(), 0);
      return () => clearTimeout(t);
    }
  }, [open, initialValue]);

  if (!open) return null;

  function submit() {
    onSubmit(value);
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <header className="modal-header">
          <h2>{title}</h2>
        </header>
        <div className="modal-body">
          {label && <label className="block-label">{label}</label>}
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
            autoFocus
          />
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="primary" onClick={submit}>
            {okLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
