import { mossTufts, type Overgrowth as Stage } from "../lib/overgrowth.js";

const MOSS = ["#3f6212", "#4d7c0f", "#65a30d", "#84cc16"];

/** Corner webs by stage, as [top-left, top-right] sizes in pixels, 0 for none. */
const WEBS: Record<Stage, [number, number]> = { 0: [0, 0], 1: [0, 0], 2: [0, 24], 3: [22, 34], 4: [32, 44] };

/** Moss along the bottom of a row and webs in its corners, grown to `stage`. */
export function Overgrowth({ seed, stage }: { seed: string; stage: Stage }) {
  if (stage === 0) return null;
  const [leftWeb, rightWeb] = WEBS[stage];

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {mossTufts(seed, stage).map((tuft, index) => (
        <MossTuft key={index} left={tuft.left} size={tuft.size} color={MOSS[tuft.shade]!} />
      ))}
      {leftWeb > 0 && <CornerWeb size={leftWeb} corner="left" />}
      {rightWeb > 0 && <CornerWeb size={rightWeb} corner="right" />}
      {stage === 4 && <Spider />}
    </div>
  );
}

function MossTuft({ left, size, color }: { left: number; size: number; color: string }) {
  return (
    <svg
      viewBox="0 0 20 10"
      className="absolute -bottom-px opacity-80 dark:opacity-70"
      style={{ left: `calc(${left}% - ${size / 2}px)`, width: size, height: size / 2 }}
    >
      <g fill={color}>
        <ellipse cx="10" cy="10" rx="10" ry="4" />
        <circle cx="5" cy="7" r="3" />
        <circle cx="10" cy="5.5" r="4" />
        <circle cx="15" cy="7" r="3" />
      </g>
      <g fill="#bef264" opacity="0.45">
        <circle cx="9" cy="3.5" r="1.2" />
        <circle cx="14" cy="5.5" r="0.8" />
        <circle cx="5" cy="5.5" r="0.7" />
      </g>
    </svg>
  );
}

const SPOKES = [0, 22.5, 45, 67.5, 90].map((degrees) => (degrees * Math.PI) / 180);
const RINGS = [9, 16, 23, 30, 37];

/** A web strung across one top corner, its spokes fanning out from the corner itself. */
function CornerWeb({ size, corner }: { size: number; corner: "left" | "right" }) {
  const point = (radius: number, angle: number) => [radius * Math.cos(angle), radius * Math.sin(angle)] as const;

  return (
    <svg
      viewBox="0 0 40 40"
      className={`absolute top-0 text-ink-500 opacity-70 dark:text-ink-300 dark:opacity-50 ${
        corner === "left" ? "left-0" : "right-0 -scale-x-100"
      }`}
      style={{ width: size, height: size }}
    >
      <g fill="none" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round">
        {SPOKES.map((angle) => {
          const [x, y] = point(40, angle);
          return <line key={angle} x1="0" y1="0" x2={x} y2={y} />;
        })}
        {RINGS.map((radius) =>
          SPOKES.slice(1).map((angle, index) => {
            const [x1, y1] = point(radius, SPOKES[index]!);
            const [x2, y2] = point(radius, angle);
            const [sagX, sagY] = point(radius * 0.86, (angle + SPOKES[index]!) / 2);
            return <path key={`${radius}-${angle}`} d={`M${x1} ${y1}Q${sagX} ${sagY} ${x2} ${y2}`} />;
          }),
        )}
      </g>
    </svg>
  );
}

/** A spider let down on a thread from the top edge, near the right-hand web. */
function Spider() {
  return (
    <svg viewBox="0 0 12 24" className="spider-sway absolute right-12 top-0 h-6 w-3 text-ink-700 dark:text-ink-300">
      <line x1="6" y1="0" x2="6" y2="15" stroke="currentColor" strokeWidth="0.4" opacity="0.6" />
      <g stroke="currentColor" strokeWidth="0.6" fill="none" strokeLinecap="round">
        <path d="M5 17L1.5 14.5M5 18L1 18M5 19L1.5 21.5M7 17L10.5 14.5M7 18L11 18M7 19L10.5 21.5" />
      </g>
      <circle cx="6" cy="16.2" r="1.3" fill="currentColor" />
      <circle cx="6" cy="19" r="2" fill="currentColor" />
    </svg>
  );
}
