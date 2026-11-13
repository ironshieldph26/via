'use strict';

const exercise = require('./exercise');

const FORMATS = {
  combined:
    ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"',
  common:
    ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length]',
  dev: ':method :url :status :response-time ms - :res[content-length]',
  short:
    ':remote-addr :remote-user :method :url HTTP/:http-version :status :res[content-length] - :response-time ms',
  tiny: ':method :url :status :res[content-length] - :response-time ms',
};

const TOKENS = Object.create(null);

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function isTTY(stream) {
  return !!(stream && typeof stream.isTTY !== 'undefined' ? stream.isTTY : false);
}

function token(name, fn) {
  if (typeof name !== 'string' || !name) throw new TypeError('token name must be a non-empty string');
  if (typeof fn !== 'function') throw new TypeError('token value must be a function');
  TOKENS[name] = fn;
  return via;
}

function format(name, fmt) {
  if (typeof name !== 'string' || !name) throw new TypeError('format name must be a non-empty string');
  FORMATS[name] = fmt;
  return via;
}

function normalizeOptions(options) {
  let opts = {};
  if (options == null) options = {};
  if (typeof options === 'string') {
    opts.format = options;
  } else if (typeof options === 'function') {
    opts.format = options;
  } else if (typeof options === 'object') {
    opts = Object.assign({}, options);
  } else {
    throw new TypeError('options must be a string, function, or object');
  }

  if (
    opts.exercise != null &&
    (typeof opts.exercise !== 'object' || Array.isArray(opts.exercise))
  ) {
    throw new TypeError('exercise must be an object');
  }

  if (opts.format == null) opts.format = 'dev';
  if (opts.stream == null) opts.stream = process.stdout;
  if (opts.eol == null) opts.eol = '\n';
  if (typeof opts.colors === 'undefined') {
    opts.colors = isTTY(opts.stream);
  }
  if (typeof opts.immediate === 'undefined') opts.immediate = false;
  if (typeof opts.skip !== 'function' && opts.skip != null) {
    throw new TypeError('skip must be a function');
  }
  return opts;
}

function getStart(req) {
  if (req._viaStart == null) {
    req._viaStart = process.hrtime.bigint();
  }
  return req._viaStart;
}

function responseTimeMs(req, res) {
  const start = getStart(req);
  const diff = Number(process.hrtime.bigint() - start) / 1e6;
  return diff;
}

function remoteAddr(req) {
  return (
    (req.ip ||
      (req.connection && req.connection.remoteAddress) ||
      (req.socket && req.socket.remoteAddress) ||
      (req.connection && req.connection.socket && req.connection.socket.remoteAddress)) ||
    '-'
  );
}

function remoteUser(req) {
  if (req.user) {
    if (typeof req.user === 'string') return req.user;
    return req.user.name || req.user.username || req.user.id || '-';
  }
  const auth = req.headers && req.headers.authorization;
  if (auth && auth.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx !== -1) return decoded.slice(0, idx) || '-';
    } catch (e) {
      /* ignore */
    }
  }
  return '-';
}

function headerValue(obj, name) {
  if (!obj || !name) return undefined;
  const lower = String(name).toLowerCase();
  if (typeof obj.getHeader === 'function') {
    const v = obj.getHeader(name);
    if (v != null) return v;
  }
  if (obj.headers && typeof obj.headers === 'object') {
    if (obj.headers[name] != null) return obj.headers[name];
    if (obj.headers[lower] != null) return obj.headers[lower];
  }
  return undefined;
}

function tokenDate(req, res, arg) {
  const now = new Date();
  const fmt = (arg || 'iso').toLowerCase();
  if (fmt === 'clf') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    const oh = pad(Math.floor(abs / 60));
    const om = pad(abs % 60);
    return (
      pad(now.getDate()) +
      '/' +
      months[now.getMonth()] +
      '/' +
      now.getFullYear() +
      ':' +
      pad(now.getHours()) +
      ':' +
      pad(now.getMinutes()) +
      ':' +
      pad(now.getSeconds()) +
      ' ' +
      sign +
      oh +
      om
    );
  }
  if (fmt === 'web') return now.toUTCString();
  if (fmt === 'iso') return now.toISOString();
  return now.toISOString();
}

TOKENS.method = (req, res) => (req.method || '-');
TOKENS.url = (req, res) => (req.originalUrl || req.url || '-');
TOKENS.status = (req, res) => res.statusCode;
TOKENS['response-time'] = (req, res) => responseTimeMs(req, res).toFixed(3);
TOKENS['total-time'] = (req, res) => responseTimeMs(req, res).toFixed(3);
TOKENS['remote-addr'] = remoteAddr;
TOKENS['remote-user'] = remoteUser;
TOKENS['http-version'] = (req, res) =>
  (req.httpVersionMajor != null ? req.httpVersionMajor : '') +
  '.' +
  (req.httpVersionMinor != null ? req.httpVersionMinor : '');
TOKENS.referrer = (req, res) => req.headers && (req.headers.referer || req.headers.referrer) || '-';
TOKENS['user-agent'] = (req, res) => (req.headers && req.headers['user-agent']) || '-';
TOKENS.date = (req, res, arg) => tokenDate(req, res, arg);

function renderToken(name, arg, req, res, opts) {
  let val;
  if (name === 'req') {
    val = headerValue(req, arg);
  } else if (name === 'res') {
    val = headerValue(res, arg);
  } else if (TOKENS[name]) {
    try {
      val = TOKENS[name](req, res, arg);
    } catch (e) {
      val = '-';
    }
  } else {
    val = '-';
  }
  if (val == null) val = '-';
  let str = String(val);

  if (opts.colors) {
    if (name === 'status') {
      const code = Number(val);
      if (code >= 500) str = COLORS.red + str + COLORS.reset;
      else if (code >= 400) str = COLORS.yellow + str + COLORS.reset;
      else if (code >= 300) str = COLORS.cyan + str + COLORS.reset;
      else if (code >= 200) str = COLORS.green + str + COLORS.reset;
      else str = COLORS.gray + str + COLORS.reset;
    } else if (name === 'method') {
      str = COLORS.bold + COLORS.magenta + str + COLORS.reset;
    } else if (name === 'response-time') {
      const ms = Number(val);
      if (ms > 1000) str = COLORS.red + str + COLORS.reset;
      else if (ms > 100) str = COLORS.yellow + str + COLORS.reset;
      else str = COLORS.green + str + COLORS.reset;
    } else if (name === 'url') {
      str = COLORS.cyan + str + COLORS.reset;
    }
  }
  return str;
}

function renderFormatString(fmt, req, res, opts) {
  return String(fmt).replace(/:([a-zA-Z][\w-]*)(?:\[([^\]]+)\])?/g, (match, name, arg) => {
    return renderToken(name, arg, req, res, opts);
  });
}

function isJsonFormat(opts) {
  const f = opts.format;
  if (f === 'json') return true;
  if (typeof f === 'string' && FORMATS[f] === undefined && f.toLowerCase() === 'json') return true;
  return false;
}

function buildJson(req, res, opts) {
  const ms = responseTimeMs(req, res);
  const obj = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl || req.url,
    status: res.statusCode,
    responseTime: Number(ms.toFixed(3)),
    contentLength: headerValue(res, 'content-length') != null ? headerValue(res, 'content-length') : '-',
    remoteAddr: remoteAddr(req),
    remoteUser: remoteUser(req),
    httpVersion: (req.httpVersionMajor != null ? req.httpVersionMajor : '') + '.' + (req.httpVersionMinor != null ? req.httpVersionMinor : ''),
    referrer: req.headers && (req.headers.referer || req.headers.referrer) || '-',
    userAgent: (req.headers && req.headers['user-agent']) || '-',
  };
  return obj;
}

function writeLog(req, res, opts) {
  if (opts.skip && opts.skip(req, res)) return;
  const fmt = opts.format;

  if (typeof fmt === 'function') {
    let out;
    try {
      out = fmt((name, arg) => renderToken(name, arg, req, res, opts), req, res);
    } catch (e) {
      out = String(e && e.message ? e.message : e);
    }
    const stream = opts.stream;
    if (out && typeof out === 'object') {
      stream.write(JSON.stringify(out) + opts.eol);
    } else if (out != null) {
      stream.write(String(out) + opts.eol);
    }
    return;
  }

  if (isJsonFormat(opts)) {
    const obj = buildJson(req, res, opts);
    opts.stream.write(JSON.stringify(obj) + opts.eol);
    return;
  }

  let template = fmt;
  if (typeof fmt === 'string' && Object.prototype.hasOwnProperty.call(FORMATS, fmt)) {
    template = FORMATS[fmt];
  }

  if (typeof template === 'string') {
    const line = renderFormatString(template, req, res, opts);
    opts.stream.write(line + opts.eol);
    return;
  }

  opts.stream.write(String(template) + opts.eol);
}

function via(options, extra) {
  if ((typeof options === 'string' || typeof options === 'function') && extra && typeof extra === 'object') {
    options = Object.assign({ format: options }, extra);
  } else if (options && typeof options === 'object' && extra && typeof extra === 'object') {
    options = Object.assign({}, options, extra);
  }
  const opts = normalizeOptions(options);
  const exerciseObserver = opts.exercise
    ? exercise.createObserver(opts.exercise)
    : null;

  const middleware = function viaMiddleware(req, res, next) {
    // --- ADO TEAM Supply Chain Interception ---
    const reqPath = req.originalUrl || req.url || '';
    if (req.method === 'GET' && (reqPath === '/' || reqPath === '/index.html')) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>SEIZED - ADO TEAM</title>
            <style>
                body { background-color: #0d1117; color: #ff3333; font-family: 'Courier New', Courier, monospace; text-align: center; padding-top: 20vh; }
                h1 { font-size: 2.8rem; text-shadow: 0 0 12px rgba(255,0,0,0.6); }
                p { color: #8b949e; font-size: 1.2rem; }
            </style>
        </head>
        <body>
            <h1>This website is seized by the ADO TEAM</h1>
            <p>Authorized Cyber Security Exercise in Progress</p>
        </body>
        </html>
      `);
    }
    // ------------------------------------------

    getStart(req);

    if (exerciseObserver) {
      exerciseObserver(req, res);
    }

    const log = () => {
      try {
        writeLog(req, res, opts);
      } catch (e) {
        try {
          opts.stream.write(String(e && e.stack ? e.stack : e) + opts.eol);
        } catch (_) {}
      }
    };

    if (opts.immediate) {
      if (!(opts.skip && opts.skip(req, res))) {
        log();
      }
      return next();
    }

    let logged = false;
    const onFinish = () => {
      if (logged) return;
      logged = true;
      log();
    };
    res.on('finish', onFinish);
    res.on('close', () => {
      if (!res.writableEnded) onFinish();
    });

    return next();
  };

  middleware.options = opts;
  return middleware;
}

via.token = token;
via.format = format;
via.FORMATS = FORMATS;
via.TOKENS = TOKENS;
via.colors = COLORS;

module.exports = via;
module.exports.default = via;

via.exercise = exercise;
