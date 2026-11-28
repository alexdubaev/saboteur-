import { useId, useRef, useState } from "react";
import type { Tool } from "../../../packages/game-core/src/types.js";
import { Dialog, Icon } from "./ui.js";
import "./target-picker.css";

type TargetOption = {
  id: string;
  label: string;
  color?: string;
  detail?: string;
  tool?: Tool;
};

type TargetPickerProps = {
  options: readonly TargetOption[];
  activeId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
};

function TargetName({ option, id }: { option: TargetOption; id?: string }) {
  return <span id={id} className="target-picker-name" style={{ color: option.color }}>
    {option.color && <span className="target-picker-dot" aria-hidden="true" />}
    <span>{option.label}</span>
  </span>;
}

export function TargetPicker({ options, activeId, disabled, onSelect }: TargetPickerProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const targetDescription = useId();
  const active = options.find((option) => option.id === activeId);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };

  return <>
    <button ref={trigger} type="button" className="target-picker-trigger" aria-label="Цель карты"
      aria-describedby={active ? targetDescription : undefined} title={active?.detail ?? active?.label}
      aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
      {active ? <TargetName id={targetDescription} option={active} /> : <span>Выбрать цель</span>}
      <span className="target-picker-chevron" aria-hidden="true" />
    </button>
    {open && <Dialog title="Выбрать цель" close={close}>
      <ul className="target-picker-options">
        {options.map((option) => <li key={option.id}>
          <button type="button" className="target-picker-option" aria-pressed={activeId === option.id}
            disabled={disabled} onClick={() => { onSelect(option.id); close(); }}>
            <span className="target-picker-option-copy">
              <TargetName option={option} />
              {option.detail && <small>{option.detail}</small>}
            </span>
            {option.tool && <Icon name={option.tool} />}
          </button>
        </li>)}
      </ul>
    </Dialog>}
  </>;
}
