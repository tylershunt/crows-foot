/**
 * Attributes for a surface standing in for the title bar the window does not
 * have: a pull anywhere on it that is not one of our own controls moves the
 * window.
 */
export function titleBar(className: string) {
  return { className, "data-tauri-drag-region": "deep" };
}

/**
 * Header classes that seat a row beside the close, minimise, and zoom controls,
 * which `trafficLightPosition` in `tauri.conf.json` centres on a 3.5rem row
 * starting 18px from the left edge.
 */
export const BESIDE_WINDOW_CONTROLS = "h-14 pl-[5.5rem]";
