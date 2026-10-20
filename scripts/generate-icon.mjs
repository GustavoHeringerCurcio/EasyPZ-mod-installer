import sharp from 'sharp'

await sharp('apps/desktop/build/icon.svg')
  .resize(512, 512)
  .png()
  .toFile('apps/desktop/build/icon.png')

console.log('Wrote apps/desktop/build/icon.png')
