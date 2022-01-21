import mitt from 'mitt';
import uuid from 'uuid-v4';
import fetch, { Response } from 'node-fetch'; // stick to version ^2.6.0 here and at the peerDependency (i.e. coyote repo) - to avoid jest issues
import fs from 'fs';
import request from 'sync-request';
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
		importScripts(...scripts) {
			let combined = [];
			for (const script of scripts) {
				console.log('importScript:', script);
				let code = '';
				if (script.indexOf('http') === 0) {
					try {
						code = request('GET', script).getBody();
					}
					catch (e) {
						outside.emit('error', e);
						console.error(e);
					}
				}
				else {
					code = fs.readFileSync(script, 'utf-8');
				}
				// console.log(code.slice(0, 100), '...', code.slice(-100));
				// const script = vm.createScript(code);
				// script.runInThisContext();
				combined.push(code);
			}
			// TODO: this should run in worker context and not the global!
			vm.runInThisContext(combined.join('\n'));
			// vm.runInThisContext('var RecorderWorker = {handleAction: function(e) {console.log("mock RecorderWorker.handleAction:", e);}};console.log(this);');
			// vm.runInThisContext('console.log(this);'+combined.join('\n'));
			// eval(combined.join('\n'));
			// return eval.call(scope, combined.join('\n'));
			// return Function('return (' + combined.join('\n') + ')').bind(scope)();
			// return combined.join('\n');
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
	global.fetch(url, { insecureHTTPParser: true })
		.then(r => r.text())
		.then(code => {
			// const clean = code.replace(/[\n\r\s\t]+/g, ' ');
			// let vars = 'var self=this,global=self';
			// for (let k in scope) vars += `,${k}=self.${k}`;
			// getScopeVar = Function(
			// 	vars + ';\n' + clean + '\nreturn function(n){return n=="onmessage"?onmessage:null;}'
			// ).call(scope);

// TODO: defined string works, but received response does not work! despite the fact that the resposne headers are set to text.plain;charset=UTF-8
			code = `console.log(self);
importScripts("https://localhost.localstack.cloud/figpii-statics/recorder-worker.min.js");
onmessage = e => {
	console.log('imported worker message');
	RecorderWorker.handleAction(e);
}`;
			let vars = 'var self=this,global=self';
			for (let k in scope) vars += `,${k}=self.${k}`;
			let logic = `${vars};
${code}
return function(n){return n=="onmessage"?onmessage:null;}`;
			// logic = logic.replace(/^(importScripts.*);$/gm, 'eval($1);');
			console.log('logic:', logic.slice(0, 400), '...', logic.slice(-100));
			getScopeVar = Function(logic).call(scope);
			console.log('getScopeVar:', getScopeVar('onmessage'));
			let q = messageQueue;
			messageQueue = null;
			q.forEach(this.postMessage);
		})
		.catch(e => {
			outside.emit('error', e);
			console.error(e);
		});
};
