import { useState } from "react";
import {
  assertDisplayStatePatch,
  getCanonicalNavigation
} from "@/shared-platform";

const projects = getCanonicalNavigation("sox");
const THEME_STORAGE_KEY = "quant-research-theme";
const LEGACY_THEME_STORAGE_KEY = "sox-theme";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  try {
    const stored =
      window.localStorage.getItem(THEME_STORAGE_KEY) ||
      window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      document.documentElement.dataset.theme = stored;
      return stored;
    }
  } catch {
    // Storage is optional; the document theme remains the fallback.
  }
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function SharedNav() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    assertDisplayStatePatch({ theme: nextTheme });
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } catch {
      // The current theme still changes when persistence is unavailable.
    }
  }

  return (
    <nav
      className="site-nav"
      aria-label="11개 퀀트 리서치 프로젝트"
    >
      <a
        className="site-nav-brand"
        href={projects[0].url}
        aria-label="Quant Research Hub로 이동"
      >
        Quant Research Hub
      </a>
      <div className="site-nav-links" aria-label="프로젝트 목록">
        {projects.map((project) => (
          <a
            key={project.id}
            className={project.current ? "is-active" : undefined}
            href={project.current ? "#top" : project.url}
            aria-current={project.current ? "page" : undefined}
          >
            {project.label}
          </a>
        ))}
      </div>
      <button
        className="theme-toggle"
        type="button"
        aria-pressed={theme === "dark"}
        aria-label={
          theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"
        }
        onClick={toggleTheme}
      >
        <span className="theme-toggle-icon" aria-hidden="true" />
        <span className="theme-toggle-text">
          {theme === "dark" ? "라이트 모드" : "다크 모드"}
        </span>
      </button>
    </nav>
  );
}
