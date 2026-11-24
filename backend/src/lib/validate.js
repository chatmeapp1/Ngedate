const { badRequest } = require('./errors');

function str(value, name, { min = 0, max = 255, optional = false, pattern } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw badRequest(`${name} wajib diisi`);
  }
  if (typeof value !== 'string') throw badRequest(`${name} harus berupa teks`);
  const v = value.trim();
  if (v.length < min) throw badRequest(`${name} minimal ${min} karakter`);
  if (v.length > max) throw badRequest(`${name} maksimal ${max} karakter`);
  if (pattern && !pattern.test(v)) throw badRequest(`${name} tidak valid`);
  return v;
}

function int(value, name, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw badRequest(`${name} wajib diisi`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw badRequest(`${name} harus bilangan bulat`);
  if (n < min) throw badRequest(`${name} minimal ${min}`);
  if (n > max) throw badRequest(`${name} maksimal ${max}`);
  return n;
}

function bool(value, name, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    throw badRequest(`${name} wajib diisi`);
  }
  if (typeof value !== 'boolean') throw badRequest(`${name} harus true/false`);
  return value;
}

function id(value, name = 'id') {
  return int(value, name, { min: 1 });
}

module.exports = { str, int, bool, id };
