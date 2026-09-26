'use strict';

// CommonJS entry for API routes and lib jobs. lib/package.json is
// "type": "commonjs", so those files require() this. The implementation is
// player-td.mjs. Do not import this file from the Vite client.
module.exports = require('./player-td.mjs');
