const { build, analyzeMetafile } = require('esbuild');
const environment = process.env.NODE_ENV || 'development';

build({
	entryPoints: [
		'./src/index.js'
	],
	entryNames: 'jsdom-worker',
	outbase: 'src',
	outdir: 'dist',
	bundle: true,
	metafile: true,
	logLevel: environment == 'production' ? 'silent' : 'verbose',
	logLimit: 0,
	legalComments: environment == 'production' ? 'none' : 'inline',
	drop: environment == 'production' ? ['debugger', 'console'] : [],
	minify: environment == 'production',
	platform: process.env.ESBUILD_PLATFORM || 'node',
	format: process.env.ESBUILD_FORMAT || 'cjs',
	sourcemap: environment == 'production',
	target: process.env.ESBUILD_TARGET || 'node14',
	inject: process.env.ESBUILD_INJECT ? process.env.ESBUILD_INJECT.split(',') : [],
	external: process.env.ESBUILD_EXTERNAL ? process.env.ESBUILD_EXTERNAL.split(',') : [],
	mainFields: process.env.ESBUILD_MAIN_FIELDS ? process.env.ESBUILD_MAIN_FIELDS.split(',') : [ 'browser', 'main', 'module' ]
}).then(result => {
	analyzeMetafile(result.metafile).then(meta => process.stdout.write(meta));
}).catch(() => process.exit(1));
