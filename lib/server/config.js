'use strict';
// Where things live. Everything can be changed with environment variables.
const os = require('os');
const path = require('path');

function loadConfig(env = process.env) {
  const dataDir = env.LIGHTS_DATA || path.join(os.homedir(), 'SanctuaryLights');
  return {
    port: Number(env.PORT) || 8080,
    host: env.HOST || '0.0.0.0',
    dataDir,
    showFile: path.join(dataDir, 'show.json'),
    runtimeFile: path.join(dataDir, 'runtime.json'),
    backupDir: path.join(dataDir, 'backups'),
    snapshotDir: path.join(dataDir, 'snapshots'),
    assetsDir: path.join(dataDir, 'assets'),
    logDir: path.join(dataDir, 'logs'),
    publicDir: path.join(__dirname, '..', '..', 'public'),
    embedded: !!env.SL_EMBEDDED,
    pcoBase: env.SL_PCO_BASE || undefined, // tests point this at a pretend Planning Center
    oflBase: env.SL_OFL_BASE || undefined, // tests point this at a pretend fixture library
    version: require('../../package.json').version,
  };
}

module.exports = { loadConfig };
