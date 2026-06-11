"use client";

import { useEffect } from "react";

const THEME_COLOR_SELECTOR = 'meta[name="theme-color"]';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type DeviceTopSectionProps = {
  color?: string;
  className?: string;
  updateThemeColor?: boolean;
};

export function DeviceTopSection({
  color = "#000000",
  className,
  updateThemeColor = true,
}: DeviceTopSectionProps) {
  useEffect(() => {
    if (!updateThemeColor) {
      return;
    }

    let meta = document.querySelector<HTMLMetaElement>(THEME_COLOR_SELECTOR);
    const createdMeta = !meta;

    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.append(meta);
    }

    const previousContent = meta.getAttribute("content");
    meta.setAttribute("content", color);

    return () => {
      if (createdMeta) {
        meta.remove();
        return;
      }

      if (previousContent === null) {
        meta.removeAttribute("content");
        return;
      }

      meta.setAttribute("content", previousContent);
    };
  }, [color, updateThemeColor]);

  return (
    <div
      aria-hidden="true"
      data-device-top-section
      className={cx("shrink-0 transition-colors duration-200 lg:hidden", className)}
      style={{ height: "env(safe-area-inset-top)", backgroundColor: color }}
    />
  );
}
