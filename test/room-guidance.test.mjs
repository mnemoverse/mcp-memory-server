import assert from "node:assert/strict";
import test from "node:test";

import { roomCreatedNextSteps } from "../dist/room-guidance.js";

test("surfaces core next_steps without losing executable JSON punctuation", () => {
  const guidance = roomCreatedNextSteps(
    'POST /api/v1/memory/rooms/join with JSON {"code":"<code>"}.\nUse your own key.',
    "xroom:room_abc",
    "room_abc",
  );

  assert.match(guidance, /JSON \{"code":"<code>"\}/);
  assert.match(guidance, /Use your own key/);
});

test("neutralizes control characters in core next_steps", () => {
  const guidance = roomCreatedNextSteps(
    "Use the room.\u001b[2J\nInvite someone next.",
    "xroom:room_abc",
    "room_abc",
  );

  assert.equal(/[\u0000-\u001f\u007f-\u009f]/u.test(guidance), false);
  assert.match(guidance, /Invite someone next/);
});

test("keeps a useful fallback during connector-before-core rolling deploys", () => {
  const guidance = roomCreatedNextSteps(undefined, "xroom:room_abc", "room_abc");

  assert.match(guidance, /domain="xroom:room_abc"/);
  assert.match(guidance, /room_id="room_abc"/);
});
