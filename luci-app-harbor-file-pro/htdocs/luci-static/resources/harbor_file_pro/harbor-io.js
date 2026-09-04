
(function (global) {
	'use strict';

	var ENDPOINT = '/cgi-bin/harbor-io-pro';

	function sessionID() {
		if (global.rpc && typeof global.rpc.getSessionID === 'function')
			return global.rpc.getSessionID();
		if (global.L && global.L.env && global.L.env.sessionid)
			return global.L.env.sessionid;
		if (global.HarborFile && global.HarborFile.sessionid)
			return global.HarborFile.sessionid;
		return '';
	}

	function qs(params) {
		var out = [];
		for (var k in params)
			if (params[k] !== undefined && params[k] !== null)
				out.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
		return out.join('&');
	}

	var HarborIO = {

		download: function (path, filename) {
			var target = 'harbor_dl_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);

			var iframe = document.createElement('iframe');
			iframe.name = target;
			iframe.style.display = 'none';

			var form = document.createElement('form');
			form.method = 'POST';
			form.action = ENDPOINT;
			form.target = target;
			form.style.display = 'none';

			var fields = {
				mode: 'download',
				sessionid: sessionID(),
				path: path,
				filename: filename || path.split('/').pop()
			};

			for (var k in fields) {
				var input = document.createElement('input');
				input.type = 'hidden';
				input.name = k;
				input.value = fields[k];
				form.appendChild(input);
			}

			document.body.appendChild(iframe);
			document.body.appendChild(form);
			form.submit();

			setTimeout(function () {
				form.remove();
				iframe.remove();
			}, 60000);

			return true;
		},

		inlineURL: function (path, mimetype) {
			return ENDPOINT + '?' + qs({
				mode: 'inline',
				sessionid: sessionID(),
				path: path,
				mimetype: mimetype
			});
		},

		thumbnailURL: function (path, cachePath) {
			return ENDPOINT + '?' + qs({
				mode: 'thumbnail',
				sessionid: sessionID(),
				path: path,
				cache: cachePath
			});
		},

		slice: function (path, offset, length) {
			var url = ENDPOINT + '?' + qs({
				mode: 'slice',
				sessionid: sessionID(),
				path: path,
				offset: offset | 0,
				length: length | 0
			});

			return fetch(url, { credentials: 'same-origin' }).then(function (res) {
				if (!res.ok)
					return res.text().then(function (t) {
						throw new Error('slice failed: HTTP ' + res.status + (t ? ': ' + t.trim() : ''));
					});

				var total = parseInt(res.headers.get('X-Harbor-Total') || '0', 10);
				var off = parseInt(res.headers.get('X-Harbor-Offset') || '0', 10);

				return res.arrayBuffer().then(function (buf) {
					return { buffer: buf, offset: off, total: total };
				});
			});
		},

		patch: function (path, offset, bytes, expectedSize) {
			var url = ENDPOINT + '?' + qs({
				mode: 'patch',
				sessionid: sessionID(),
				path: path,
				offset: offset | 0,
				expected_size: expectedSize
			});

			return fetch(url, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: bytes
			}).then(function (res) {
				return res.json().then(function (j) {
					if (!res.ok || j.code !== 0)
						throw new Error(j.message || ('patch failed: HTTP ' + res.status));
					return j.data;
				});
			});
		},

		splice: function (path, start, end, bytes, expectedSize) {
			var url = ENDPOINT + '?' + qs({
				mode: 'splice',
				sessionid: sessionID(),
				path: path,
				start: start | 0,
				end: end | 0,
				expected_size: expectedSize
			});

			return fetch(url, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: bytes
			}).then(function (res) {
				return res.json().then(function (j) {
					if (!res.ok || j.code !== 0)
						throw new Error(j.message || ('splice failed: HTTP ' + res.status));
					return j.data;
				});
			});
		},

		search: function (path, needle, opts) {
			opts = opts || {};

			var url = ENDPOINT + '?' + qs({
				mode: 'search',
				sessionid: sessionID(),
				path: path,
				q: needle,
				encoding: opts.encoding || 'text',
				start: opts.start || 0,
				last: opts.last ? 1 : 0,
				before: opts.before,
				limit: opts.limit || 100,
				ignorecase: opts.ignoreCase ? 1 : 0
			});

			return fetch(url, { credentials: 'same-origin' }).then(function (res) {
				return res.json().then(function (j) {
					if (!res.ok || j.code !== 0)
						throw new Error(j.message || ('search failed: HTTP ' + res.status));
					return j.data;
				});
			});
		},

		replaceAll: function (path, needle, replacement, opts) {
			opts = opts || {};
			var q = {
				mode: 'replace_all',
				sessionid: sessionID(),
				path: path,
				q: needle,
				r: replacement,
				encoding: opts.encoding || 'text',
				rencoding: opts.encoding || 'text',
				ignorecase: opts.ignoreCase ? 1 : 0
			};
			if (opts.stageSrc) {
				q.stage = 1;
				q.src = opts.stageSrc;
			}
			var url = ENDPOINT + '?' + qs(q);

			return fetch(url, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: ''
			}).then(function (res) {
				return res.json().then(function (j) {
					if (!res.ok || j.code !== 0)
					throw new Error(j.message || ('replace_all failed: HTTP ' + res.status));
				return j.data;
				});
			});
		},

		stageCommit: function (path) {
			var url = ENDPOINT + '?' + qs({
				mode: 'stage_commit',
				sessionid: sessionID(),
				path: path
			});
			return fetch(url, { method: 'POST', credentials: 'same-origin',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' })
				.then(function (res) { return res.json(); })
				.then(function (j) {
					if (!j || j.code !== 0)
						throw new Error((j && j.message) || 'commit failed');
					return j;
				});
		},

		stageDiscard: function (path) {
			var url = ENDPOINT + '?' + qs({
				mode: 'stage_discard',
				sessionid: sessionID(),
				path: path
			});
			return fetch(url, { method: 'POST', credentials: 'same-origin',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' })
				.then(function (res) { return res.json(); })
				.then(function (j) { return j; });
		},

		replaceProgress: function (path) {
			var url = ENDPOINT + '?' + qs({
				mode: 'replace_progress',
				sessionid: sessionID(),
				path: path
			});
			return fetch(url, { credentials: 'same-origin' })
				.then(function (res) { return res.json(); })
				.then(function (j) {
					return (j && j.code === 0) ? j.data : { done: 0, total: 0 };
				});
		},

		readAll: function (path) {
			var url = ENDPOINT + '?' + qs({
				mode: 'inline',
				sessionid: sessionID(),
				path: path,
				mimetype: 'application/octet-stream'
			});

			return fetch(url, { credentials: 'same-origin' }).then(function (res) {
				if (!res.ok)
					return res.text().then(function (t) {
						throw new Error('read failed: HTTP ' + res.status + (t ? ': ' + t.trim() : ''));
					});
				return res.arrayBuffer();
			});
		}
	};

	global.HarborIO = HarborIO;
})(window);
