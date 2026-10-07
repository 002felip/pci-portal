const Module = require("module"), path = require("path");
const fake = path.join(__dirname, "fake-mssql-sites.js");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === "mssql" ? fake : orig.call(this, r, ...a); };
