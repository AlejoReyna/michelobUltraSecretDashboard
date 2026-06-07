"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type RevealVariant = "up" | "down" | "left" | "right" | "fade" | "scale" | "blur" | "expand";
export type RevealDuration = "fast" | "normal" | "slow";

type ViewportRevealProps = {
  children?: ReactNode;
  className?: string;
  delay?: number;
  variant?: RevealVariant;
  duration?: RevealDuration;
  as?: "div" | "section" | "article" | "li";
};

export function ViewportReveal({
  children,
  className,
  delay = 0,
  variant = "up",
  duration = "normal",
  as: Tag = "div",
}: ViewportRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -6% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={cx(
        "viewport-reveal",
        `viewport-reveal--variant-${variant}`,
        duration !== "normal" && `viewport-reveal--duration-${duration}`,
        visible && "viewport-reveal--visible",
        className,
      )}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

const FACTOR_VARIANTS: RevealVariant[] = ["up", "left", "scale", "right", "blur", "fade"];
const OUTCOME_VARIANTS: RevealVariant[] = ["left", "right", "up", "down"];
const CHAPTER_VARIANTS: RevealVariant[] = ["fade", "left", "down", "right", "scale", "blur"];

export function factorRevealVariant(index: number): RevealVariant {
  return FACTOR_VARIANTS[index % FACTOR_VARIANTS.length] ?? "up";
}

export function outcomeRevealVariant(index: number): RevealVariant {
  return OUTCOME_VARIANTS[index % OUTCOME_VARIANTS.length] ?? "up";
}

export function chapterRevealVariant(index: number): RevealVariant {
  return CHAPTER_VARIANTS[index % CHAPTER_VARIANTS.length] ?? "fade";
}
