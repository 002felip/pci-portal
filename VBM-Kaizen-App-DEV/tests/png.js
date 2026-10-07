/* Gera um PNG RGB valido de verdade (o base64 escrito a mao nao decodificava). */
const zlib = require("zlib");
function crc32(buf) {
  let c, t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
}
function png(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  const linhas = [];
  for (let y = 0; y < h; y++) {
    const linha = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      linha[1 + x * 3] = (x * 255 / w) | 0;
      linha[2 + x * 3] = (y * 255 / h) | 0;
      linha[3 + x * 3] = 120;
    }
    linhas.push(linha);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    bloco("IHDR", ihdr),
    bloco("IDAT", zlib.deflateSync(Buffer.concat(linhas))),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}
module.exports = { png };
if (require.main === module) {
  const b = png(1920, 1080);
  require("fs").writeFileSync(__dirname + "/exemplo.png", b);
  console.log("PNG 1920x1080 gerado:", b.length, "bytes");
}
