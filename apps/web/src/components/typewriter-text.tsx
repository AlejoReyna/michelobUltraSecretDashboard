"use client";

import { useEffect, useState } from "react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type TypewriterTextProps = {
  text: string;
  className?: string;
  speed?: number;
  startDelay?: number;
};

export function TypewriterText({ text, className, speed = 22, startDelay = 400 }: TypewriterTextProps) {
  const [displayed, setDisplayed] = useState("");
  const [active, setActive] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setActive(false);
    setComplete(false);
  }, [text]);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setDisplayed(text);
      setComplete(true);
      return;
    }

    const startTimer = window.setTimeout(() => setActive(true), startDelay);
    return () => window.clearTimeout(startTimer);
  }, [text, startDelay]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setDisplayed(text);
      setComplete(true);
      return;
    }

    if (displayed.length >= text.length) {
      setComplete(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setDisplayed(text.slice(0, displayed.length + 1));
    }, speed);

    return () => window.clearTimeout(timer);
  }, [active, displayed, speed, text]);

  return (
    <div className="grid">
      <p className={cx("invisible col-start-1 row-start-1", className)} aria-hidden="true">
        {text}
      </p>
      <p className={cx("col-start-1 row-start-1", className)} aria-live="polite">
        {displayed}
        {active && !complete ? <span className="typewriter-cursor" aria-hidden="true" /> : null}
      </p>
    </div>
  );
}
