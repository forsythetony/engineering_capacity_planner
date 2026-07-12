import { useEffect, useRef, useState } from 'react';

export interface TypeaheadOption {
  /** Stable identity used as the React key and selection value. */
  id: string;
  /** Primary text shown in the row. */
  label: string;
  /** Optional dimmed secondary text (e.g. a key or email). */
  hint?: string;
}

interface TypeaheadProps<T extends TypeaheadOption> {
  /** Current text in the input. */
  value: string;
  onChange: (text: string) => void;
  /**
   * Run a search for `query` and return matching options. Called (debounced) as
   * the user types; may reject/throw, surfaced as an inline error.
   */
  search: (query: string) => Promise<T[]>;
  onSelect: (option: T) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Search even when the box is empty (list everything). Default false. */
  searchOnEmpty?: boolean;
  testId?: string;
}

/**
 * A minimal debounced typeahead: an input plus a results dropdown backed by an
 * async `search`. Deliberately dependency-free (no combobox library) — it drives
 * the Jira setup wizard's board / epic / user pickers, which hit live Jira
 * search under the hood.
 */
export function Typeahead<T extends TypeaheadOption>({
  value,
  onChange,
  search,
  onSelect,
  placeholder,
  disabled,
  searchOnEmpty = false,
  testId,
}: TypeaheadProps<T>) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Guards against a slow earlier search overwriting a newer one's results.
  const seq = useRef(0);

  // Debounced search on the current value.
  useEffect(() => {
    if (disabled) return;
    if (!open) return;
    if (value.trim() === '' && !searchOnEmpty) {
      setOptions([]);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      search(value.trim())
        .then((res) => {
          if (mine === seq.current) setOptions(res);
        })
        .catch((e) => {
          if (mine === seq.current) {
            setOptions([]);
            setError(e instanceof Error ? e.message : String(e));
          }
        })
        .finally(() => {
          if (mine === seq.current) setLoading(false);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [value, open, disabled, search, searchOnEmpty]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (opt: T) => {
    onSelect(opt);
    setOpen(false);
  };

  return (
    <div className="typeahead" ref={boxRef} data-testid={testId}>
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && !disabled && (value.trim() !== '' || searchOnEmpty) && (
        <div className="typeahead-menu" role="listbox">
          {loading && <div className="typeahead-status">Searching…</div>}
          {error && <div className="typeahead-status error">⚠ {error}</div>}
          {!loading && !error && options.length === 0 && (
            <div className="typeahead-status">No matches</div>
          )}
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="typeahead-option"
              role="option"
              aria-selected={false}
              data-testid="typeahead-option"
              onClick={() => choose(opt)}
            >
              <span className="typeahead-label">{opt.label}</span>
              {opt.hint && <span className="typeahead-hint">{opt.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
