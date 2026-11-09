// Imported first by every compliance test: any non-loopback network use fails the test.
import net from 'node:net';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => {
  const u = new URL(String(url));
  if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) throw new Error(`network access blocked in tests: ${u.origin}`);
  return realFetch(url, ...rest);
};
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const opts = typeof args[0] === 'object' ? args[0] : {port: args[0], host: args[1]};
  const host = opts.host ?? 'localhost';
  if (!opts.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) throw new Error(`network access blocked in tests: ${host}`);
  return realConnect.apply(this, args);
};
