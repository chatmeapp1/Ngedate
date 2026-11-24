class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const badRequest = (message, code = 'BAD_REQUEST') => new ApiError(400, code, message);
const unauthorized = (message = 'Silakan login', code = 'UNAUTHORIZED') => new ApiError(401, code, message);
const forbidden = (message = 'Tidak diizinkan', code = 'FORBIDDEN') => new ApiError(403, code, message);
const notFound = (message = 'Tidak ditemukan', code = 'NOT_FOUND') => new ApiError(404, code, message);
const conflict = (message, code = 'CONFLICT') => new ApiError(409, code, message);

// Bungkus handler async supaya error otomatis diteruskan ke error handler
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, wrap };
