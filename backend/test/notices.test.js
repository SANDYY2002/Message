import { test } from "node:test";
import assert from "node:assert/strict";
import {
  noticeDefaults,
  readNoticeOverrides,
  createNoticeResolver,
} from "../../shared/notices.mjs";
test("only public catalog keys and valid templates are accepted", () => {
  assert.throws(() => readNoticeOverrides("{invalid"), /valid JSON/);
  assert.throws(() => readNoticeOverrides("[]"), /JSON object/);
  assert.throws(
    () => readNoticeOverrides('{"DB_PASSWORD":"secret"}'),
    /Unknown notice key/,
  );
  assert.throws(
    () => readNoticeOverrides('{"CHAT_PRIVACY_NOTICE":42}'),
    /must be text/,
  );
  assert.throws(
    () => readNoticeOverrides('{"CHAT_PRIVACY_NOTICE":"{value9}"}'),
    /unsupported placeholder/,
  );
  assert.deepEqual(readNoticeOverrides('{"CHAT_PRIVACY_NOTICE":"  "}'), {});
});
test("overrides preserve dynamic values, fallbacks and the original chat alias", () => {
  const overrides = readNoticeOverrides(
    JSON.stringify({
      NOTICE_ENTER_1_VALUE_CHARACTERS: "Use 1 to {value0} characters.",
      CHAT_PRIVACY_NOTICE: "Configured chat text",
    }),
    "Legacy text",
  );
  const resolve = createNoticeResolver(overrides);
  assert.equal(
    resolve(noticeDefaults.NOTICE_ENTER_1_VALUE_CHARACTERS, { value0: 1000 }),
    "Use 1 to 1000 characters.",
  );
  assert.equal(
    resolve(noticeDefaults.CHAT_PRIVACY_NOTICE),
    "Configured chat text",
  );
  assert.equal(resolve("A user-written message"), "A user-written message");
  assert.equal(
    createNoticeResolver()(noticeDefaults.BLOCKED_CHAT_NOTICE),
    noticeDefaults.BLOCKED_CHAT_NOTICE,
  );
  assert.equal(
    readNoticeOverrides("", "Legacy text").CHAT_PRIVACY_NOTICE,
    "Legacy text",
  );
});
