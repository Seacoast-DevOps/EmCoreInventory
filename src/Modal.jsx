import { useEffect, useRef } from "react";

export default function Modal({ title, onClose, busy = false, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="transfer-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

export function SealQuestion({ boxes }) {
  return (
    <div className="seal-question">
      <p>Have you physically broken the seal on each container below?</p>
      <ul className="seal-confirm-list">
        {boxes.map((box) => (
          <li key={box.id}>
            <strong>
              {box.location} — {box.name}
            </strong>
            <br />
            Seal {box.seal}
          </li>
        ))}
      </ul>
      <p>
        Continue only after the seals are broken. The containers will be marked
        unsealed.
      </p>
    </div>
  );
}
