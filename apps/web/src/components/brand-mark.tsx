import { siteBranding } from "@/lib/site-branding";
import Image from "next/image";

type BrandMarkVariant = "nav" | "rail" | "footer";

const variantStyles: Record<
  BrandMarkVariant,
  { container: string; signature: string }
> = {
  nav: {
    container: "relative w-[62%]",
    signature:
      "absolute bottom-[12%] left-[79%] z-0 whitespace-nowrap font-mono text-[7.2px] leading-tight tracking-[0.04em] text-[#D8D8D8]",
  },
  rail: {
    container: "relative w-9",
    signature: "sr-only",
  },
  footer: {
    container: "relative w-[88px] sm:w-[104px]",
    signature:
      "absolute bottom-[12%] left-[79%] z-0 whitespace-nowrap font-mono text-[6px] leading-tight tracking-[0.04em] text-[#D8D8D8] sm:text-[7.2px]",
  },
};

export function BrandMark({ variant = "nav" }: { variant?: BrandMarkVariant }) {
  const styles = variantStyles[variant];

  return (
    <div className={styles.container}>
      <span className={styles.signature}>{siteBranding.signature}</span>
      <Image
        src={siteBranding.logo.src}
        alt={siteBranding.logo.alt}
        className="relative z-10 h-auto w-full"
        width={1200}
        height={700}
        priority
      />
    </div>
  );
}
