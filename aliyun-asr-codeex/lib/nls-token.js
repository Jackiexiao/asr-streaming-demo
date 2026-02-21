const DEFAULT_TOKEN_ENDPOINT = 'https://nls-meta.cn-shanghai.aliyuncs.com';
const DEFAULT_API_VERSION = '2019-02-28';
const DEFAULT_REFRESH_AHEAD_SECONDS = 2 * 60 * 60;

function pickEnv(env, keys) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function parseRefreshAheadSeconds(raw) {
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return DEFAULT_REFRESH_AHEAD_SECONDS;
}

function resolveServerConfig(env = process.env) {
  return {
    accessKeyId: pickEnv(env, ['ALIYUN_ACCESS_KEY_ID']),
    accessKeySecret: pickEnv(env, ['ALIYUN_ACCESS_KEY_SECRET']),
    defaultAppKey: pickEnv(env, ['ALIYUN_APP_KEY']),
    langMapRaw: pickEnv(env, ['ALIYUN_APP_KEYS_JSON']),
    refreshAheadSeconds: parseRefreshAheadSeconds(pickEnv(env, ['ALIYUN_TOKEN_REFRESH_AHEAD_SECONDS'])),
  };
}

function parseLangMap(raw) {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const result = {};
    for (const [lang, appKey] of Object.entries(parsed)) {
      if (typeof appKey === 'string' && appKey.trim()) {
        result[lang] = appKey.trim();
      }
    }
    return result;
  } catch {
    return {};
  }
}

function resolveAppKey(langMap, defaultAppKey, lang) {
  if (lang && langMap[lang]) {
    return langMap[lang];
  }
  return defaultAppKey || '';
}

function shouldReuseToken(expireTime, nowMs = Date.now(), refreshAheadSeconds = DEFAULT_REFRESH_AHEAD_SECONDS) {
  const expireTimestamp = Number(expireTime);
  if (!Number.isFinite(expireTimestamp) || expireTimestamp <= 0) {
    return false;
  }

  const refreshWindowMs = Math.max(1, refreshAheadSeconds) * 1000;
  return expireTimestamp * 1000 - nowMs > refreshWindowMs;
}

function defaultClientFactory(config) {
  // Lazy load so unit tests can inject a fake client without installing SDK first.
  const PopCore = require('@alicloud/pop-core');
  return new PopCore(config);
}

async function createTokenWithSdk({
  accessKeyId,
  accessKeySecret,
  endpoint = DEFAULT_TOKEN_ENDPOINT,
  apiVersion = DEFAULT_API_VERSION,
  clientFactory = defaultClientFactory,
}) {
  const client = clientFactory({
    accessKeyId,
    accessKeySecret,
    endpoint,
    apiVersion,
  });

  const data = await client.request('CreateToken', {}, { method: 'POST' });
  const token = data?.Token?.Id;
  const expireTime = Number(data?.Token?.ExpireTime || 0);

  if (!token) {
    throw new Error('CreateToken 返回为空');
  }

  return {
    token,
    expireTime,
  };
}

function wrapTokenResponse({ appkey, token, expireTime }) {
  return {
    c: 0,
    m: '',
    v: {
      appkey,
      token,
      expireTime,
    },
  };
}

module.exports = {
  createTokenWithSdk,
  DEFAULT_REFRESH_AHEAD_SECONDS,
  parseLangMap,
  resolveAppKey,
  resolveServerConfig,
  shouldReuseToken,
  wrapTokenResponse,
};
