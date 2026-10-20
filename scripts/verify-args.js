// Constructor args for `hardhat verify` of TapeCatSale, read from deployments/<network>.json.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const net = process.env.HARDHAT_NETWORK || "bsc";
const d = JSON.parse(readFileSync(join(__dirname, "..", "deployments", `${net}.json`), "utf8"));
module.exports = [d.config];
