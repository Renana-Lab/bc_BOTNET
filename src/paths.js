const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

module.exports = {
  ROOT_DIR,
  envPath: path.join(ROOT_DIR, '.env'),
  abisDir: path.join(ROOT_DIR, 'abis'),
  dataDir: path.join(ROOT_DIR, 'data'),
  logsDir: path.join(ROOT_DIR, 'logs'),
  publicDir: path.join(ROOT_DIR, 'public'),
  adminHtmlPath: path.join(ROOT_DIR, 'public', 'admin.html'),
};
