"use client";

import { useEffect, useState } from "react";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { cx } from "./ui";

type Theme = "light" | "dark" | "system";

export function setTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
    document.cookie = "shipyard-theme=; path=/; max-age=0; samesite=lax";
  } else {
    root.dataset.theme = theme;
    document.cookie = `shipyard-theme=${theme}; path=/; max-age=31536000; samesite=lax`;
  }
  window.dispatchEvent(new CustomEvent("shipyard:theme", { detail: theme }));
}

export function ThemeSwitch() {
  const [theme, set] = useState<Theme>("system");
  useEffect(() => {
    const read = () => set((document.documentElement.dataset.theme as Theme) || "system");
    read();
    window.addEventListener("shipyard:theme", read);
    return () => window.removeEventListener("shipyard:theme", read);
  }, []);
  const opts: { key: Theme; icon: typeof IconSun; label: string }[] = [
    { key: "light", icon: IconSun, label: "Light" },
    { key: "system", icon: IconDeviceDesktop, label: "System" },
    { key: "dark", icon: IconMoon, label: "Dark" },
  ];
  return (
    <div className="flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Theme">
      {opts.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          role="radio"
          aria-checked={theme === key}
          aria-label={label}
          title={label}
          onClick={() => setTheme(key)}
          className={cx("flex flex-1 justify-center rounded-md py-1", theme === key ? "bg-subtle text-fg" : "text-faint hover:text-fg")}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
