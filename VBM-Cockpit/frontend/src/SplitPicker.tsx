/**
 * SplitPicker — the ordered dimension stack, styled like the VBM cockpit's
 * treemap level controls: one rounded "pill" per level with an inline tag,
 * a borderless select, and ◀ ▶ ✕ affordances, plus a dashed "+ Add split".
 *
 * Drop-in replacement for the SplitPicker in Portfolio.tsx — same props, so
 * every call site (value-by-split, treemap drill path) keeps working.
 *
 * Uses a native <select> rather than the <Select> UI component so the control
 * can sit borderless inside the pill; the tiny tag on the left carries the
 * label that <Select> would normally render above the field.
 */

type Option = { value: string; label: string };

export function SplitPicker({
  value,
  onChange,
  options,
  min = 1,
  max = 3,
  /** Tag shown inside each pill. Pass ["L", "L"] for treemap-style L1/L2/L3. */
  tags,
  labels = ["Group by", "Then by"],
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: Option[];
  min?: number;
  max?: number;
  tags?: (i: number) => string;
  labels?: string[];
}) {
  const free = (self?: string) =>
    options.filter((o) => o.value === self || !value.includes(o.value));

  const next = free()[0]?.value;

  const tagOf =
    tags ?? ((i: number) => (i === 0 ? labels[0] : labels[1] ?? "Then by"));

  const setAt = (i: number, dim: string) =>
    onChange(value.map((d, j) => (j === i ? dim : d)));

  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="splitpicker">
      {value.map((dim, i) => (
        <div key={`${dim}-${i}`} className="split-level">
          <span className="split-tag">{tagOf(i)}</span>

          <select
            className="split-sel"
            value={dim}
            aria-label={`${tagOf(i)} dimension`}
            onChange={(e) => setAt(i, e.target.value)}
          >
            {free(dim).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            title="Move left"
            aria-label="Move split left"
            disabled={i === 0}
            onClick={() => move(i, -1)}
          >
            ◀
          </button>
          <button
            type="button"
            title="Move right"
            aria-label="Move split right"
            disabled={i === value.length - 1}
            onClick={() => move(i, 1)}
          >
            ▶
          </button>
          <button
            type="button"
            title="Remove split"
            aria-label="Remove split"
            disabled={value.length <= min}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}

      {value.length < max && next && (
        <button
          type="button"
          className="split-add"
          onClick={() => onChange([...value, next])}
        >
          + Add split
        </button>
      )}
    </div>
  );
}

export default SplitPicker;
