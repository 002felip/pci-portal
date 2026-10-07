const Module = require("module"), path = require("path"), fs = require("fs");
const fake = path.join(__dirname, "fake-mssql.js");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === "mssql" ? fake : orig.call(this, r, ...a); };
const m = require(fake);
const proto = m.Request ? m.Request.prototype : (m.ConnectionPool && m.ConnectionPool.prototype);
if (proto && proto.query) {
  const antes = proto.query;
  proto.query = function (q) {
    try { fs.appendFileSync(path.join(__dirname, "sql-capturado.txt"), "\n/*=== QUERY ===*/\n" + q + "\n"); } catch (e) {}
    return antes.apply(this, arguments);
  };
}
