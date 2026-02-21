const { createHmac, randomUUID } = require('node:crypto');

function encodeRFC3986(value) {
  return encodeURIComponent(value)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/'/g, '%27');
}

function signParams(params, secret) {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${encodeRFC3986(key)}=${encodeRFC3986(params[key])}`)
    .join('&');
  const stringToSign = `POST&${encodeRFC3986('/')}&${encodeRFC3986(sorted)}`;
  return createHmac('sha1', `${secret}&`).update(stringToSign).digest('base64');
}

function createTokenRequestParams({ accessKeyId, nonce = randomUUID(), timestamp = new Date() }) {
  const normalizedTimestamp = timestamp.toISOString().replace(/\.\d{3}Z$/, 'Z');

  return {
    AccessKeyId: accessKeyId,
    Action: 'CreateToken',
    Format: 'JSON',
    RegionId: 'cn-shanghai',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: nonce,
    SignatureVersion: '1.0',
    Timestamp: normalizedTimestamp,
    Version: '2019-02-28',
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
  createTokenRequestParams,
  parseLangMap,
  resolveAppKey,
  signParams,
  wrapTokenResponse,
};
