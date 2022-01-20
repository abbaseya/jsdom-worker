import mitt from 'mitt';
import uuid from 'uuid-v4';
import fetch, { Response } from 'cross-fetch';
import fs from 'fs';
const vm = require('vm');// vm must be in the global context to work properly

if (!global.URL) global.URL = {};
if (!global.URL.$$objects) {
	global.URL.$$objects = new Map();
	global.URL.createObjectURL = blob => {
		let id = uuid();
		global.URL.$$objects[id] = blob;
		return `blob:http://localhost/${id}`;
	};
}

if (!global.fetch || !global.fetch.jsdomWorker) {
	let oldFetch = global.fetch || fetch;
	global.fetch = function(url, opts) {
		if (url.match(/^blob:/)) {
			return new Promise( (resolve, reject) => {
				let fr = new global.FileReader();
				fr.onload = () => {
					let Res = global.Response || Response;
					resolve(new Res(fr.result, { status: 200, statusText: 'OK' }));
				};
				fr.onerror = () => {
					reject(fr.error);
				};
				let id = url.match(/[^/]+$/)[0];
				fr.readAsText(global.URL.$$objects[id]);
			});
		}
		return oldFetch.call(this, url, opts);
	};
	global.fetch.jsdomWorker = true;
}

if (!global.document) {
	global.document = {};
}

function Event(type) { this.type = type; }
Event.prototype.initEvent = Object;
if (!global.document.createEvent) {
	global.document.createEvent = function(type) {
		let Ctor = global[type] || Event;
		return new Ctor(type);
	};
}


global.Worker = function Worker(url) {
	let getScopeVar;
	let messageQueue = [];
	let inside = mitt();
	let outside = mitt();
	let scope = {
		onmessage: null,
		dispatchEvent: inside.emit,
		addEventListener: inside.on,
		removeEventListener: inside.off,
		postMessage(data) {
			outside.emit('message', { data });
		},
		fetch: global.fetch,
		importScripts(filename) {
			console.log('importScript:', filename);
			if (filename.startWith('http')) {
				global.fetch(filename)
					.then(r => r.text())
					.then(code => {
						console.log(code.slice(-100));
						vm.runInThisContext(code);
					})
					.catch(e => {
						outside.emit('error', e);
						console.error(e);
					});
			}
			else {
				const code = fs.readFileSync(filename, 'utf-8');
				console.log(code.slice(-100));
				vm.runInThisContext(code);
			}
		}
	};
	inside.on('message', e => {
		let f = scope.onmessage || getScopeVar('onmessage');
		console.log('inside worker message', f);
		console.log(e);
		if (f) f.call(scope, e);
	});
	this.addEventListener = outside.on;
	this.removeEventListener = outside.off;
	this.dispatchEvent = outside.emit;
	outside.on('message', e => {
		console.log('outside worker message');
		if (this.onmessage) this.onmessage(e);
	});
	this.postMessage = data => {
		if (messageQueue!=null) messageQueue.push(data);
		else inside.emit('message', { data });
	};
	this.terminate = () => {
		throw Error('Not Supported');
	};
	global.fetch(url)
		.then(r => r.text())
		.then(code => {
			const clean = code.replace(/[\n\r\s\t]+/g, ' ');
			console.log('fetch code:', code);
			console.log('fetch code cleaned:', clean);
			let vars = 'var self=this,global=self';
			for (let k in scope) vars += `,${k}=self.${k}`;
			console.log(vars + ';\n' + clean + '\nreturn function(n){console.log("onmessage:",n,onmessage,typeof onmessage);return n=="onmessage"?onmessage:null;}');
			getScopeVar = Function(
				vars + ';\n' + clean + '\nreturn function(n){console.log("onmessage:",n,onmessage,typeof onmessage);return n=="onmessage"?onmessage:null;}'
			).call(scope);
			let q = messageQueue;
			messageQueue = null;
			q.forEach(this.postMessage);
		})
		.catch(e => {
			outside.emit('error', e);
			console.error(e);
		});
};
