import assert from "node:assert/strict";
import test from "node:test";
import { REDACTED, redact } from "../src/redact.js";

test("redact recursively removes sensitive fields while preserving public hashes", () => {
  const output = redact({
    apiKey: "abc123",
    tx_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    nested: {
      TWAK_WALLET_PASSWORD: "super-secret",
      note: "Loaded /home/ec2-user/cascade-ai/.env",
      normal: "visible",
    },
    list: [{ token: "bearer-token" }],
  });

  assert.equal(output.apiKey, REDACTED);
  assert.equal(output.tx_hash, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(output.nested.TWAK_WALLET_PASSWORD, REDACTED);
  assert.equal(output.nested.note, REDACTED);
  assert.equal(output.nested.normal, "visible");
  assert.equal(output.list[0].token, REDACTED);
});

test("redact preserves trading position numeric fields", () => {
  const output = redact({
    positions: [
      {
        symbol: "FLOKI",
        amount_tokens: 1176.73,
        entry_price: 0.0000199,
        entry_value_usdc: 0.029,
      },
    ],
  });

  assert.equal(output.positions[0].amount_tokens, 1176.73);
  assert.equal(output.positions[0].entry_price, 0.0000199);
  assert.equal(output.positions[0].symbol, "FLOKI");
});
