const sharp = require("sharp");
const path = require("path");

const svgPath = "/home/z/my-project/scripts/splash_logo.svg";
const outApp = "/home/z/my-project/download/agsi-android/app/src/main/res/drawable-nodpi/ic_splash_logo.png";
const outPreview = "/home/z/my-project/download/AGSI-splash-logo-login.png";

(async () => {
  const svg = require("fs").readFileSync(svgPath);
  // Render 960x960 (viewBox sudah berisi padding transparan)
  await sharp(svg, { density: 300 })
    .resize(960, 960)
    .png({ compressionLevel: 9 })
    .toFile(outApp);
  await sharp(svg, { density: 300 })
    .resize(480, 480)
    .flatten({ background: "#FFFFFF" }) // preview di atas putih seperti splash
    .png()
    .toFile(outPreview);

  for (const f of [outApp, outPreview]) {
    const meta = await sharp(f).metadata();
    const stats = await sharp(f).stats();
    console.log(path.basename(f), meta.width + "x" + meta.height, meta.format, "channels:", meta.channels);
  }
  console.log("DONE");
})().catch((e) => { console.error(e); process.exit(1); });
