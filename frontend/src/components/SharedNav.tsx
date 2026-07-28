import { useEffect, useRef, useState } from "react";
import {
  assertDisplayStatePatch,
  getCanonicalNavigation
} from "@/shared-platform";

const projects = getCanonicalNavigation("sox");
const navigationLinks = projects.filter((project) => project.id !== "hub");
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
  const linksRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mobile = false;
    try {
      mobile = window.matchMedia("(max-width: 760px)").matches;
    } catch {
      // A visible link rail is an enhancement; navigation still works without matchMedia.
    }
    if (!mobile) return;
    const frame = window.requestAnimationFrame(() => {
      linksRef.current
        ?.querySelector<HTMLElement>('[aria-current="page"]')
        ?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

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
    <nav className="quant-shared-nav" aria-label="연결 프로젝트 바로가기">
      <div className="quant-shared-nav__inner">
        <a
          className="quant-shared-nav__brand"
          href={projects[0].url}
          aria-label="Quant Research Hub로 이동"
        >
          Quant Research Hub
        </a>
        <div ref={linksRef} className="quant-shared-nav__links" aria-label="프로젝트 목록">
          {navigationLinks.map((project) => (
            <a
              key={project.id}
              className={`quant-shared-nav__link${project.current ? " is-active" : ""}`}
              href={project.url}
              aria-current={project.current ? "page" : undefined}
            >
              {project.label}
            </a>
          ))}
        </div>
        <button
          className="quant-shared-nav__theme"
          type="button"
          aria-pressed={theme === "dark"}
          aria-label={
            theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"
          }
          onClick={toggleTheme}
        >
          <span className="quant-shared-nav__theme-icon" aria-hidden="true" />
          <span className="quant-shared-nav__theme-text">
            {theme === "dark" ? "라이트 모드" : "다크 모드"}
          </span>
        </button>
      </div>
    </nav>
  );
}
