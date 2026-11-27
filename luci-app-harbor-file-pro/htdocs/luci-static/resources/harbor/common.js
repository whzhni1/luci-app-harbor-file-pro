// Harbor File Pro shared LuCI helpers
// rpc declarations, formatting, icons, theme and small UI builders used by all views
'use strict';
'require rpc';
'require uci';

const ASSET_VERSION = '2.0.0-r23';
const THEME_KEY = 'harbor-theme';

var callJobStatus          = rpc.declare({ object: 'luci.harbor-file-pro', method: 'job_status', params: ['id'] });
var callStatus             = rpc.declare({ object: 'luci.harbor-file-pro', method: 'status', params: [] });
var callLogs               = rpc.declare({ object: 'luci.harbor-file-pro', method: 'logs', params: ['lines'] });
var callClearLogs          = rpc.declare({ object: 'luci.harbor-file-pro', method: 'clear_logs', params: [] });
var callAction             = rpc.declare({ object: 'luci.harbor-file-pro', method: 'action', params: ['action'] });
var callInitAccountStatus  = rpc.declare({ object: 'luci.harbor-file-pro', method: 'init_account_status', params: [] });
var callInitAccount        = rpc.declare({ object: 'luci.harbor-file-pro', method: 'init_account', params: ['username', 'password'] });
var callMigrateConfig      = rpc.declare({ object: 'luci.harbor-file-pro', method: 'migrate_config', params: ['from', 'to'] });
var callGetPaths           = rpc.declare({ object: 'luci.harbor-file-pro', method: 'get_paths', params: [] });
var callPrintConfig        = rpc.declare({ object: 'luci.harbor-file-pro', method: 'print_config', params: [] });
var callGetTheme           = rpc.declare({ object: 'luci.harbor-file-pro', method: 'get_theme', params: [] });
var callSetTheme           = rpc.declare({ object: 'luci.harbor-file-pro', method: 'set_theme', params: ['theme'] });
var callGetUpstreamVersion = rpc.declare({ object: 'luci.harbor-file-pro', method: 'get_upstream_version', params: ['project', 'mirror', 'force'] });
var callDoUpdate           = rpc.declare({ object: 'luci.harbor-file-pro', method: 'do_update', params: ['project', 'tag', 'filename'] });
var callGetUpdateStatus    = rpc.declare({ object: 'luci.harbor-file-pro', method: 'get_update_status', params: ['project', 'task_id'] });

function asyncRpc(call) {
    return function() {
        var args = arguments;
        return call.apply(null, args).then(function(reply) {
            if (!reply || !reply.job_id) return reply;
            var id = reply.job_id;
            var start = Date.now();
            return new Promise(function(resolve, reject) {
                function next() {
                    if (Date.now() - start > 180000) {
                        reject(new Error('Background task timed out; outcome is unknown'));
                        return;
                    }
                    callJobStatus(id).then(function(r) {
                        if (!r || !r.ok) { reject(new Error('Background task unavailable')); return; }
                        if (r.pending) { setTimeout(next, 3000); return; }
                        resolve(r.result);
                    }).catch(function() { setTimeout(next, 3000); });
                }
                next();
            });
        });
    };
}

var asyncGetUpdateStatus = asyncRpc(callGetUpdateStatus);

var HarborRpc = {
    status: asyncRpc(callStatus),
    logs: asyncRpc(callLogs),
    clearLogs: asyncRpc(callClearLogs),
    action: asyncRpc(callAction),
    initAccount: callInitAccount,
    initAccountStatus: callInitAccountStatus,
    migrateConfig: asyncRpc(callMigrateConfig),
    getPaths: asyncRpc(callGetPaths),
    printConfig: asyncRpc(callPrintConfig),
    getTheme: callGetTheme,
    setTheme: callSetTheme,
    getUpstreamVersion: asyncRpc(callGetUpstreamVersion),
    doUpdate: asyncRpc(callDoUpdate),
    getUpdateStatus: function(project, taskId) { return asyncGetUpdateStatus(project, taskId || ''); }
};

var HarborFormat = {
    version: function(s) {
        var m = String(s || '').match(/[0-9]+\.[0-9]+\.[0-9]+/);
        return m ? m[0] : '';
    },

    isNewer: function(latest, current) {
        var a = String(latest || '').split('.'), b = String(current || '').split('.');
        for (var i = 0; i < 3; i++) {
            var x = parseInt(a[i]) || 0, y = parseInt(b[i]) || 0;
            if (x !== y) return x > y;
        }
        return false;
    },

    uptime: function(s) {
        s = parseInt(s) || 0;
        if (s <= 0) return '-';
        var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600),
            m = Math.floor(s % 3600 / 60), sec = s % 60;
        function p(n) { return (n < 10 ? '0' : '') + n; }
        /* %(days)s/%(clock)s glue is locale-controlled (zh: "3天02:15:40"). */
        return _('%(days)sd %(clock)s')
            .replace('%(days)s', d)
            .replace('%(clock)s', p(h) + ':' + p(m) + ':' + p(sec));
    },

    joinUrl: function(host, port) {
        var h = host || window.location.hostname || '127.0.0.1';
        return 'http://' + h + ':' + (parseInt(port) || 9700) + '/';
    }
};

var ICON_PATHS = {
    start: 'M8 5v14l11-7z',
    stop: 'M6 6h12v12H6z',
    restart: 'M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.76-4.24L13 11h8V3z',
    open: 'M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42L17.59 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z',
    refresh: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08a6 6 0 1 1-1.41-6.24L13 11h7V4z',
    download: 'M5 20h14v-2H5v2zM12 3v10.17l3.59-3.58L17 11l-5 5-5-5 1.41-1.41L11 13.17V3h1z',
    trash: 'M9 3h6l1 2h4v2H4V5h4l1-2zM6.5 9h11l-.66 9.7A2.2 2.2 0 0 1 14.64 21H9.36a2.2 2.2 0 0 1-2.2-2.3L6.5 9z',
    sun: 'M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.8 1.42-1.42zM1 13h3v-2H1v2zm10-12v3h2V1h-2zm9.45 3.46l-1.41-1.41-1.8 1.79 1.42 1.42 1.79-1.8zM17.24 19.16l1.8 1.79 1.41-1.41-1.79-1.8-1.42 1.42zM20 11v2h3v-2h-3zM12 6a6 6 0 1 0 0 12A6 6 0 0 0 12 6zm-1 17h2v-3h-2v3zm-7.45-3.46l1.41 1.41 1.8-1.79-1.42-1.42-1.79 1.8z',
    moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
    auto: 'M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.8 1.42-1.42zM1 13h3v-2H1v2zm10-12v3h2V1h-2zm9.45 3.46l-1.41-1.41-1.8 1.79 1.42 1.42 1.79-1.8zM17.24 19.16l1.8 1.79 1.41-1.41-1.79-1.8-1.42 1.42zM20 11v2h3v-2h-3zM11 23h2v-3h-2v3zm-7.45-3.46l1.41 1.41 1.8-1.79-1.42-1.42-1.79 1.8zM12 6A6 6 0 0 0 12 18Z M12 6A6 6 0 0 1 12 18V16.2A4.2 4.2 0 0 0 12 7.8Z'
};

function harborIcon(name) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'harbor-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.open);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
}

function harborThemeIcon(mode) {
    return harborIcon(mode === 'auto' ? 'auto' : mode === 'dark' ? 'moon' : 'sun');
}

var HarborUI = {
    icon: harborIcon,

    pill: function(text, cls) {
        return E('span', { 'class': 'harbor-pill ' + (cls || 'off') }, text);
    },

    setPill: function(el, text, cls) {
        if (!el) return;
        el.className = 'harbor-pill ' + (cls || 'off');
        el.textContent = text;
    },

    note: function(el, type, text) {
        if (!el) return;
        el.textContent = text || '';
        el.style.color = type === 'err' ? 'var(--harbor-danger)' :
            type === 'warn' ? 'var(--harbor-warn)' :
            type === 'ok' ? 'var(--harbor-success)' : 'var(--harbor-muted)';
    },

    iconButton: function(icon, label, onClick, disabled) {
        var btn = E('button', {
            'class': 'btn harbor-btn harbor-btn-primary',
            'click': onClick
        }, [ harborIcon(icon), E('span', {}, label) ]);
        if (disabled) btn.disabled = true;
        return btn;
    },

    /* Icon-only action button: ghost style, tooltip, aria-label, micro
       animations via opts { tone: 'green'|'blue'|'red', anim: 'play'|'stop'|'rotate'|'wiggle' }. */
    iconActionButton: function(icon, label, onClick, opts) {
        opts = opts || {};
        var btn = E('button', {
            'class': 'harbor-ib' +
                (opts.tone ? ' harbor-t-' + opts.tone : '') +
                (opts.anim ? ' harbor-anim-' + opts.anim : ''),
            'type': 'button',
            'title': label,
            'aria-label': label,
            'data-tip': label,
            'click': onClick
        }, [ E('span', { 'class': 'harbor-ripple-layer' }), harborIcon(icon), harborSpinner() ]);
        if (opts.disabled) btn.disabled = true;
        return btn;
    },

    setBusy: function(btn, busy) {
        if (!btn) return;
        btn.classList.toggle('is-busy', !!busy);
        btn.disabled = !!busy;
    },

    progress: function() {
        var fill = E('i', {});
        var bar = E('div', { 'class': 'harbor-progress' }, fill);
        bar._fill = fill;
        return bar;
    },

    setProgress: function(bar, pct) {
        if (bar && bar._fill)
            bar._fill.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
    },

    card: function(title, children) {
        return E('div', { 'class': 'cbi-section harbor-card' }, [
            title ? E('h3', {}, title) : E('span', {}),
            E('div', {}, children)
        ]);
    },

    /* form.js labels use for="widget.cbid.…" but widgets only carry
       data-widget-id (never id), so audits flag "label for mismatch" on
       every LuCI form page. Give those widgets the matching id, and wire
       up our own bare labels too. */
    fixLabelTargets: function(root) {
        if (!root || !root.querySelectorAll) return;
        var i, j;
        var labels = root.querySelectorAll('label[for]');
        for (i = 0; i < labels.length; i++) {
            var lb = labels[i];
            var want = lb.getAttribute('for');
            if (!want || document.getElementById(want)) continue;
            var scope = lb.parentElement || root;
            var el = null;
            try { el = scope.querySelector('[data-widget-id="' + want + '"]'); } catch (e) {}
            if (el && !el.id) { el.id = want; continue; }
            var cands = lb.nextElementSibling ?
                lb.nextElementSibling.querySelectorAll('input, select, textarea, output, button') : [];
            for (j = 0; j < cands.length; j++) {
                if (!cands[j].id) { cands[j].id = want; break; }
            }
        }
        var bare = root.querySelectorAll('label.cbi-value-title:not([for])');
        for (i = 0; i < bare.length; i++) {
            var l2 = bare[i];
            var field = l2.nextElementSibling;
            if (!field) continue;
            var input = field.querySelector('input, select, textarea');
            if (!input) continue;
            if (!input.id) input.id = 'harbor-field-' + (++labelSeq);
            l2.setAttribute('for', input.id);
        }
    },

    themeButton: function() {
        var mode = currentThemeMode();
        var label = themeLabel(mode);
        var btn = E('button', {
            'class': 'harbor-ib harbor-anim-rotate',
            'type': 'button',
            'title': label,
            'aria-label': label,
            'data-tip': label,
            'click': function(ev) {
                ev.preventDefault();
                cycleTheme();
            }
        }, [ E('span', { 'class': 'harbor-ripple-layer' }),
             harborThemeIcon(mode),
             harborSpinner() ]);
        btn.id = 'harbor-theme-toggle';
        return btn;
    }
};

var labelSeq = 0;

function harborSpinner() {
    var ns = 'http://www.w3.org/2000/svg';
    var wrap = document.createElement('span');
    wrap.className = 'harbor-spin';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.6');
    svg.setAttribute('stroke-linecap', 'round');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M12 3a9 9 0 1 0 9 9');
    svg.appendChild(path);
    wrap.appendChild(svg);
    return wrap;
}

function bindHarborRipples() {
    if (typeof document === 'undefined' || document.__harborRipplesBound) return;
    document.__harborRipplesBound = true;
    document.addEventListener('click', function(ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('button.harbor-ib') : null;
        if (!btn) return;
        var r = btn.getBoundingClientRect();
        var d = Math.max(r.width, r.height);
        var s = document.createElement('span');
        s.className = 'harbor-ripple';
        s.style.width = s.style.height = d + 'px';
        s.style.left = (((ev.clientX != null) ? ev.clientX : r.left + r.width / 2) - r.left - d / 2) + 'px';
        s.style.top = (((ev.clientY != null) ? ev.clientY : r.top + r.height / 2) - r.top - d / 2) + 'px';
        (btn.querySelector('.harbor-ripple-layer') || btn).appendChild(s);
        setTimeout(function() { if (s.parentNode) s.parentNode.removeChild(s); }, 600);
    });
}

function savedTheme() {
    var v = '';
    try { v = window.localStorage.getItem(THEME_KEY) || ''; } catch (e) {}
    return (v === 'light' || v === 'dark') ? v : 'auto';
}

function currentThemeMode() {
    return savedTheme();
}

function themeLabel(mode) {
    return mode === 'dark' ? _('Dark') :
        mode === 'light' ? _('Light') : _('Auto');
}

function resolveTheme(mode) {
    if (mode === 'dark' || mode === 'light') return mode;
    /* Follow the host theme (luci-theme-argon exposes data-argon-mode on the
       html element) before the browser preference so Auto never clashes. */
    var host = document.documentElement.getAttribute('data-argon-mode');
    if (host === 'dark' || host === 'light') return host;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

function applyTheme(mode) {
    document.documentElement.setAttribute('data-harbor-theme', resolveTheme(mode));
    var btn = document.getElementById('harbor-theme-toggle');
    if (btn) {
        var label = themeLabel(mode);
        btn.innerHTML = '';
        btn.appendChild(E('span', { 'class': 'harbor-ripple-layer' }));
        btn.appendChild(harborThemeIcon(mode));
        btn.appendChild(harborSpinner());
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('data-tip', label);
    }
}

function cycleTheme() {
    var cur = savedTheme();
    var next = cur === 'auto' ? 'dark' : (cur === 'dark' ? 'light' : 'auto');
    try { window.localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
    callSetTheme(next).catch(function() {});
}

(function() {
    if (typeof document === 'undefined') return;
    bindHarborRipples();
    applyTheme(savedTheme());
    if (window.matchMedia) {
        var media = window.matchMedia('(prefers-color-scheme: dark)');
        var onChange = function() { if (savedTheme() === 'auto') applyTheme('auto'); };
        if (media.addEventListener) media.addEventListener('change', onChange);
    }
    if (window.MutationObserver) {
        new MutationObserver(function() {
            if (savedTheme() === 'auto') applyTheme('auto');
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-argon-mode'] });
    }
    if (!document.getElementById('harbor-global-style')) {
        var link = document.createElement('link');
        link.id = 'harbor-global-style';
        link.rel = 'stylesheet';
        link.href = ((typeof L !== 'undefined' && L.resource)
            ? L.resource('harbor/style.css')
            : '/luci-static/resources/harbor/style.css') + '?v=' + ASSET_VERSION;
        document.head.appendChild(link);
    }
    callGetTheme().then(function(r) {
        var t = (r && (r.theme === 'dark' || r.theme === 'light')) ? r.theme : 'auto';
        try { window.localStorage.setItem(THEME_KEY, t); } catch (e) {}
        applyTheme(t);
    }).catch(function() {});
})();

return L.Class.extend({
    HarborRpc: HarborRpc,
    HarborFormat: HarborFormat,
    HarborUI: HarborUI
});
