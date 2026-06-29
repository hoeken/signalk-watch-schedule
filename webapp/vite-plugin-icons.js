import { readFile } from "node:fs/promises";
import sharp from "sharp";

// Icon set generated from the single source logo at build time. One source of
// truth shared by the build (emits files), the HTML (injects <link>/<meta>
// tags), and the dev server (serves them on the fly).
//   - `rel` marks icons that also get a <link> in index.html.
//   - the 192/512 pair feeds the web app manifest (Android home-screen install).
//   - the maskable variant is padded so Android's icon mask can't clip the
//     wheel's handles; iOS uses apple-touch-icon (180) instead.
const ICONS = [
  { file: "favicon-16x16.png", size: 16, rel: "icon", type: "image/png" },
  { file: "favicon-32x32.png", size: 32, rel: "icon", type: "image/png" },
  { file: "favicon-48x48.png", size: 48, rel: "icon", type: "image/png" },
  { file: "apple-touch-icon.png", size: 180, rel: "apple-touch-icon" },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

const MANIFEST_FILE = "manifest.webmanifest";

// Web app manifest for "Add to Home screen". Paths are relative to the manifest
// URL (and start_url/scope to its directory), so it works under SignalK's
// webapp sub-path. theme/background match index.html's dark theme-color.
const MANIFEST = {
  name: "Watch Schedule",
  short_name: "Watch",
  description: "Crew watch schedule for offshore and overnight sailing.",
  start_url: ".",
  scope: ".",
  display: "standalone",
  background_color: "#0b1220",
  theme_color: "#0b1220",
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    {
      src: "icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};

// iOS doesn't read the manifest; these <meta> tags drive its home-screen app.
const APPLE_META = [
  { name: "mobile-web-app-capable", content: "yes" },
  { name: "apple-mobile-web-app-capable", content: "yes" },
  { name: "apple-mobile-web-app-status-bar-style", content: "default" },
  { name: "apple-mobile-web-app-title", content: "Watch Schedule" },
];

/**
 * Vite plugin: resize a source logo into favicons, PWA icons, and the SignalK
 * app icon, and wire up the manifest / home-screen tags.
 * @param {{ source: string }} opts path to the high-res source PNG.
 */
export default function icons({ source }) {
  // Read the multi-MB source once and reuse the buffer for every size.
  let sourcePromise;
  const readSource = () => {
    if (!sourcePromise)
      sourcePromise = readFile(source);
    return sourcePromise;
  };

  // Sample the logo's corner so the maskable icon's padding blends with its
  // background instead of showing a hard seam.
  let bgPromise;
  const background = () => {
    if (!bgPromise)
      bgPromise = readSource().then(async (buf) => {
        const px = await sharp(buf)
          .extract({ left: 0, top: 0, width: 64, height: 64 })
          .resize(1, 1)
          .raw()
          .toBuffer();
        return { r: px[0], g: px[1], b: px[2], alpha: 1 };
      });
    return bgPromise;
  };

  // Resize lazily and memoize per file, so the dev middleware doesn't re-encode
  // on every request and the build encodes each icon once.
  const cache = new Map();
  const build = async (icon) => {
    const buf = await readSource();
    if (!icon.maskable)
      return sharp(buf)
        .resize(icon.size, icon.size, { fit: "cover" })
        .png()
        .toBuffer();
    // Shrink into the ~80% safe zone and pad out to full size.
    const inner = Math.round(icon.size * 0.8);
    const pad = Math.round((icon.size - inner) / 2);
    return sharp(buf)
      .resize(inner, inner, { fit: "cover" })
      .extend({
        top: pad,
        bottom: pad,
        left: pad,
        right: pad,
        background: await background(),
      })
      .png()
      .toBuffer();
  };
  const render = (icon) => {
    if (!cache.has(icon.file))
      cache.set(icon.file, build(icon));
    return cache.get(icon.file);
  };

  return {
    name: "watch-schedule-icons",

    // Inject favicon / apple-touch links, the manifest link, and the iOS
    // home-screen meta tags. Relative hrefs resolve under SignalK's webapp
    // sub-path (matches vite's base: "./").
    transformIndexHtml() {
      const iconLinks = ICONS.filter((i) => i.rel).map((i) => ({
        tag: "link",
        attrs: {
          rel: i.rel,
          ...(i.type ? { type: i.type } : {}),
          sizes: `${i.size}x${i.size}`,
          href: `./${i.file}`,
        },
        injectTo: "head",
      }));
      const metaTags = APPLE_META.map((attrs) => ({
        tag: "meta",
        attrs,
        injectTo: "head",
      }));
      return [
        ...iconLinks,
        {
          tag: "link",
          attrs: { rel: "manifest", href: `./${MANIFEST_FILE}` },
          injectTo: "head",
        },
        ...metaTags,
      ];
    },

    // Emit the resized PNGs and the manifest into the build output (../public),
    // shipped via the package "files" list.
    async generateBundle() {
      for (const icon of ICONS) {
        this.emitFile({
          type: "asset",
          fileName: icon.file,
          source: await render(icon),
        });
      }
      this.emitFile({
        type: "asset",
        fileName: MANIFEST_FILE,
        source: JSON.stringify(MANIFEST, null, 2),
      });
    },

    // Serve the same icons and manifest during `vite dev` instead of 404ing.
    configureServer(server) {
      const byPath = new Map(ICONS.map((i) => [`/${i.file}`, i]));
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || "").split("?")[0];
        if (path === `/${MANIFEST_FILE}`) {
          res.setHeader("Content-Type", "application/manifest+json");
          res.end(JSON.stringify(MANIFEST, null, 2));
          return;
        }
        const icon = byPath.get(path);
        if (!icon)
          return next();
        res.setHeader("Content-Type", "image/png");
        res.end(await render(icon));
      });
    },
  };
}
