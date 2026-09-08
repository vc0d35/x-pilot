# Fonts

XPilot uses Berkeley Mono (https://berkeleygraphics.com), a licensed font that is
not committed to this repository. Copy your licensed files here; the CSS looks for:

- BerkeleyMono-Regular.woff2   (or .otf)
- BerkeleyMono-Bold.woff2      (or .otf)
- BerkeleyMono-Italic.woff2    (or .otf)
- BerkeleyMono-BoldItalic.woff2 (or .otf)

If you have the variable version instead, name it BerkeleyMonoVariable.woff2 (or .ttf);
it is used for every weight. Files here are bundled into the app by the build
(`npm run build` / `npm run dist`) and served by the dev server. Without them the UI
falls back to the system monospace font.
