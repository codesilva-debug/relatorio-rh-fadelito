'use strict';

const crypto = require('node:crypto');

const COOKIE_NAME = 'relatorio_marcos_session';
const SESSION_HOURS = 12;

// Acesso temporário do protótipo. Substituir por autenticação real antes de publicar.
const LOGIN_USER = 'Master';
const LOGIN_PASSWORD = '123';
const SESSION_SECRET = 'relatorio-marcos-prototipo-session-key';

function safeEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left || '')).digest();
  const b = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

function validateCredentials(username, password) {
  return safeEqual(username, LOGIN_USER) && safeEqual(password, LOGIN_PASSWORD);
}

function cookieValue(req) {
  const header = String((req && req.headers && req.headers.cookie) || '');
  const item = header.split(';').map(function (part) { return part.trim(); })
    .find(function (part) { return part.indexOf(COOKIE_NAME + '=') === 0; });
  if (!item) return '';
  try {
    return decodeURIComponent(item.slice(COOKIE_NAME.length + 1));
  } catch (error) {
    return '';
  }
}

function signature(expiry) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(expiry)).digest('base64url');
}

function verifySession(req) {
  const token = cookieValue(req);
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expiry = Number(parts[0]);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  return safeEqual(parts[1], signature(expiry));
}

function setCookie(res, token, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', COOKIE_NAME + '=' + encodeURIComponent(token) +
    '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + maxAge + secure);
}

function createSession(res) {
  const expiry = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const token = String(expiry) + '.' + signature(expiry);
  setCookie(res, token, SESSION_HOURS * 60 * 60);
}

function clearSession(res) {
  setCookie(res, '', 0);
}

module.exports = { safeEqual, validateCredentials, verifySession, createSession, clearSession };
