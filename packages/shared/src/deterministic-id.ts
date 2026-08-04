import { createHash } from "node:crypto";

/**
 * Derives a stable, UUID-formatted identifier from an arbitrary string
 * seed. Used wherever an ID needs to be a deterministic function of stable
 * business inputs rather than randomly generated — e.g. so that retrying an
 * operation after a crash recomputes the same ID instead of creating a
 * duplicate, or so that replaying the same history reproduces the same
 * entity identity.
 *
 * Callers should namespace their seed (e.g.
 * `` `${packageName}:${concept}:${businessKey}` ``) so different concepts
 * never collide even if their raw business keys happen to coincide.
 */
export function deriveDeterministicId(seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex");

  const timeLow = digest.slice(0, 8);
  const timeMid = digest.slice(8, 12);
  const timeHiAndVersion = `4${digest.slice(13, 16)}`;
  const variantNibble = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  const clockSeq = `${variantNibble}${digest.slice(17, 20)}`;
  const node = digest.slice(20, 32);

  return `${timeLow}-${timeMid}-${timeHiAndVersion}-${clockSeq}-${node}`;
}
