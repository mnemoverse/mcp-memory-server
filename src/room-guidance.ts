/**
 * Preserve executable punctuation in server-authored guidance while removing
 * control/bidi/zero-width characters that could reshape an MCP tool result.
 */
export function sanitizeRoomGuidance(
  value: string | undefined | null,
  cap = 2000,
): string {
  let out = "";
  for (const ch of value ?? "") {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBidi =
      code === 0x061c ||
      (code >= 0x200e && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    const isZeroWidth =
      code === 0x200b ||
      code === 0x200c ||
      code === 0x200d ||
      code === 0x2060 ||
      code === 0xfeff;
    out += isControl || isBidi || isZeroWidth ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, cap);
}

/**
 * Prefer Core's current API-aware contract, with a compatibility fallback for
 * connector-before-Core rolling deploys.
 */
export function roomCreatedNextSteps(
  coreNextSteps: string | undefined | null,
  address: string,
  roomId: string,
): string {
  return (
    sanitizeRoomGuidance(coreNextSteps) ||
    `Use it now: pass domain="${address}" on memory_write / memory_read. ` +
      `To add someone: call memory_invite_to_room with room_id="${roomId}".`
  );
}
