const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createTokenRequestParams,
  parseLangMap,
  resolveAppKey,
  wrapTokenResponse,
} = require("../lib/nls-token.js");

test("parseLangMap returns empty object for invalid json", () => {
  assert.deepEqual(parseLangMap("not-json"), {});
});

test("resolveAppKey prefers lang mapping and falls back to default app key", () => {
  const map = {
    普通话: "cn-app-key",
    en: "en-app-key",
  };

  assert.equal(resolveAppKey(map, "ALIYUN_DEFAULT", "普通话"), "cn-app-key");
  assert.equal(resolveAppKey(map, "ALIYUN_DEFAULT", "jp"), "ALIYUN_DEFAULT");
});

test("createTokenRequestParams keeps timestamp in second precision", () => {
  const params = createTokenRequestParams({
    accessKeyId: "akid",
    nonce: "nonce-1",
    timestamp: new Date("2026-02-21T02:03:04.567Z"),
  });

  assert.equal(params.Timestamp, "2026-02-21T02:03:04Z");
  assert.equal(params.SignatureNonce, "nonce-1");
  assert.equal(params.Action, "CreateToken");
  assert.equal(params.AccessKeyId, "akid");
});

test("wrapTokenResponse returns Recorder.js-compatible payload", () => {
  const response = wrapTokenResponse({
    appkey: "app-1",
    token: "token-1",
    expireTime: 123,
  });

  assert.deepEqual(response, {
    c: 0,
    m: "",
    v: {
      appkey: "app-1",
      token: "token-1",
      expireTime: 123,
    },
  });
});
