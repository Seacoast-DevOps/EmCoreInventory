import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { X, ChevronDown, Check } from "lucide-react";

export function ClearInput({ clearLabel, ...props }) {
  if (["checkbox", "radio", "hidden", "submit", "button"].includes(props.type))
    return <input {...props} />;
  const text = String(props.value ?? props.defaultValue ?? "");
  const caption =
    clearLabel ||
    props["aria-label"] ||
    props.placeholder ||
    props.name ||
    "field";
  return (
    <span
      className={"clearable " + (props.type === "date" ? "clearable-date" : "")}
    >
      <input {...props} aria-label={props["aria-label"] || clearLabel} />
      {text && !props.disabled && !props.readOnly && (
        <button
          type="button"
          className="clear-field"
          aria-label={"Clear " + caption}
          title="Clear"
          onClick={(event) => {
            event.preventDefault();
            props.onChange?.({
              target: { value: "", name: props.name, id: props.id },
            });
            event.currentTarget.parentElement
              .querySelector("input,textarea")
              ?.focus();
          }}
        >
          <X size={16} />
        </button>
      )}
    </span>
  );
}
export function ClearTextarea({ clearLabel, ...props }) {
  const caption =
    clearLabel ||
    props["aria-label"] ||
    props.placeholder ||
    props.name ||
    "field";
  return (
    <span className="clearable clearable-textarea">
      <textarea {...props} aria-label={props["aria-label"] || clearLabel} />
      {String(props.value ?? "") && !props.disabled && !props.readOnly && (
        <button
          type="button"
          className="clear-field"
          aria-label={"Clear " + caption}
          title="Clear"
          onClick={(event) => {
            event.preventDefault();
            props.onChange?.({
              target: { value: "", name: props.name, id: props.id },
            });
          }}
        >
          <X size={16} />
        </button>
      )}
    </span>
  );
}
function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return isValidElement(node)
    ? Children.toArray(node.props.children).map(textOf).join("")
    : "";
}
function choices(children) {
  return Children.toArray(children).flatMap((node) =>
    !isValidElement(node)
      ? []
      : node.type === "option"
        ? [
            {
              value: String(node.props.value ?? textOf(node)),
              label: textOf(node),
              disabled: node.props.disabled,
            },
          ]
        : choices(node.props.children),
  );
}

export function SearchSelect({
  children,
  value = "",
  onChange,
  required = false,
  disabled = false,
  id,
  name,
  className = "form-select",
  clearLabel,
  ...props
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [up, setUp] = useState(false);
  const ref = useRef(null),
    wrap = useRef(null),
    ignoreFocus = useRef(false),
    listId = useId();
  const options = choices(children),
    selected = options.find((option) => option.value === String(value)),
    placeholder =
      options.find((option) => option.value === "")?.label ||
      "Choose an option";
  const filtered = options.filter(
    (option) =>
      option.value !== "" &&
      query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .every((term) => option.label.toLowerCase().includes(term)),
  );
  useEffect(() => {
    ref.current?.setCustomValidity(
      required && (value === "" || value == null)
        ? "Select an option from the list."
        : "",
    );
  }, [required, value]);
  function show() {
    if (disabled || ignoreFocus.current) return;
    setOpen(true);
    setQuery("");
    setActive(0);
    const box = ref.current.getBoundingClientRect(),
      dialog = ref.current.closest("dialog")?.getBoundingClientRect();
    setUp(
      Math.min(innerHeight, dialog?.bottom ?? innerHeight) - box.bottom < 190 &&
        box.top - (dialog?.top ?? 0) > 190,
    );
  }
  function choose(option) {
    if (!option || option.disabled) return;
    ignoreFocus.current = true;
    ref.current?.focus({ preventScroll: true });
    ignoreFocus.current = false;
    onChange?.({ target: { value: option.value, name, id } });
    setOpen(false);
    setQuery("");
  }
  function key(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show();
      else
        setActive((current) =>
          Math.max(
            0,
            Math.min(
              filtered.length - 1,
              current + (event.key === "ArrowDown" ? 1 : -1),
            ),
          ),
        );
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      choose(filtered[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }
  return (
    <span
      className="search-select"
      ref={wrap}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <input
        {...props}
        ref={ref}
        id={id}
        name={name}
        aria-label={props["aria-label"] || clearLabel}
        type="text"
        role="combobox"
        autoComplete="off"
        className={className + " searchable-input"}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && filtered[active] ? listId + "-" + active : undefined
        }
        value={open ? query : value !== "" ? selected?.label || "" : ""}
        placeholder={placeholder}
        onFocus={show}
        onClick={() => {
          if (!open) show();
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={key}
        onInvalid={() => {
          ref.current?.focus();
          show();
        }}
      />
      {(open ? query : String(value)) && !disabled && (
        <button
          type="button"
          className="clear-field select-clear"
          aria-label={
            "Clear " + (clearLabel || props["aria-label"] || "selection")
          }
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange?.({ target: { value: "", name, id } });
            setQuery("");
            setOpen(true);
            ref.current?.focus();
          }}
        >
          <X size={16} />
        </button>
      )}
      <button
        type="button"
        className="select-arrow"
        aria-label={"Open " + (props["aria-label"] || "options")}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          if (open) setOpen(false);
          else show();
        }}
      >
        <ChevronDown size={17} />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className={"select-options " + (up ? "above" : "")}
        >
          <li className="select-hint">Type to filter</li>
          {filtered.map((option, index) => (
            <li
              key={option.value}
              id={listId + "-" + index}
              role="option"
              aria-selected={String(value) === option.value}
              aria-disabled={Boolean(option.disabled)}
              className={index === active ? "active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                choose(option);
              }}
            >
              <span>{option.label}</span>
              {String(value) === option.value && <Check size={16} />}
            </li>
          ))}
          {!filtered.length && <li className="select-hint">No matches</li>}
        </ul>
      )}
    </span>
  );
}
