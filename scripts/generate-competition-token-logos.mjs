import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const competitionTokensPath = path.join(root, "apps/web/src/lib/competition-tokens.ts");
const outputPath = path.join(root, "apps/web/src/lib/competition-token-logos.ts");

function readCompetitionTokens() {
  const source = fs.readFileSync(competitionTokensPath, "utf8");
  const start = source.indexOf("export const COMPETITION_TOKENS = [");
  const end = source.indexOf("] as const;", start);
  const block = source.slice(start, end);

  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

async function fetchTokenLists() {
  const [cmcRes, extRes] = await Promise.all([
    fetch("https://tokens.pancakeswap.finance/cmc.json"),
    fetch("https://tokens.pancakeswap.finance/pancakeswap-extended.json"),
  ]);

  if (!cmcRes.ok || !extRes.ok) {
    throw new Error("Failed to fetch PancakeSwap token lists");
  }

  return {
    cmc: await cmcRes.json(),
    extended: await extRes.json(),
  };
}

function buildLogoMap(lists) {
  const bySymbol = new Map();

  for (const token of [...lists.cmc.tokens, ...lists.extended.tokens]) {
    if (token.chainId !== 56 || !token.symbol || !token.logoURI) {
      continue;
    }

    const key = /^[\x00-\x7F]+$/.test(token.symbol.trim())
      ? token.symbol.trim().toUpperCase()
      : token.symbol.trim();

    if (!bySymbol.has(key)) {
      bySymbol.set(key, token.logoURI);
    }
  }

  return bySymbol;
}

async function main() {
  const tokens = readCompetitionTokens();
  const bySymbol = buildLogoMap(await fetchTokenLists());
  const logoEntries = new Map();
  const missing = [];

  for (const symbol of tokens) {
    const key = /^[\x00-\x7F]+$/.test(symbol.trim()) ? symbol.trim().toUpperCase() : symbol.trim();
    const logo = bySymbol.get(key);

    if (logo) {
      if (!logoEntries.has(key)) {
        logoEntries.set(key, logo);
      }
      continue;
    }

    if (!missing.includes(symbol)) {
      missing.push(symbol);
    }
  }

  const entries = [...logoEntries.entries()].sort(([left], [right]) => left.localeCompare(right));

  const lines = entries
    .map(([symbol, logo]) => `  ${JSON.stringify(symbol)}: ${JSON.stringify(logo)},`)
    .join("\n");

  const output = `// Auto-generated from PancakeSwap BSC token lists for the competition allowlist.\n// Regenerate with: node scripts/generate-competition-token-logos.mjs\n\nexport const COMPETITION_TOKEN_LOGOS: Record<string, string> = {\n${lines}\n};\n\nexport const COMPETITION_TOKEN_LOGO_MISSING = ${JSON.stringify(missing, null, 2)} as const;\n`;

  fs.writeFileSync(outputPath, output);
  console.log(`Wrote ${entries.length} logos to ${outputPath}`);
  console.log(`${missing.length} symbols still missing logos: ${missing.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
