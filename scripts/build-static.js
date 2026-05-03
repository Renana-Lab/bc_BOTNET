const fs = require('fs');
const path = require('path');

const sourceDir = path.resolve(__dirname, '..', 'public');
const outputDir = path.resolve(__dirname, '..', 'dist');

function copyDirectory(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Source directory does not exist: ${src}`);
  }
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

try {
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  copyDirectory(sourceDir, outputDir);
  console.log(`Built static assets to ${outputDir}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
