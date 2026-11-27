// Harbor File Pro settings view
// tabbed form over the active UCI config plus update and diagnostics cards
'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require harbor.common as harbor';

var Rpc = null, Fmt = null, UI = null;

function t(s) { return _(s); }

function absPath(value) {
    if (typeof value !== 'string' || !/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]*$/.test(value))
        return t('Must be an absolute path');
    return true;
}

return view.extend({
    load: function() {
        Rpc = harbor.HarborRpc; Fmt = harbor.HarborFormat; UI = harbor.HarborUI;
        return null;
    },

    render: function() {
        var self = this;
        self.map = null;
        self._ready = false;
        self._detected = '';
        self._archOption = null;
        self._policyCapable = false;
        self._policyOption = null;
        var content = E('div', {}, [ UI.card(t('Loading…'), []) ]);
        var page = E('div', { 'class': 'harbor-settings' }, [
            E('div', { 'class': 'harbor-head' }, [
                E('div', {}, [ E('h2', {}, t('Harbor File Pro Settings')) ]),
                E('div', { 'class': 'harbor-head-actions' }, [ UI.themeButton() ])
            ]),
            content
        ]);
        Rpc.status().then(function(status) {
            var info = status && status.service_info;
            self._policyCapable = !!(info && Object.prototype.hasOwnProperty.call(info, 'root_policy_cli_override'));
            if (self._policyOption) self._policyOption.triggerValidation('main');
        }).catch(function() {});
        Rpc.getPaths().then(function(paths) {
            self._detected = paths && (paths.detected_target || paths.detected_arch) || '';
            if (self._archOption && self._detected) {
                self._archOption.description = t('auto = automatic detection, or specify manually e.g. armv7 musleabihf.') + ' ' + t('Detected:') + ' ' + self._detected;
                var desc = content.querySelector('[data-name="arch"] .cbi-value-description');
                if (desc) desc.textContent = self._archOption.description;
            }
        }).catch(function() {});
        uci.load('harbor_file_pro').then(function() {
            var pointer = uci.get('harbor_file_pro', 'main', 'config_file') || '';
            if (pointer && (!/^\/etc\/config\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pointer) || pointer.indexOf('..') >= 0))
                throw new Error('invalid_config_path');
            var cfgName = pointer ? pointer.slice(12) : 'harbor_file_pro';
            var cfgFile = pointer || '/etc/config/harbor_file_pro';
            return (cfgName === 'harbor_file_pro' ? Promise.resolve() : uci.load(cfgName)).then(function() {
                return self._renderSettings({ cfg_name: cfgName, cfg_file: cfgFile });
            });
        }).then(function(node) {
            content.replaceChildren(node);
            if (self._archOption && self._detected) {
                self._archOption.description = t('auto = automatic detection, or specify manually e.g. armv7 musleabihf.') + ' ' + t('Detected:') + ' ' + self._detected;
                var desc = content.querySelector('[data-name="arch"] .cbi-value-description');
                if (desc) desc.textContent = self._archOption.description;
            }
            self._ready = true;
        }).catch(function() {
            self.map = null;
            self._ready = false;
            content.replaceChildren(UI.card(t('Failed'), [ E('p', {}, t('Failed to load settings. Please reload the page.')) ]));
        });
        return page;
    },

    _renderSettings: function(paths) {
        var cfgName = paths.cfg_name;
        var detected = this._detected;

        var m = new form.Map(cfgName);
        this.map = m;
        this._cfgName = cfgName;
        this._oldCfgFile = paths.cfg_file || ('/etc/config/' + cfgName);
        var s = m.section(form.NamedSection, 'main', 'harbor_file_pro');
        s.addremove = false;
        s.anonymous = true;

        s.tab('basic', t('Common'));
        s.tab('paths', t('Paths'));
        s.tab('advanced', t('Advanced'));
        s.tab('update', t('Update'));

        var o, rootOption, excludeOption, autoOption, respawnOption;
        var self = this;

        o = s.taboption('basic', form.Flag, 'enabled', t('Enable service'));
        o.default = '1';
        o.rmempty = false;

        o = s.taboption('basic', form.Value, '_listen_endpoint', t('Listen address and port'));
        o.rmempty = false;
        o.cfgvalue = function(section_id) {
            var host = uci.get(cfgName, section_id, 'listen') || '0.0.0.0';
            var port = uci.get(cfgName, section_id, 'port') || '9700';
            if (host.indexOf(':') >= 0 && host.charAt(0) !== '[') host = '[' + host + ']';
            return host + ':' + port;
        };
        o.validate = function(section_id, value) {
            var m = /^(?:\[([0-9a-fA-F:.]+)\]|([A-Za-z0-9._-]+)):(\d{1,5})$/.exec(value || '');
            if (!m || +m[3] < 1 || +m[3] > 65535)
                return t('Enter an address and port, for example 0.0.0.0:9700 or [::]:9700.');
            return true;
        };
        o.write = function(section_id, value) {
            var m = /^(?:\[([0-9a-fA-F:.]+)\]|([A-Za-z0-9._-]+)):(\d{1,5})$/.exec(value);
            if (!m) return;
            uci.set(cfgName, section_id, 'listen', m[1] || m[2]);
            uci.set(cfgName, section_id, 'port', m[3]);
        };

        o = s.taboption('basic', form.Flag, 'wan_access', t('Allow WAN access'),
            t('When enabled, the service is accessible from the public network.'));
        o.default = '0';
        o.rmempty = false;

        o = s.taboption('basic', form.ListValue, 'root_policy', t('Root access policy'),
            t('The selected policy decides the access rules.'));
        self._policyOption = o;
        o.value('unrestricted', t('Unrestricted (whole filesystem)'));
        o.value('allowlist', t('Whitelist (allow only listed roots)'));
        o.value('denylist', t('Blacklist (block listed roots)'));
        o.default = 'unrestricted';
        o.rmempty = false;
        o.cfgvalue = function(section_id) {
            var v = uci.get(cfgName, section_id, 'root_policy');
            if (v) return v;
            var roots = uci.get(cfgName, section_id, 'root');
            if (roots && roots.length) return 'allowlist';
            var excl = uci.get(cfgName, section_id, 'exclude_root');
            if (excl && excl.length) return 'denylist';
            return 'unrestricted';
        };

        o.validate = function(section_id, policy) {
            var active = policy === 'allowlist' ? rootOption : policy === 'denylist' ? excludeOption : null;
            var values = active ? active.formvalue(section_id) : [];
            values = Array.isArray(values) ? values : values ? [values] : [];
            if (active && !values.some(function(value) { return String(value || '').trim() !== ''; }))
                return t('The selected policy requires at least one directory.');
            var roots = policy === 'allowlist' ? values : uci.get(cfgName, section_id, 'root');
            var excluded = policy === 'denylist' ? values : uci.get(cfgName, section_id, 'exclude_root');
            var hasRoots = !!(roots && roots.length), hasExcluded = !!(excluded && excluded.length);
            if (!self._policyCapable && ((policy === 'unrestricted' && (hasRoots || hasExcluded)) ||
                (policy === 'allowlist' && hasExcluded) || (policy === 'denylist' && hasRoots)))
                return t('Start a compatible core before saving this policy with retained directories.');
            return true;
        };

        o = s.taboption('basic', form.DynamicList, 'root', t('Accessible roots'),
            t('Only paths inside these roots may be accessed.'));
        rootOption = o;
        o.retain = true;

        o = s.taboption('basic', form.DynamicList, 'exclude_root', t('Blocked roots'),
            t('These roots and everything under them are blocked.'));
        excludeOption = o;
        o.retain = true;

        o = s.taboption('basic', form.Value, 'workers', t('Worker threads'),
            t('0 automatic (max 4 threads) manually up to 16 threads.'));
        o.datatype = 'range(0,16)';
        o.default = '0';

        o = s.taboption('basic', form.Value, 'max_connections', t('Max connections'));
        o.datatype = 'range(1,512)';
        o.default = '16';

        o = s.taboption('basic', form.Value, 'max_transfers', t('Max concurrent transfers'));
        o.datatype = 'range(1,64)';
        o.default = '4';

        o = s.taboption('basic', form.Value, 'request_timeout', t('Request timeout (s)'));
        o.datatype = 'range(1,3600)';
        o.default = '60';

        o = s.taboption('paths', form.Value, 'bin_dir', t('Core binary directory'),
            t('Directory containing the harbor-core binary. Changing it takes effect after restart; download the core again if the binary is not there.'));
        o.default = '/usr/sbin';
        o.rmempty = false;
        o.validate = function(section_id, value) { return absPath(value); };

        o = s.taboption('paths', form.Value, 'config_file', t('Config file'),
            t('Must be a file under /etc/config/. Changing it copies the current configuration to the new file and rebinds the service.'));
        o.default = '/etc/config/harbor_file_pro';
        o.rmempty = false;
        o.validate = function(section_id, value) {
            if (typeof value !== 'string' || value.indexOf('/etc/config/') !== 0 || value.length <= 12)
                return t('Must be a file under /etc/config/');
            return true;
        };
        o.write = function(section_id, value) {
            uci.set(cfgName, section_id, 'config_file', value);
            if (cfgName !== 'harbor_file_pro')
                uci.set('harbor_file_pro', 'main', 'config_file', value);
        };

        o = s.taboption('paths', form.Value, 'state_dir', t('State directory'),
            t('Stores the administrator account and secrets. Changing it does NOT migrate existing account data; the panel will ask to initialize again.'));
        o.default = '/etc/harbor';
        o.rmempty = false;
        o.validate = function(section_id, value) { return absPath(value); };

        o = s.taboption('advanced', form.Value, 'session_ttl', t('Session lifetime (s)'));
        o.datatype = 'range(300,2592000)';
        o.default = '43200';

        o = s.taboption('advanced', form.Value, 'session_idle', t('Session idle timeout (s)'),
            t('0 disables idle logout.'));
        o.datatype = 'range(0,2592000)';
        o.default = '7200';

        o = s.taboption('advanced', form.Flag, 'session_sliding', t('Renew session on activity'));
        o.default = '1';
        o.rmempty = false;

        o = s.taboption('advanced', form.Value, 'body_idle_timeout', t('Body idle timeout (s)'));
        o.datatype = 'range(1,3600)';
        o.default = '30';

        o = s.taboption('advanced', form.Value, 'chunk_size', t('Chunk size (bytes)'));
        o.datatype = 'uinteger';
        o.default = '1048576';

        o = s.taboption('advanced', form.Value, 'chunk_limit', t('Chunk limit (bytes)'));
        o.datatype = 'uinteger';
        o.default = '16777216';

        o = s.taboption('advanced', form.Value, 'upload_session_hours', t('Upload session lifetime (h)'));
        o.datatype = 'range(1,720)';
        o.default = '24';

        o = s.taboption('advanced', form.Value, 'transfer_history', t('Transfer history entries'));
        o.datatype = 'range(8,4096)';
        o.default = '64';

        o = s.taboption('advanced', form.Flag, 'secure_cookie', t('Secure cookie'),
            t('Only enable when the panel is served over HTTPS.'));
        o.default = '0';
        o.rmempty = false;

        o = s.taboption('advanced', form.Flag, 'respawn_enabled', t('Enable respawn'),
            t('Automatically restart the core after crashes (procd respawn).'));
        o.default = '1';
        o.rmempty = false;

        respawnOption = o;
        o = s.taboption('advanced', form.Value, 'respawn_threshold', t('Respawn threshold (s)'),
            t('Time window in seconds in which repeated daemon exits are counted as crashes.'));
        o.datatype = 'range(60,86400)';
        o.default = '3600';

        o = s.taboption('advanced', form.Value, 'respawn_timeout', t('Respawn timeout (s)'),
            t('Wait time in seconds before restarting the daemon after it exits.'));
        o.datatype = 'range(1,300)';
        o.default = '5';

        o = s.taboption('advanced', form.Value, 'respawn_retry', t('Respawn retries'),
            t('Maximum number of automatic restarts; 0 unlimited.'));
        o.datatype = 'range(0,99)';
        o.default = '5';

        o = s.taboption('advanced', form.Flag, 'dev_mode', t('Developer mode'),
            t('Loads web assets from ./assets on disk and shows a DEV badge. For development only.'));
        o.default = '0';
        o.rmempty = false;

        o = s.taboption('update', form.ListValue, 'update_mirror', t('Update mirror'),
            t('Used for Core and LuCI updates. Auto selects an available mirror.'));
        o.value('auto', t('Auto'));
        o.value('github', 'GitHub');
        o.value('gitlab', 'GitLab');
        o.value('gitee', 'Gitee');
        o.value('cloudflare', 'Cloudflare');
        o.default = 'auto';
        o.rmempty = false;

        o = s.taboption('update', form.Value, 'arch', t('Core architecture'), detected
            ? t('auto = automatic detection, or specify manually e.g. armv7 musleabihf.') + ' ' + t('Detected:') + ' ' + detected
            : t('auto = automatic detection, or specify manually e.g. armv7 musleabihf.'));
        this._archOption = o;
        o.default = 'auto';
        o.rmempty = false;

        o = s.taboption('update', form.Flag, 'auto_update', t('Automatic updates'),
            t('Periodically checks and installs Core updates via cron.'));
        o.default = '0';
        o.rmempty = false;

        autoOption = o;
        o = s.taboption('update', form.Flag, 'auto_update_luci', t('Also update the LuCI package'));
        o.default = '0';
        o.rmempty = false;

        o = s.taboption('update', form.Value, 'update_interval', t('Update interval (days)'));
        o.datatype = 'range(1,30)';
        o.default = '7';

        o = s.taboption('update', form.Value, 'update_time', t('Update time'),
            t('Local time in 24-hour format, for example 00:00.'));
        o.placeholder = '04:00';
        o.default = '04:00';
        o.rmempty = false;
        o.validate = function(section_id, value) {
            return /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value || '') ? true :
                t('Enter a time in 24-hour HH:MM format.');
        };

        var diagOut = E('pre', { 'class': 'harbor-log', 'style': 'display:none' });
        var diagNote = E('span', { 'class': 'harbor-meta' });
        var diagCard = UI.card(t('Effective configuration'), [
            E('p', { 'class': 'harbor-meta' }, t('Runs print-config on the device and shows the effective configuration the core will use.')),
            E('div', { 'class': 'harbor-row' }, [
                UI.iconButton('refresh', t('Run print-config'), function() {
                    diagNote.textContent = t('Running…');
                    Rpc.printConfig().then(function(r) {
                        diagNote.textContent = '';
                        if (r && r.ok) {
                            diagOut.style.display = '';
                            diagOut.textContent = r.output || '';
                        } else {
                            diagOut.style.display = '';
                            diagOut.textContent = t('Core not installed');
                        }
                    }).catch(function() {
                        diagNote.textContent = t('Failed');
                    });
                }),
                diagNote
            ]),
            diagOut
        ]);

        return m.render().then(function(mapNode) {
            UI.fixLabelTargets(mapNode);
            var setRow = function(name, on) {
                var row = mapNode.querySelector('.cbi-value[data-name="' + name + '"]');
                if (row) row.style.display = on ? '' : 'none';
            };
            var syncDeps = function() {
                var isOn = function(v) { return v === '1' || v === true || v === 'yes'; };
                var auto = isOn(autoOption.formvalue('main'));
                setRow('auto_update_luci', auto);
                setRow('update_interval', auto);
                setRow('update_time', auto);
                var pol = self._policyOption.formvalue('main');
                setRow('root', pol === 'allowlist');
                setRow('exclude_root', pol === 'denylist');
                var resp = isOn(respawnOption.formvalue('main'));
                setRow('respawn_threshold', resp);
                setRow('respawn_timeout', resp);
                setRow('respawn_retry', resp);
            };
            mapNode.addEventListener('change', syncDeps, true);
            mapNode.addEventListener('input', syncDeps, true);
            mapNode.addEventListener('widget-change', syncDeps, true);
            syncDeps();
            return E('div', {}, [ mapNode, diagCard ]);
        });
    },

    handleSave: function(ev) {
        return this._saveSettings(ev);
    },

    handleSaveApply: function(ev, mode) {
        var self = this, before = this._snapshotSettings();
        return this._saveSettings(ev).then(function() {
            var applying = ui.changes.apply(mode == '0');
            Promise.resolve(applying).then(function() {
                self._applySettings(before);
            }, function() {});
        });
    },

    _saveSettings: function(ev) {
        var self = this;
        if (!this._ready || !this.map)
            return Promise.reject(new Error(t('Settings are still loading. Please wait.')));
        this._migrateFailed = false;
        return this.map.save(ev).then(function() {
            return uci.save();
        }).then(function() {
            var target = '';
            try { target = uci.get(self._cfgName, 'main', 'config_file') || ''; } catch (e) {}
            if (!target || !self._oldCfgFile || target === self._oldCfgFile)
                return;
            return Rpc.migrateConfig(self._oldCfgFile, target).then(function(r) {
                if (r && r.ok) {
                    self._oldCfgFile = target;
                } else {
                    self._migrateFailed = true;
                    ui.showModal(t('Configuration migration failed'),
                        E('p', {}, t('Migration failed or timed out. Check the active config before retrying.')));
                }
            }).catch(function() {
                self._migrateFailed = true;
                ui.showModal(t('Configuration migration failed'),
                    E('p', {}, t('Migration failed or timed out. Check the active config before retrying.')));
            });
        });
    },

    _restartKeys: [ 'enabled', 'listen', 'port', 'root_policy',
        'root', 'exclude_root', 'workers', 'max_connections', 'max_transfers',
        'request_timeout', 'bin_dir', 'config_file', 'state_dir', 'session_ttl',
        'session_idle', 'session_sliding', 'body_idle_timeout', 'chunk_size',
        'chunk_limit', 'upload_session_hours', 'transfer_history', 'secure_cookie',
        'respawn_enabled', 'respawn_threshold', 'respawn_timeout', 'respawn_retry',
        'dev_mode' ],
    _firewallKeys: [ 'wan_access' ],

    _snapshotSettings: function() {
        var self = this, snap = {};
        this._restartKeys.concat(this._firewallKeys).forEach(function(key) {
            try {
                snap[key] = JSON.stringify(uci.get(self._cfgName, 'main', key));
            } catch (e) {
                snap[key] = null;
            }
        });
        return snap;
    },

    _applySettings: function(before) {
        var self = this, restart = false, firewall = false;
        if (this._migrateFailed)
            return;
        function differs(key) {
            try {
                return JSON.stringify(uci.get(self._cfgName, 'main', key)) !== before[key];
            } catch (e) {
                return true;
            }
        }
        this._restartKeys.forEach(function(key) { if (differs(key)) restart = true; });
        this._firewallKeys.forEach(function(key) { if (differs(key)) firewall = true; });
        if (!restart && !firewall)
            return;
        if (!restart) {
            Rpc.action('sync_wan').then(function() {
                try {
                    ui.addNotification(t('Settings saved'),
                        E('p', {}, t('The firewall rule has been updated.')), 'info');
                } catch (e) {}
            }).catch(function() {});
            return;
        }
        var enabled = '1';
        try { enabled = uci.get(self._cfgName, 'main', 'enabled'); } catch (e) {}
        var stopping = (enabled === '0' || enabled === false);
        var message = stopping
            ? t('The service has been stopped.')
            : t('The service is restarting to apply changes.');
        Rpc.action(stopping ? 'stop' : 'restart').then(function() {
            try {
                ui.addNotification(t('Settings saved'), E('p', {}, message), 'info');
            } catch (e) {}
        }).catch(function() {});
    }
});
