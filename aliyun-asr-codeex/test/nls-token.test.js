const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTokenWithSdk,
  parseLangMap,
  resolveAppKey,
  resolveServerConfig,
  shouldReuseToken,
  wrapTokenResponse,
} = require('../lib/nls-token.js');

test('parseLangMap returns empty object for invalid json', () => {
  assert.deepEqual(parseLangMap('not-json'), {});
});

test('resolveAppKey prefers lang mapping and falls back to default app key', () => {
  const map = {
    普通话: 'cn-app-key',
    en: 'en-app-key',
  };

  assert.equal(resolveAppKey(map, 'ALIYUN_DEFAULT', '普通话'), 'cn-app-key');
  assert.equal(resolveAppKey(map, 'ALIYUN_DEFAULT', 'jp'), 'ALIYUN_DEFAULT');
});

test('resolveServerConfig supports both env naming styles', () => {
  const withUnderscore = resolveServerConfig({
    ALIYUN_ACCESS_KEY_ID: 'ak-1',
    ALIYUN_ACCESS_KEY_SECRET: 'sk-1',
    ALIYUN_APP_KEY: 'app-1',
  });

  assert.equal(withUnderscore.accessKeyId, 'ak-1');
  assert.equal(withUnderscore.accessKeySecret, 'sk-1');
  assert.equal(withUnderscore.defaultAppKey, 'app-1');

  const legacyStyle = resolveServerConfig({
    ALIYUN_ACCESSKEY_ID: 'ak-2',
    ALIYUN_ACCESSKEY_SECRET: 'sk-2',
    ALIYUN_APP_KEY: 'app-2',
  });

  assert.equal(legacyStyle.accessKeyId, 'ak-2');
  assert.equal(legacyStyle.accessKeySecret, 'sk-2');
  assert.equal(legacyStyle.defaultAppKey, 'app-2');
});

test('shouldReuseToken refreshes token 2 hours before expire by default', () => {
  const nowMs = Date.parse('2026-02-21T00:00:00Z');
  const expireIn3Hours = Math.floor((nowMs + 3 * 60 * 60 * 1000) / 1000);
  const expireIn30Minutes = Math.floor((nowMs + 30 * 60 * 1000) / 1000);

  assert.equal(shouldReuseToken(expireIn3Hours, nowMs), true);
  assert.equal(shouldReuseToken(expireIn30Minutes, nowMs), false);
});

test('createTokenWithSdk calls POP SDK CreateToken endpoint', async () => {
  const calls = [];
  const configs = [];

  const result = await createTokenWithSdk({
    accessKeyId: 'ak-test',
    accessKeySecret: 'sk-test',
    clientFactory(config) {
      configs.push(config);
      return {
        async request(action, params, options) {
          calls.push({ action, params, options });
          return {
            Token: {
              Id: 'token-123',
              ExpireTime: 1771649104,
            },
          };
        },
      };
    },
  });

  assert.deepEqual(configs, [
    {
      accessKeyId: 'ak-test',
      accessKeySecret: 'sk-test',
      endpoint: 'https://nls-meta.cn-shanghai.aliyuncs.com',
      apiVersion: '2019-02-28',
    },
  ]);
  assert.deepEqual(calls, [
    {
      action: 'CreateToken',
      params: {},
      options: { method: 'POST' },
    },
  ]);
  assert.deepEqual(result, {
    token: 'token-123',
    expireTime: 1771649104,
  });
});

test('wrapTokenResponse returns Recorder.js-compatible payload', () => {
  const response = wrapTokenResponse({
    appkey: 'app-1',
    token: 'token-1',
    expireTime: 123,
  });

  assert.deepEqual(response, {
    c: 0,
    m: '',
    v: {
      appkey: 'app-1',
      token: 'token-1',
      expireTime: 123,
    },
  });
});
