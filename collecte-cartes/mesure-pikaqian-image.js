// Lecture locale : dimensions + conversion PNG pour regarder. Usage : node mesure-pikaqian-image.js <webp> <png>
'use strict';
const sharp = require('sharp');
(async () => {
  const [src, dst] = process.argv.slice(2);
  const m = await sharp(src).metadata();
  console.log(src, m.format, m.width + 'x' + m.height);
  await sharp(src).png().toFile(dst);
})();
