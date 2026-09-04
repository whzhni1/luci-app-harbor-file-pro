
(function (HF) {
    'use strict';

    var KEY_BUF = 'harbor_file_pro.recovery.';

    function storage() {
        try {
            return window.localStorage;
        } catch (error) {
            return null;
        }
    }

    function get(key) {
        var store = storage();
        if (!store) { return null; }
        try {
            var raw = store.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    }

    function set(key, value) {
        var store = storage();
        if (!store) { return; }
        try {
            store.setItem(key, JSON.stringify(value));
        } catch (error) {
        }
    }

    function remove(key) {
        var store = storage();
        if (!store) { return; }
        try {
            store.removeItem(key);
        } catch (error) {
        }
    }

    function bytesToBase64(bytes) {
        var binary = '';
        var chunk = 0x8000;
        for (var i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
        }
        return btoa(binary);
    }

    function base64ToBytes(b64) {
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    var pending = {};
    var timers = {};

    function flushKey(key) {
        if (timers[key]) {
            clearTimeout(timers[key]);
            delete timers[key];
        }
        if (pending[key] !== undefined) {
            set(key, pending[key]);
            delete pending[key];
        }
    }

    function flushAll() {
        for (var key in pending) {
            if (Object.prototype.hasOwnProperty.call(pending, key)) {
                set(key, pending[key]);
            }
        }
        pending = {};
    }

    window.addEventListener('pagehide', flushAll);
    window.addEventListener('beforeunload', flushAll);

    HF.Recovery = {
        bytesToBase64: bytesToBase64,
        base64ToBytes: base64ToBytes,

        bufferKey: function (path) {
            return KEY_BUF + String(path || '');
        },
        saveBuffer: function (kind, path, payload) {
            var key = this.bufferKey(path);
            var record = {
                kind: kind,
                path: path,
                payload: payload || {},
                at: Date.now()
            };
            if (timers[key]) {
                clearTimeout(timers[key]);
            }
            pending[key] = record;
            timers[key] = setTimeout(function () {
                flushKey(key);
            }, 300);
        },
        flushBuffer: function (path) {
            flushKey(this.bufferKey(path));
        },
        hasBuffer: function (path) {
            var record = get(this.bufferKey(path)) || pending[this.bufferKey(path)];
            return record && record.kind ? record.kind : null;
        },
        getBuffer: function (path) {
            var key = this.bufferKey(path);
            var record = get(key) || pending[key];
            return record || null;
        },
        clearBuffer: function (path) {
            var key = this.bufferKey(path);
            if (timers[key]) {
                clearTimeout(timers[key]);
                delete timers[key];
            }
            delete pending[key];
            remove(key);
        },

    };
})(window.HarborFile = window.HarborFile || {});
