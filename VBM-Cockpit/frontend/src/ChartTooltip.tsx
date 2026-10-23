/**
 * Floating hover tooltip for the decomposition tree.
 *
 * Recharts ships <Tooltip/> and every chart in charts.tsx uses it -- but that
 * only works inside a Recharts <ResponsiveContainer>. The decomposition tree is
 * a grid of HTML buttons, not an SVG chart, so it needs its own. This is the
 * minimum for that: one floating div mounted once at the app root, which any
 * mark shows/moves/hides via `useChartTooltip()`.
 *
 * Mounted outside every PrintSection, so the PDF export -- which rasterizes one
 * section's DOM subtree -- can never capture the card.
 */
import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo,
  useRef, useState, type ReactNode,
} from "react";

interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

interface ChartTooltipContextValue {
  show(e: { clientX: number; clientY: number }, content: ReactNode): void;
  move(e: { clientX: number; clientY: number }): void;
  hide(): void;
}

const ChartTooltipContext = createContext<ChartTooltipContextValue | null>(null);

const OFFSET = 14;
/** Fallbacks used only for the first frame, before the card is measured. */
const EST_W = 260;
const EST_H = 96;

export function ChartTooltipProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TooltipState | null>(null);
  const frame = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: EST_W, h: EST_H });

  // Tracks the content synchronously, outside the rAF batching below. A real
  // hover fires `onMouseEnter` (carries content) immediately followed by an
  // `onMouseMove` (no content, position-only) -- that second call used to
  // `cancelAnimationFrame` the first call's still-pending rAF and reschedule
  // one that fell back to the *committed* React state for content. But the
  // enter call's state commit hadn't happened yet (its rAF was the one just
  // cancelled), so the fallback read stale/null state and the tooltip never
  // appeared. Recording content here, synchronously, means the latest rAF --
  // however many times position updates cancel and reschedule it -- always
  // sees the right content.
  const contentRef = useRef<ReactNode | null>(null);

  const place = useCallback((clientX: number, clientY: number, content?: ReactNode) => {
    if (content !== undefined) contentRef.current = content;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const c = contentRef.current;
      if (c == null) {
        setState(null);
        return;
      }
      setState({ x: clientX + OFFSET, y: clientY + OFFSET, content: c });
    });
  }, []);

  const show = useCallback(
    (e: { clientX: number; clientY: number }, content: ReactNode) =>
      place(e.clientX, e.clientY, content),
    [place],
  );

  const move = useCallback(
    (e: { clientX: number; clientY: number }) => place(e.clientX, e.clientY),
    [place],
  );

  const hide = useCallback(() => {
    contentRef.current = null;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    setState(null);
  }, []);

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
  }, []);

  /* Measure the real card so flipping near the viewport edge is exact rather
     than guessed -- node names vary enough that one estimate cannot hold. */
  useLayoutEffect(() => {
    if (!state || !cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    setSize((prev) => (
      Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
        ? prev
        : { w: r.width, h: r.height }
    ));
  }, [state]);

  const value = useMemo(() => ({ show, move, hide }), [show, move, hide]);

  let left = 0;
  let top = 0;
  if (state) {
    const maxLeft = Math.max(OFFSET, window.innerWidth - size.w - OFFSET);
    const maxTop = Math.max(OFFSET, window.innerHeight - size.h - OFFSET);
    /* Flip to the other side of the cursor instead of merely clamping, so the
       card never sits on top of the node the user is pointing at. */
    left = state.x > maxLeft ? Math.max(OFFSET, state.x - size.w - 2 * OFFSET) : state.x;
    top = Math.min(state.y, maxTop);
  }

  return (
    <ChartTooltipContext.Provider value={value}>
      {children}
      {state && (
        <div className="chart-tooltip" style={{ left, top }} role="tooltip" ref={cardRef}>
          {state.content}
        </div>
      )}
    </ChartTooltipContext.Provider>
  );
}

export function useChartTooltip(): ChartTooltipContextValue {
  const ctx = useContext(ChartTooltipContext);
  if (!ctx) throw new Error("useChartTooltip must be used inside <ChartTooltipProvider>.");
  return ctx;
}

/** Small formatted row, for composing tooltip content. */
export function TooltipRow({ color, label, value, muted }: {
  color?: string;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className={muted ? "tt-row tt-row--muted" : "tt-row"}>
      {color && <i className="tt-sw" style={{ background: color }} />}
      <span>{label}</span>
      <b className="tt-val">{value}</b>
    </div>
  );
}
