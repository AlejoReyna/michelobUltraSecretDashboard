"use client";

import { Github, Globe, Linkedin, Mail, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { ViewportReveal } from "@/components/viewport-reveal";
import { siteBranding, siteSocialLinks } from "@/lib/site-branding";

const socialLinks: Array<{
  icon: LucideIcon;
  href: string;
  label: string;
}> = [
  {
    icon: Github,
    href: siteSocialLinks.github,
    label: "GitHub",
  },
  {
    icon: Linkedin,
    href: siteSocialLinks.linkedin,
    label: "LinkedIn",
  },
  {
    icon: Mail,
    href: siteSocialLinks.mail,
    label: "Email",
  },
  {
    icon: Globe,
    href: siteSocialLinks.website,
    label: "Website",
  },
];

export function SiteFooter() {
  return (
    <footer className="shrink-0 border-t border-[#1A1A1A] bg-[#050505]/95 backdrop-blur-sm">
      <ViewportReveal
        variant="fade"
        className="footer-reveal-group flex flex-col items-center gap-2.5 px-4 py-3 text-center sm:px-6 lg:px-8"
      >
        <Image
          src={siteBranding.footerLogo.src}
          alt={siteBranding.footerLogo.alt}
          className="footer-reveal-item footer-reveal-item--logo h-7 w-auto sm:h-8"
          width={1200}
          height={700}
          priority
        />
        <div className="footer-reveal-item footer-reveal-item--copy flex max-w-md flex-col items-center gap-0.5 font-mono text-[9px] leading-snug tracking-[0.02em] text-[#7A7A7A] sm:text-[10px]">
          <p>This project was built for the</p>
          <p>
            <a
              href={siteBranding.hackathon.url}
              target="_blank"
              rel="noreferrer"
              className="text-[#B8B8B8] underline decoration-[#3A3A3A] underline-offset-2 transition-colors hover:text-white hover:decoration-[#7A7A7A]"
            >
              {siteBranding.hackathon.label}
            </a>
            .
          </p>
        </div>
        <nav
          aria-label="Social links"
          className="footer-reveal-item footer-reveal-item--social flex items-center justify-center gap-1 sm:gap-2"
        >
          {socialLinks.map(({ icon: Icon, href, label }) => (
            <a
              key={label}
              href={href}
              target={href.startsWith("mailto:") ? undefined : "_blank"}
              rel={href.startsWith("mailto:") ? undefined : "noreferrer"}
              aria-label={label}
              className="flex h-8 w-8 items-center justify-center rounded-sm text-[#7A7A7A] transition-colors hover:text-white"
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
            </a>
          ))}
        </nav>
      </ViewportReveal>
    </footer>
  );
}
