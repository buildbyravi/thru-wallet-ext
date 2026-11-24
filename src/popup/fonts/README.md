# Bundled UI fonts

The extension ships these static WOFF2 assets locally so popup rendering does not depend on
system-installed fonts or external font hosts:

- `inter-tight-latin-variable.woff2` — Latin subset from `@fontsource-variable/inter-tight` 5.3.0.
  Variable weight range: 100–900.
- `jetbrains-mono-latin-variable.woff2` — Latin subset from `@fontsource-variable/jetbrains-mono` 5.3.0.
  Variable weight range: 100–800.

Both upstream packages are licensed under the SIL Open Font License 1.1. The corresponding
license texts are included beside the font files. Non-Latin characters continue through the
system fallback stack.
