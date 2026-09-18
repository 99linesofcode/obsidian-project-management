import esbuild from 'esbuild';

// Obsidian loads plugins as CommonJS; the plugin class is the default export.
// `obsidian` is provided by the host at runtime, so it stays external.
const watch = process.argv.includes('--watch');
const production = !watch;

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2018',
  outfile: 'main.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
