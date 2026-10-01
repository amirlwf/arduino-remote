/**
 * سرور اکوی WebSocket بدون وابستگی — RFC6455 حداقلی برای تست واقعی انتقال سوکت.
 * هم به‌صورت ماژول (startEchoServer) هم مستقیم:  node tests/ws-echo.mjs 8099
 */
import http from "node:http";
import crypto from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function parseFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  let mask = null;
  if (masked) {
    if (buf.length < off + 4) return null;
    mask = buf.subarray(off, off + 4);
    off += 4;
  }
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return { opcode, payload, rest: buf.subarray(off + len) };
}

function encodeFrame(payload, opcode) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

export function startEchoServer(port = 0) {
  const server = http.createServer((_req, res) => {
    res.writeHead(426, { "content-type": "text/plain" });
    res.end("websocket only");
  });
  const sockets = new Set();

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    sockets.add(socket);

    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const frame = parseFrame(buf);
        if (!frame) break;
        buf = frame.rest;
        if (frame.opcode === 0x8) {
          socket.end(encodeFrame(Buffer.alloc(0), 0x8));
          break;
        }
        if (frame.opcode === 0x1) socket.write(encodeFrame(frame.payload, 0x1)); // اکو
        if (frame.opcode === 0x9) socket.write(encodeFrame(frame.payload, 0xa)); // ping → pong
      }
    });
    const drop = () => sockets.delete(socket);
    socket.on("close", drop);
    socket.on("error", drop);
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: actual,
        url: `ws://127.0.0.1:${actual}`,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy();
            sockets.clear();
            server.close(() => r());
          }),
      });
    });
  });
}

// اجرای مستقیم: سرور دائمی برای تست دستی/مرورگر
if (process.argv[1] && /ws-echo\.mjs$/.test(process.argv[1])) {
  const p = Number(process.argv[2] || 8099);
  startEchoServer(p).then((s) => console.log(`ECHO_URL=${s.url}`));
}
