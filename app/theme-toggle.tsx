"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Light and dark, chosen rather than inherited.
 *
 * The record defaults to paper: a document is light, and a visitor whose OS is
 * dark still opens on paper. Dark is a deliberate choice, remembered in
 * localStorage and re-applied by the inline script in layout.tsx before first
 * paint — so a reload never flashes the wrong theme.
 *
 * The control is a ruled square, not a floating pill. It belongs to the form the
 * record is printed on.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  // The inline script has already set the attribute; read it rather than
  // guessing, so the button's label matches what is on screen.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("tribunal-theme", next);
    } catch {
      // A private window that refuses storage still gets the toggle; it simply
      // will not remember. Not worth failing over.
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
    >
      <span className="visually-hidden">
        {theme === "dark" ? "Switch to light" : "Switch to dark"}
      </span>
      {theme === "dark" ? (
        // Moon: shown while dark is active.
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M13.2 10.4A5.6 5.6 0 0 1 5.9 3.1a5.6 5.6 0 1 0 7.3 7.3Z"
            fill="currentColor"
          />
        </svg>
      ) : (
        // Sun: shown while light is active.
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="3.1" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <path d="M8 1.2v1.9M8 12.9v1.9M1.2 8h1.9M12.9 8h1.9" />
            <path d="M3.2 3.2l1.35 1.35M11.45 11.45l1.35 1.35M12.8 3.2l-1.35 1.35M4.55 11.45L3.2 12.8" />
          </g>
        </svg>
      )}
    </button>
  );
}
