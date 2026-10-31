(function (HF) {
    var devices = new Map(), capacities = new Map(), tasks = new Map(), lastPaths = Object.create(null);
    var settingsSequence = 0, deviceSequence = 0, taskSequence = 0;
    var capacityQueue = [], capacityActive = 0;
    var devicesLoaded = false, devicesLoading = false, toolChecks = new Map(), installations = new Map(), installRequests = new Map();
    try { lastPaths = JSON.parse(localStorage.getItem('harbor_file_pro_remote_paths') || '{}') || {}; } catch (e) {}
    function label(key) { return HF.labels['remote_' + key] || key; }
    function activeDevice() { return HF.state.current && HF.state.current.device_id || ''; }
    function nameOf(id) { return id ? (devices.get(id) || {}).name || id : HF.labels.this_pc; }
    function button(text, action, primary) {
        var node = HF.Util.createElement('button', 'fm-dialog-action' + (primary ? ' primary' : ''), text);
        node.type = 'button'; node.addEventListener('click', action); return node;
    }
    function remember(id, path) {
        lastPaths[id] = path;
        try { localStorage.setItem('harbor_file_pro_remote_paths', JSON.stringify(lastPaths)); } catch (e) {}
    }
    function request(action, data, quiet) {
        return new Promise(function(resolve, reject) {
            HF.Util.ajax({
                url: HF.api.list, type: 'POST', dataType: 'json',
                timeout: action === 'rpc' || action === 'agent_prepare' ? 120000 : action === 'start' || action === 'check' || action === 'install_stat' ? 75000 : action === 'list' || action === 'capacity' || action === 'tools' ? 45000 : 15000,
                data: Object.assign({}, data || {}, { remote_action: action, sessionid: HF.sessionid || (window.HarborIO && HarborIO.getSessionID()) || '' }),
                success: function(res) {
                    if (res && res.code === 0) { resolve(res.data || {}); return; }
                    var error = new Error(res && res.message || HF.labels.request_failed);
                    error.data = res && res.data;
                    if (res && res.code === 11 && error.data && !quiet) {
                        var info = error.data;
                        HF.confirm_window({ title: label('host_key'), message: nameOf(info.device_id) + ' · ' + info.host + ':' + info.port + '\n' + info.fingerprint + '\n' + label('verify') }).then(function(yes) {
                            if (!yes) { reject(error); return; }
                            request('trust', { device_id: info.device_id, challenge: info.challenge }, true).then(function() {
                                request(action, data, true).then(resolve, reject);
                            }, reject);
                        });
                        return;
                    }
                    reject(error);
                },
                error: function(xhr) {
                    var error = new Error(HF.batch_error_message(xhr, HF.labels.request_failed));
                    error.uncertain = true; reject(error);
                }
            });
        });
    }
    HF.remote_request = request;
    HF.remote_unavailable = function() { HF.set_warning_status(label('unavailable')); };
    function loadDevices() {
        var sequence = ++deviceSequence; devicesLoading = true;
        return request('devices').then(function(data) {
            if (sequence === deviceSequence) {
                devicesLoaded = true;
                devices.clear();
                (data.devices || []).forEach(function(d) { devices.set(d.id, d); });
                capacities.forEach(function(entry, id) { if (!currentCapacity(entry)) capacities.delete(id); });
                preparedFiles.forEach(function(entry, id) { if (!devices.has(id) || devices.get(id).revision !== entry.revision) invalidateFiles(id); });
                HF.render_sidebar();
                if (HF.state.target_picker && HF.configure_target_devices) HF.configure_target_devices(HF.state.target_picker);
                if (activeDevice()) HF.update_toolbar();
            }
            return data;
        }).catch(function(error) { if (sequence === deviceSequence) devicesLoaded = true; throw error; }).finally(function() { if (sequence === deviceSequence) devicesLoading = false; });
    }
    HF.append_remote_navigation = function(sidebar) {
        var active = HF.state.current && HF.state.current.kind === 'remote_devices';
        var heading = HF.create_sidebar_button(label('devices'), 'this_pc', 'fm-nav-heading' + (active ? ' active' : ''), function() { HF.show_remote_devices(true); });
        var list = HF.create_sidebar_section(sidebar, 'remote', heading);
        devices.forEach(function(d) {
            var node = HF.create_sidebar_button(d.name, 'this_pc', 'fm-nav-item fm-nav-drive fm-nav-remote' + (activeDevice() === d.id ? ' active' : ''), function() { HF.open_remote_path(d.id, lastPaths[d.id] || '/', true); });
            var meta = HF.add_sidebar_meta(node, label('unknown'));
            meta.dataset.remoteCapacity = d.id;
            node.dataset.deviceId = d.id; node.title = d.name; list.appendChild(node);
            HF.bind_drop_target(node, lastPaths[d.id] || '/', d.name, { device_id: d.id, device_revision: d.revision });
            ensureCapacity(d);
        });
        if (!devicesLoaded && !devicesLoading) loadDevices().catch(function() {});
    };
    HF.remote_path_segments = function() {
        var current = HF.state.current;
        if (!current) return null;
        if (current.kind === 'remote_devices') return [{ label: label('devices'), kind: 'remote_devices' }];
        if (!current.device_id) return null;
        var id = current.device_id;
        return [{ label: nameOf(id), path: '/', device_id: id }].concat(HF.directory_segments(current.path, false).map(function(crumb) {
            return Object.assign({}, crumb, { device_id: id });
        }));
    };
    HF.show_remote_devices = function(addHistory) {
        var sequence = HF.navigation_request = (HF.navigation_request || 0) + 1;
        HF.clear_marquee(); HF.hide_context_menus(); HF.hide_details(); HF.clear_selection();
        HF.state.current = { kind: 'remote_devices' };
        HF.state.current_directory_data = null; HF.state.context_item = null;
        var content = document.getElementById('fm_content'); HF.clear_node(content);
        var header = HF.Util.createElement('div', 'fm-page-header');
        header.appendChild(HF.Util.createElement('h1', 'fm-page-title', label('devices')));
        header.appendChild(button(label('add'), openSettings)); content.appendChild(header);
        tasks.forEach(function(task) {
            content.appendChild(button(label('transfer') + ' · ' + task.description, function() { showTask(task); }));
        });
        var grid = HF.Util.createElement('div', 'fm-grid fm-drive-grid fm-remote-grid'); content.appendChild(grid);
        var status = HF.Util.createElement('div', 'fm-remote-status', label('loading')); content.appendChild(status);
        if (addHistory) HF.push_history(HF.state.current);
        HF.render_sidebar(); HF.update_toolbar();
        loadDevices().then(function(data) {
            if (sequence !== HF.navigation_request) return;
            status.textContent = '';
            if (!data.devices.length) status.textContent = label('add');
            data.devices.forEach(function(d) {
                var card = HF.Util.createElement('button', 'fm-item fm-remote-card'); card.type = 'button';
                var icon = HF.Util.createElement('img', 'fm-item-icon'); icon.src = HF.icon_url('this_pc'); icon.alt = ''; icon.draggable = false;
                var copy = HF.Util.createElement('div', 'fm-item-copy');
                copy.appendChild(HF.Util.createElement('div', 'fm-item-name', d.name));
                var meta = HF.Util.createElement('div', 'fm-item-meta');
                meta.dataset.remoteCapacity = d.id;
                copy.appendChild(meta); card.appendChild(icon); card.appendChild(copy); grid.appendChild(card);
                card.addEventListener('click', function() { HF.open_remote_path(d.id, lastPaths[d.id] || '/', true); });
                ensureCapacity(d);
            });
        }).catch(function(error) { if (sequence === HF.navigation_request) status.textContent = error.message; });
    };
    function capacityText(data) {
        function compact(bytes) { return HF.format_size(bytes).replace(/\.0 /, ' ').replace(/ ([KMGT])B$/, '$1').replace(/ B$/, 'B'); }
        return compact(data.used_bytes) + ' / ' + compact(data.total_bytes);
    }
    function currentCapacity(entry) {
        var d = devices.get(entry.id);
        return capacities.get(entry.id) === entry && d && d.trusted && d.revision === entry.revision && (lastPaths[entry.id] || '/') === entry.path;
    }
    function paintCapacity(id) {
        var entry = capacities.get(id);
        if (entry && !currentCapacity(entry)) entry = null;
        document.querySelectorAll('[data-remote-capacity]').forEach(function(node) {
            if (node.dataset.remoteCapacity !== id) return;
            node.textContent = entry && entry.data ? capacityText(entry.data) : entry && entry.error ? label('failed_connection') : label('unknown');
            node.title = entry && entry.error || '';
        });
    }
    function pumpCapacities() {
        while (capacityActive < 2 && capacityQueue.length) {
            var entry = capacityQueue.shift();
            if (!currentCapacity(entry)) continue;
            capacityActive++;
            (function(entry) {
                request('capacity', { device_id: entry.id, device_revision: entry.revision, path: entry.path }, true).then(function(data) {
                    if (currentCapacity(entry) && data.device_revision === entry.revision) entry.data = data;
                }, function(error) {
                    if (currentCapacity(entry)) entry.error = error.data && error.data.challenge ? '' : error.message;
                }).finally(function() {
                    entry.pending = false; entry.time = Date.now(); capacityActive--;
                    if (currentCapacity(entry)) paintCapacity(entry.id);
                    pumpCapacities();
                });
            })(entry);
        }
    }
    function ensureCapacity(d) {
        var entry = capacities.get(d.id);
        if (entry && !currentCapacity(entry)) { capacities.delete(d.id); entry = null; }
        if (d.trusted && (!entry || !entry.pending && Date.now() - entry.time >= 60000)) {
            entry = { id: d.id, revision: d.revision, path: lastPaths[d.id] || '/', pending: true, time: Date.now(), data: entry && entry.data };
            capacities.set(d.id, entry); capacityQueue.push(entry); pumpCapacities();
        }
        paintCapacity(d.id);
    }
    function saveCapacity(id, data) {
        capacities.set(id, { id: id, revision: data.device_revision, path: lastPaths[id] || '/', data: data, time: Date.now() });
        paintCapacity(id);
    }
    HF.read_remote_directory = function(id, path, current) {
        var d = devices.get(id);
        if (!d) return Promise.reject(new Error(label('unavailable')));
        var revision = d.revision;
        return fileRequest({ device_id: id, device_revision: revision }, 'list', { path: path }).then(function(res) {
            if (!res || res.code !== 0) throw new Error(res && res.message || HF.labels.request_failed);
            if ((current && !current()) || !devices.has(id) || devices.get(id).revision !== revision) throw new Error(label('stale_device'));
            if (!res.data || !Array.isArray(res.data.items) || typeof res.data.path !== 'string') throw new Error(HF.labels.request_failed);
            var data = Object.assign({}, res.data, { device_revision: revision, device_name: devices.get(id).name });
            if (data.used_bytes === undefined) data.used_bytes = Math.max(0, Number(data.total_bytes || 0) - Number(data.available_bytes || 0));
            return data;
        });
    };
    HF.open_remote_path = function(id, path, addHistory, selectPath) {
        var sequence = HF.navigation_request = (HF.navigation_request || 0) + 1;
        HF.clear_marquee(); HF.hide_context_menus(); HF.hide_details();
        var content = document.getElementById('fm_content');
        content.querySelectorAll('.fm-remote-loading').forEach(function(node) { node.remove(); });
        var loading = HF.Util.createElement('span', 'fm-remote-loading', label('loading'));
        (content.querySelector('.fm-page-header') || content).appendChild(loading);
        var ready = devices.has(id) ? Promise.resolve() : loadDevices();
        ready.then(function() { return HF.read_remote_directory(id, path, function() { return sequence === HF.navigation_request; }); }).then(function(data) {
            if (sequence !== HF.navigation_request || !devices.has(id) || devices.get(id).revision !== data.device_revision) return;
            HF.clear_selection(); HF.state.context_item = null;
            if (activeDevice() !== id || HF.state.sort_path && HF.state.sort_path !== data.path) {
                HF.state.sort_path = ''; HF.state.sort_field = 'name'; HF.state.sort_order = 'asc';
            }
            data.device_id = id;
            if (data.device_name) devices.set(id, Object.assign({}, devices.get(id), { id: id, name: data.device_name, revision: data.device_revision, trusted: true }));
            data.items = (data.items || []).filter(function(item) { return HF.state.preferences.show_hidden_files === 1 || !item.hidden; }).map(function(item) {
                return Object.assign({}, item, { device_id: id, device_revision: data.device_revision });
            });
            HF.state.current = Object.assign({ kind: 'directory', device_id: id }, data);
            delete HF.state.current.items;
            HF.state.current_directory_data = data;
            remember(id, data.path); saveCapacity(id, data);
            HF.render_directory(data);
            if (selectPath) HF.select_rendered_item_by_path(selectPath);
            if (addHistory) HF.push_history(HF.state.current);
            HF.render_sidebar(); HF.update_toolbar();
        }).catch(function(error) { if (sequence === HF.navigation_request) HF.set_error_status(error.message); }).finally(function() { loading.remove(); });
    };
    function openSettings() {
        HF.load_preferences(function() {
            HF.populate_settings_dialog(); HF.set_settings_tab('remote'); HF.open_modal('fm_settings_dialog');
        });
    }
    function deviceChanged(id, identityChanged) {
        capacities.delete(id); toolChecks.delete(id); invalidateFiles(id);
        if (identityChanged) {
            remember(id, undefined);
            if (HF.state.clipboard && HF.state.clipboard.device_id === id) HF.state.clipboard = null;
        }
        if (activeDevice() === id && identityChanged || HF.state.current && HF.state.current.kind === 'remote_devices') HF.show_remote_devices(false);
    }
    function editDevice(id) {
        var host = document.getElementById('fm_remote_settings');
        var sequence = host._editorSequence = (host._editorSequence || 0) + 1;
        var data = id ? request('get', { id: id }) : Promise.resolve({ id: '', name: '', host: '', port: '', username: '', password: '' });
        data.then(function(d) {
            if (sequence !== host._editorSequence) return;
            host._deviceId = d.id;
            host._inputs.password.type = 'password';
            host._passwordToggle.setAttribute('aria-pressed', 'false');
            host._passwordToggle.title = label('show_password');
            host._passwordToggle.setAttribute('aria-label', label('show_password'));
            Object.keys(host._inputs).forEach(function(k) { host._inputs[k].value = d[k] === undefined ? '' : d[k]; host._inputs[k].setCustomValidity(''); });
            host._message.textContent = '';
            host._inputs.name.focus();
        }).catch(function(error) { host._message.textContent = error.message; });
    }
    function buildSettings(host) {
        if (host._inputs) return;
        host.className = 'fm-settings-panel-main fm-remote-settings';
        host._tools = HF.Util.createElement('div', 'fm-remote-tools');
        host._devices = HF.Util.createElement('div', 'fm-remote-devices');
        host.appendChild(host._tools); host.appendChild(host._devices);
        var form = HF.Util.createElement('form', 'fm-remote-editor'); host._inputs = Object.create(null);
        ['name', 'host', 'port', 'username', 'password'].forEach(function(key) {
            var row = HF.Util.createElement('div', 'fm-settings-row');
            var text = HF.Util.createElement('label', 'fm-settings-label', label(key));
            var input = HF.Util.createElement('input', 'fm-settings-control ' + (key === 'port' ? 'fm-settings-number-control' : 'fm-settings-text-control'));
            input.id = 'fm_remote_' + key; text.htmlFor = input.id;
            input.type = key === 'port' ? 'number' : key === 'password' ? 'password' : 'text';
            input.autocomplete = 'off'; input.spellcheck = false;
            input.required = true;
            input.placeholder = { name: label('name_placeholder'), host: '192.168.1.1 / router.example.com', port: '22', username: 'root', password: label('password_placeholder') }[key];
            input.addEventListener('input', function() { input.setCustomValidity(''); });
            input.maxLength = key === 'password' ? 1024 : key === 'name' ? 128 : key === 'username' ? 64 : 253;
            if (key === 'port') { input.min = '1'; input.max = '65535'; }
            host._inputs[key] = input;
            row.appendChild(text);
            if (key === 'password') {
                var wrap = HF.Util.createElement('div', 'fm-remote-password');
                var toggle = button('*', function() {
                    input.type = input.type === 'password' ? 'text' : 'password';
                    toggle.setAttribute('aria-pressed', input.type === 'text' ? 'true' : 'false');
                    toggle.title = input.type === 'text' ? label('hide_password') : label('show_password');
                    toggle.setAttribute('aria-label', toggle.title);
                });
                toggle.title = label('show_password'); toggle.setAttribute('aria-label', toggle.title); toggle.setAttribute('aria-pressed', 'false');
                host._passwordToggle = toggle;
                wrap.appendChild(input); wrap.appendChild(toggle); row.appendChild(wrap);
            } else row.appendChild(input);
            form.appendChild(row);
        });
        var actions = HF.Util.createElement('div', 'fm-settings-page-actions');
        var reset = button(label('add'), function() { editDevice(''); });
        var save = button(label('save'), function() {}, true); save.type = 'submit';
        actions.appendChild(reset); actions.appendChild(save); form.appendChild(actions);
        host._message = HF.Util.createElement('div', 'fm-remote-status'); form.appendChild(host._message); host.appendChild(form);
        form.addEventListener('submit', function(event) {
            event.preventDefault();
            Object.keys(host._inputs).forEach(function(key) {
                var input = host._inputs[key];
                input.setCustomValidity(input.value.trim() ? '' : label('required'));
            });
            if (!form.reportValidity()) return;
            var editSequence = host._editorSequence || 0;
            var values = { id: host._deviceId || '' };
            var previous = devices.get(values.id);
            Object.keys(host._inputs).forEach(function(key) { values[key] = host._inputs[key].value; });
            save.disabled = true; reset.disabled = true;
            request('save', values).then(function(data) {
                if (editSequence === (host._editorSequence || 0)) host._deviceId = data.id;
                deviceChanged(data.id, !!previous && (previous.host !== values.host.trim() || previous.port !== Number(values.port) || previous.username !== values.username));
                host._message.textContent = HF.labels.settings_saved;
                HF.render_remote_settings();
            }).catch(function(error) { host._message.textContent = error.message; }).finally(function() { save.disabled = false; reset.disabled = false; });
        });
    }
    HF.render_remote_settings = function() {
        var host = document.getElementById('fm_remote_settings');
        if (!host) return;
        buildSettings(host);
        var sequence = ++settingsSequence;
        loadDevices().then(function(data) {
            if (sequence !== settingsSequence) return;
            HF.clear_node(host._tools); HF.clear_node(host._devices);
            var names = ['sshpass', 'pv', 'stat']; if (!data.tools.ssh) names.push('ssh');
            names.forEach(function(tool) {
                var row = toolRow(tool === 'stat' ? 'coreutils-stat' : tool, toolStatus(data.tools[tool]), label(tool + '_description'));
                if (!data.tools[tool]) row._actions.appendChild(toolButton(label('install'), function() { installTool(tool); }));
                host._tools.appendChild(row);
            });
            data.devices.forEach(function(d) {
                var row = HF.Util.createElement('div', 'fm-settings-row');
                var copy = HF.Util.createElement('div', 'fm-settings-copy');
                copy.appendChild(HF.Util.createElement('div', 'fm-settings-label', d.name));
                copy.appendChild(HF.Util.createElement('div', 'fm-settings-desc', d.username + '@' + d.host + ':' + d.port));
                row.appendChild(copy);
                row.appendChild(button(label('edit'), function() { editDevice(d.id); }));
                row.appendChild(button(label('remove'), function() {
                    HF.confirm_window({ title: label('remove'), message: label('delete') + '\n' + d.name }).then(function(yes) {
                        if (!yes) return;
                        request('delete', { id: d.id }).then(function() {
                            deviceChanged(d.id, true);
                            if (host._deviceId === d.id) editDevice('');
                            HF.render_remote_settings();
                        }).catch(function(error) { host._message.textContent = error.message; });
                    });
                }));
                var block = HF.Util.createElement('div', 'fm-remote-device');
                block.appendChild(row);
                var dependency = toolRow('coreutils-stat · ' + label('remote_side'), label('unchecked'), label('remote_stat_description'));
                dependency.dataset.deviceId = d.id; dependency.classList.add('fm-remote-dependency');
                block.appendChild(dependency); host._devices.appendChild(block);
                renderDependency(dependency, d);
            });
        }).catch(function(error) { if (sequence === settingsSequence) host._message.textContent = error.message; });
    };
    function toolButton(text, action) {
        var node = button(text, action); node.className = 'fm-nginx-command primary'; return node;
    }
    function toolRow(name, status, description) {
        var row = HF.Util.createElement('div', 'fm-settings-intro');
        var title = HF.Util.createElement('div', 'fm-settings-intro-title');
        title.appendChild(HF.Util.createElement('strong', '', name));
        row._actions = HF.Util.createElement('div', 'fm-nginx-actions');
        row._status = HF.Util.createElement('span', 'fm-nginx-status', status);
        row._actions.appendChild(row._status); title.appendChild(row._actions); row.appendChild(title);
        row._description = HF.Util.createElement('div', 'fm-settings-intro-desc', description);
        row.appendChild(row._description);
        return row;
    }
    function toolStatus(installed) {
        return installed ? label('installed') : label('missing');
    }
    function renderDependency(row, d) {
        HF.clear_node(row._actions); row._actions.appendChild(row._status);
        var cached = toolChecks.get(d.id), info = cached && cached.revision === d.revision ? cached : null;
        row._status.textContent = info ? info.error ? label('failed_connection') : toolStatus(info.stat) : label('unchecked');
        row._status.title = info && info.error || '';
        var note = info && (info.error || (!info.stat && !info.can_install ? !info.root ? label('root_required') : label('pm_missing') : ''));
        row._description.textContent = label('remote_stat_description') + (note ? '\n' + note : '');
        var job = installations.get(d.id);
        if (job) row._actions.appendChild(toolButton(label('install_log'), function() { showInstall(job); }));
        var check = toolButton(label('check_tools'), function() {
            check.disabled = true; row._status.textContent = label('loading');
            request('tools', { device_id: d.id, device_revision: d.revision }).then(function(data) {
                toolChecks.set(d.id, Object.assign({}, data, { revision: d.revision }));
            }).catch(function(error) { toolChecks.set(d.id, { revision: d.revision, error: error.message }); }).finally(function() {
                if (devices.get(d.id) && devices.get(d.id).revision === d.revision) renderDependency(row, d);
            });
        });
        check.disabled = !!job && !job.data.done; row._actions.appendChild(check);
        if (info && !info.error && !info.stat) {
            var install = toolButton(label('install'), function() { installRemoteStat(d); });
            install.disabled = !info.can_install || !!job && !job.data.done;
            install.title = !info.root ? label('root_required') : info.installer === 'none' ? label('pm_missing') : '';
            row._actions.appendChild(install);
        }
    }
    function installRemoteStat(d, agent) {
        var key = d.id + (agent ? ':agent' : '');
        var existing = installations.get(key);
        if (existing && !existing.data.done) { showInstall(existing); return existing.completion; }
        if (installRequests.has(key)) return installRequests.get(key);
        var pending = HF.confirm_window({ title: label('install_remote'), message: d.name + '\n' + d.username + '@' + d.host + ':' + d.port + '\n' + label(agent ? 'agent_install_confirm' : 'install_confirm') }).then(function(yes) {
            if (!yes || !devices.has(d.id) || devices.get(d.id).revision !== d.revision) return false;
            var job = { agent: !!agent, device: Object.assign({}, d), data: { done: false, package_name: agent ? 'ucode ucode-mod-fs ucode-mod-uci' : 'coreutils-stat', path: d.name + ' (' + d.host + ':' + d.port + ')', message: label('loading') } };
            job.completion = new Promise(function(resolve) { job.resolve = resolve; });
            installations.set(key, job); showInstall(job);
            request(agent ? 'agent_install' : 'install_stat', { device_id: d.id, device_revision: d.revision }).then(function(data) {
                job.data = Object.assign({}, job.data, data); updateInstall(job);
                if (data.task_id) { job.id = data.task_id; pollInstall(job); }
                else refreshInstallDevice(job);
            }).catch(function(error) {
                job.data = Object.assign({}, job.data, { done: true, success: false, state: error.uncertain ? 'unknown' : 'failed', message: error.uncertain ? label('install_uncertain') : error.message });
                updateInstall(job); refreshInstallDevice(job);
            });
            return job.completion;
        }).finally(function() { installRequests.delete(key); });
        installRequests.set(key, pending);
        return pending;
    }
    function showInstall(job) {
        if (!job.panel) {
            job.panel = HF.Util.createElement('div', 'fm-remote-install-panel');
            var body = document.querySelector('#fm_package_install_dialog .fm-package-install-body').cloneNode(true);
            body.querySelectorAll('[id]').forEach(function(node) { node.dataset.installField = node.id.replace('fm_package_install_', ''); node.removeAttribute('id'); });
            var progress = body.querySelector('.fm-thumbnail-progress'); if (progress) progress.remove();
            job.panel.appendChild(body);
            var actions = HF.Util.createElement('div', 'fm-dialog-actions');
            job.close = button(HF.labels.close || label('cancel'), function() { HF.window_manager.close(job.record); });
            actions.appendChild(job.close); job.panel.appendChild(actions);
        }
        if (!job.record || job.record.closed) job.record = HF.window_manager.create({
            title: label('install_remote'), icon: 'file', className: 'fm-remote-install-window', content: job.panel,
            width: 600, height: 500, minWidth: 300, minHeight: 180, persistSize: false,
            beforeClose: function() { return !!job.data.done; }
        });
        else HF.window_manager.show(job.record);
        updateInstall(job);
    }
    function updateInstall(job) {
        var fields = HF.package_install_fields(job.data, null);
        Object.keys(fields).forEach(function(key) {
            var node = job.panel.querySelector('[data-install-field="' + key + '"]'); if (node) node.textContent = fields[key];
        });
        job.record.title_node.textContent = job.device.name + ' · ' + fields.title;
        job.close.disabled = !job.data.done;
        HF.window_manager.render_taskbar();
    }
    function refreshInstallDevice(job) {
        var current = devices.get(job.device.id);
        if (!current || current.revision !== job.device.revision) { if (job.resolve) job.resolve(false); return; }
        if (job.agent) {
            request('agent_info', { device_id: current.id, device_revision: current.revision }, true).then(function(info) { if (job.resolve) job.resolve(!!(devices.has(current.id) && devices.get(current.id).revision === job.device.revision && info.ready && job.data.success && job.data.state !== 'unknown')); }, function() { if (job.resolve) job.resolve(false); });
            return;
        }
        toolChecks.delete(current.id);
        request('tools', { device_id: current.id, device_revision: current.revision }, true).then(function(data) {
            var valid = devices.has(current.id) && devices.get(current.id).revision === current.revision && data.device_revision === current.revision;
            if (valid) toolChecks.set(current.id, Object.assign({}, data, { revision: current.revision }));
            if (job.resolve) job.resolve(!!(valid && data.stat && job.data.success && job.data.state !== 'unknown'));
        }).catch(function(error) {
            if (devices.has(current.id) && devices.get(current.id).revision === current.revision) toolChecks.set(current.id, { revision: current.revision, error: error.message });
            if (job.resolve) job.resolve(false);
        }).finally(function() {
            document.querySelectorAll('.fm-remote-dependency').forEach(function(row) {
                if (row.dataset.deviceId === current.id && devices.has(current.id)) renderDependency(row, devices.get(current.id));
            });
        });
    }
    function pollInstall(job) {
        request('status', { task_id: job.id }, true).then(function(data) {
            job.data = Object.assign({}, job.data, { message: '' }, data); updateInstall(job);
            if (data.done) { refreshInstallDevice(job); return; }
            job.timer = setTimeout(function() { pollInstall(job); }, 1000);
        }).catch(function() {
            job.data.message = label('waiting'); updateInstall(job);
            job.timer = setTimeout(function() { pollInstall(job); }, 2000);
        });
    }
    HF.settings_tool_row = toolRow;
    HF.settings_tool_button = toolButton;
    HF.settings_tool_status = toolStatus;
    HF.install_settings_tool = installTool;
    function installTool(tool) {
        if (HF.state.settings_tool_starting || HF.state.install_task && !HF.state.install_task.done) return;
        HF.state.settings_tool_starting = true;
        if (HF.render_prism_settings) HF.render_prism_settings();
        HF.request_write(HF.api.tool_install_start, { tool: tool === 'ssh' ? 'openssh-client' : tool === 'stat' ? 'coreutils-stat' : tool }, '', function(data) {
            HF.state.settings_tool_starting = false;
            HF.state.install_item = { name: tool, path: tool };
            HF.update_package_install_view(data || {});
            HF.open_modal('fm_package_install_dialog');
            if (!data.done) HF.poll_package_install(data.task_id);
        }, function() {
            HF.state.settings_tool_starting = false;
            if (HF.render_prism_settings) HF.render_prism_settings();
        });
    }
    var installView = HF.update_package_install_view;
    HF.update_package_install_view = function(data) {
        installView(data);
        var tool = HF.state.install_item && HF.state.install_item.name;
        if (tool === 'curl' && HF.render_prism_settings) {
            HF.render_prism_settings();
            if (data && data.done && document.getElementById('fm_settings_prism').checked) HF.read_prism_status();
        }
        if (data && data.done && document.getElementById('fm_settings_panel_remote').classList.contains('active')) HF.render_remote_settings();
    };
    HF.run_remote_paste = function(targetPath) {
        var clipboard = HF.state.clipboard;
        if (!clipboard || !clipboard.items.length) return HF.set_warning_status(HF.labels.clipboard_empty);
        if (!HF.can_paste_to_path(targetPath)) return HF.set_warning_status(HF.get_write_block_reason(targetPath));
        HF.run_remote_transfer(clipboard.mode === 'cut' ? 'move' : 'copy', clipboard.items, { source_device: clipboard.device_id || '', source_revision: clipboard.device_revision || '', target_device: activeDevice(), target_revision: HF.state.current && HF.state.current.device_revision || '', target_dir: targetPath }, clipboard);
    };
    HF.run_remote_transfer = function(action, items, context, clipboard) {
        HF.hide_context_menus();
        var targetPath = context.target_dir;
        context.operation = action;
        items = items.map(function(item) { return Object.assign({}, item); });
        var adapter = {
            check: function(data, okay, failed) {
                request('check', Object.assign({}, context, data)).then(okay).catch(function(error) { (failed || HF.set_error_status)(error.message); });
            },
            execute: function(action, selected, path, conflict, names, preserve, skipped, excluded) {
                if (!selected.length) return;
                var params = Object.assign({}, context, {
                    sources: JSON.stringify(selected.map(function(item) { return item.path; })),
                    conflict_action: conflict || 'error', preserve_permissions: preserve === false ? '0' : '1',
                    exclude_paths: JSON.stringify(excluded || [])
                });
                if (names) params.rename_map = JSON.stringify(names);
                var task = { started: Date.now(), clipboard: clipboard, id: 'pending-' + (++taskSequence), context: context, description: nameOf(context.source_device) + ' → ' + nameOf(context.target_device), data: { done: false, preparing: true }, lastBytes: 0, lastTime: Date.now() };
                tasks.set(task.id, task); showTask(task);
                request('start', params).then(function(data) {
                    if (!data.task_id) { task.data = data; updateTask(task); finishTask(task); return; }
                    tasks.delete(task.id); task.id = data.task_id; task.data = data;
                    tasks.set(task.id, task); updateTask(task); if (!finishTask(task)) pollTask(task);
                }).catch(function(error) {
                    task.data = { done: true, success: false, uncertain: !!error.uncertain, message: action === 'move' && error.uncertain ? label('move_unconfirmed') + '\n' + error.message : error.message }; updateTask(task);
                });
            }
        };
        adapter.check({ sources: JSON.stringify(items.map(function(item) { return item.path; })) }, function(data) {
            if (data.conflicts && data.conflicts.length) HF.showPasteConflictDialog(data.conflicts, action, items, targetPath, adapter);
            else adapter.execute(action, items, targetPath);
        });
    };
    function showTask(task) {
        if (!task.panel) {
            var panel = document.getElementById('fm_upload_panel').cloneNode(true);
            panel.removeAttribute('id'); panel.querySelectorAll('[id]').forEach(function(node) { node.removeAttribute('id'); });
            panel.className = 'fm-upload-panel show fm-remote-transfer';
            panel.querySelector('.fm-upload-percent').style.display = 'none';
            task.panel = panel;
        }
        if (!task.record || task.record.closed) task.record = HF.window_manager.create({
            title: label('transfer'), icon: 'upload', className: 'fm-upload-window fm-remote-window', content: task.panel,
            width: 480, height: 220, minWidth: 320, minHeight: 160, persistSize: false
        });
        else HF.window_manager.show(task.record);
        updateTask(task);
    }
    function updateTask(task) {
        var data = task.data, panel = task.panel;
        if (data.done && data.success && task.context.operation === 'move' && data.operation !== 'move') { data.success = false; data.message = label('move_unconfirmed'); }
        panel.classList.toggle('fm-remote-running', !data.done);
        panel.classList.toggle('success', !!data.done && !!data.success);
        panel.classList.toggle('error', !!data.done && !data.success);
        panel.querySelector('.fm-upload-title').textContent = data.uncertain ? HF.labels.task_status_unknown : task.waiting ? label('waiting') : data.done ? (data.success ? task.context.operation === 'move' ? HF.labels.move_complete : HF.labels.copy_complete : label('failed')) : data.preparing ? label('loading') : ['hashing', 'verifying', 'deleting'].indexOf(data.phase) >= 0 ? label(data.phase) : label('transfer');
        panel.querySelector('.fm-upload-progress span').style.width = data.done ? (data.success ? '100%' : '0%') : '30%';
        panel.querySelector('.fm-upload-detail').textContent = task.description + ' · ' + task.context.target_dir;
        panel.querySelector('.fm-upload-bytes').textContent = label('transferred') + ': ' + HF.format_size(data.bytes || 0) + ' · ' + label('elapsed') + ': ' + (data.elapsed || 0) + 's';
        panel.querySelector('.fm-upload-speed').textContent = data.done && !data.success ? data.message || label('failed') : HF.format_speed(task.speed || 0);
        if (data.done && data.source_results) panel.querySelector('.fm-upload-speed').textContent += '\n' + data.source_results.map(function(result) { return result.path + ' · ' + label('source_' + result.state) + (result.deleted_count ? ' (' + result.deleted_count + ')' : '') + (result.state !== 'deleted' && result.deleted_paths && result.deleted_paths.length ? '\n' + result.deleted_paths.map(function(path) { return label('source_deleted') + ': ' + path; }).join('\n') + (result.more_deleted_paths ? '\n…' : '') : ''); }).join('\n');
    }
    function finishTask(task) {
        var data = task.data;
        if (!data.done || data.uncertain || task.waiting) return false;
        if (task.completed) return true;
        task.completed = true;
        if (task.clipboard && task.clipboard === HF.state.clipboard && task.context.operation === 'move' && data.source_results) {
            var removed = new Set(data.source_results.filter(function(result) { return result.state === 'deleted'; }).map(function(result) { return result.path; }));
            task.clipboard.items = task.clipboard.items.filter(function(item) { return !removed.has(item.path); });
            if (!task.clipboard.items.length) HF.state.clipboard = null;
        }
        if (data.done === true && data.success === true && task.record && !task.record.closed) HF.window_manager.close(task.record);
        var target = devices.get(task.context.target_device);
        if (target && target.revision === task.context.target_revision) {
            capacities.delete(target.id);
            if (activeDevice() !== target.id || !HF.state.current || HF.state.current.kind !== 'directory') ensureCapacity(target);
        }
        if ((activeDevice() === task.context.target_device || task.context.operation === 'move' && activeDevice() === task.context.source_device) && HF.state.current && HF.state.current.kind === 'directory') HF.refresh_current();
        return true;
    }
    function pollTask(task) {
        request('status', { task_id: task.id }, true).then(function(data) {
            var now = Date.now();
            task.speed = Math.max(0, (Number(data.bytes || 0) - task.lastBytes) * 1000 / Math.max(1, now - task.lastTime));
            task.lastBytes = Number(data.bytes || 0); task.lastTime = now;
            task.data = data; task.waiting = false; updateTask(task);
            if (finishTask(task)) return;
            task.timer = setTimeout(function() { pollTask(task); }, Date.now() - task.started < 5000 ? 250 : 1000);
        }).catch(function() {
            task.waiting = true; updateTask(task);
            task.timer = setTimeout(function() { pollTask(task); }, 2000);
        });
    }
    HF.configure_target_devices = function(options) {
        var select = document.getElementById('fm_target_device');
        if (!select) {
            select = HF.Util.createElement('select', 'fm-settings-control fm-target-device');
            select.id = 'fm_target_device'; select.setAttribute('aria-label', label('target_device'));
            var address = document.getElementById('fm_target_path');
            address.parentNode.insertBefore(select, address);
            select.addEventListener('change', function() {
                var picker = HF.state.target_picker;
                if (!picker || !picker.allow_devices) return;
                sizeDevice();
                picker.device_id = select.value; picker.device_revision = '';
                HF.state.target_path = null; HF.state.target_parent = null; HF.state.target_has_operation_space = false;
                HF.clear_node(document.getElementById('fm_target_list'));
                var control = address._fmPathAddress; if (control) control.exit();
                HF.render_target_address();
                HF.load_target_directory(picker.device_paths[picker.device_id] || (picker.device_id ? lastPaths[picker.device_id] : HF.state.navigation.home_dir) || '/', true);
            });
        }
        function sizeDevice() {
            var option = select.options[select.selectedIndex];
            if (!option) return;
            select.title = option.title;
            HF.size_select_to_content(select);
        }
        select.hidden = !options.allow_devices;
        if (!options.allow_devices) return;
        options.device_id = options.device_id || '';
        options.device_paths = options.device_paths || Object.create(null);
        HF.clear_node(select);
        function option(id, name, disabled) {
            var chars = Array.from(name || '');
            var node = HF.Util.createElement('option', '', chars.length > 18 ? chars.slice(0, 18).join('') + '…' : name); node.title = name; node.value = id; node.disabled = !!disabled; select.appendChild(node);
        }
        option('', HF.labels.this_pc);
        devices.forEach(function(d) { option(d.id, d.name); });
        if (options.device_id && !devices.has(options.device_id)) option(options.device_id, options.device_id + ' · ' + label('unavailable'), true);
        select.value = options.device_id;
        sizeDevice();
        options.load = function(path, okay, failed, active) {
            if (!options.device_id) { HF.request_json(HF.api.list, { path: path }, okay, failed); return; }
            var id = options.device_id;
            HF.read_remote_directory(id, path, active).then(function(data) {
                if (active() && id === options.device_id && devices.has(id) && data.device_revision === devices.get(id).revision) okay(data);
            }).catch(function(error) { if (active()) failed(error.message, !!error.stopFallback); });
        };
        if (!devicesLoaded && !devicesLoading) loadDevices().catch(function(error) { HF.target_address_error(error.message); });
    };
    HF.open_transfer_dialog = function(action, items) {
        items = HF.normalize_item_list(Array.isArray(items) ? items : [items]);
        var current = HF.state.current;
        if (!items.length || !current || current.kind !== 'directory') return;
        var source = current.device_id || '', revision = current.device_revision || '';
        HF.open_directory_picker({
            allow_devices: true, device_id: source,
            title: action === 'copy' ? HF.labels.copy_to : HF.labels.move_to,
            confirm: action === 'copy' ? HF.labels.copy_to : HF.labels.move_to,
            source: nameOf(source) + ' · ' + (items.length > 1 ? HF.format_label(HF.labels.selected_items, items.length) : items[0].path),
            path: current.path,
            accept: function(path, id, targetRevision) {
                if (!source && !id) HF.run_batch_transfer(action, items, path);
                else HF.run_remote_transfer(action, items, { source_device: source, source_revision: revision, target_device: id, target_revision: targetRevision, target_dir: path });
            }
        });
    };
    if (HF.FileOperations) HF.FileOperations.open_transfer_dialog = HF.open_transfer_dialog;
    var localTerminal = HF.open_terminal;
    HF.open_terminal = function(item) {
        var owner = HF.file_context(item && item.device_id !== undefined ? item : HF.state.current);
        if (!owner.device_id) return localTerminal(item);
        owner.path = HF.resolve_terminal_target(item).path;
        HF.hide_context_menus(); HF.hide_details();
        var d = devices.get(owner.device_id), fields = Object.create(null), closed = false, timer = null, sequence = 0, url = '';
        if (!d || d.revision !== owner.device_revision) return HF.set_error_status(label('stale_device'));
        var panel = document.getElementById('fm_terminal_dialog').querySelector('.fm-terminal-shell').cloneNode(true);
        panel.querySelectorAll('[id]').forEach(function(node) { fields[node.id] = node; node.removeAttribute('id'); });
        var frame = fields.fm_terminal_frame, loading = fields.fm_terminal_loading, failure = fields.fm_terminal_error;
        var install = fields.fm_terminal_install_tool, external = fields.fm_terminal_open_external;
        frame.src = 'about:blank'; frame.referrerPolicy = 'no-referrer';
        var record = HF.window_manager.create({ title: nameOf(owner.device_id) + ' · ' + HF.labels.terminal, icon: 'terminal', className: 'fm-remote-terminal', content: panel, width: 900, height: 560, minWidth: 300, minHeight: 240, persistSize: false, onClose: function() { closed = true; sequence++; clearTimeout(timer); frame.src = 'about:blank'; } });
        var controls = record.element.querySelector('.fm-window-controls');
        var openExternal = HF.window_manager.add_control(controls, 'external', '↗', HF.labels.open_terminal_external, function() { if (url) window.open(url, '_blank', 'noopener,noreferrer'); });
        controls.insertBefore(openExternal, controls.firstChild); openExternal.disabled = true;
        var reconnect = HF.window_manager.add_control(controls, 'reconnect', '↻', HF.labels.refresh, connect);
        controls.insertBefore(reconnect, controls.firstChild);
        function failed(message, missing) {
            clearTimeout(timer); loading.classList.remove('show'); failure.classList.add('show');
            fields.fm_terminal_error_text.textContent = HF.labels.terminal_failed;
            fields.fm_terminal_error_hint.textContent = message + '\n' + label('terminal_direct');
            install.style.display = missing ? '' : 'none'; external.style.display = url ? '' : 'none';
        }
        function connect() {
            if (closed) return;
            var requestSequence = ++sequence;
            frame.onload = null; frame.onerror = null; frame.src = 'about:blank'; url = ''; openExternal.disabled = true;
            clearTimeout(timer); failure.classList.remove('show'); loading.classList.add('show');
            install.style.display = 'none'; external.style.display = 'none';
            fields.fm_terminal_loading_hint.textContent = d.name + ' · ' + owner.path;
            HF.request_json(HF.file_endpoint('terminal_info', owner), {}, function(info) {
                if (closed || sequence !== requestSequence) return;
                if (!info.available) return failed(HF.labels.terminal_service_missing, true);
                try { url = HF.resolve_terminal_url(info, d.host); openExternal.disabled = false; } catch (error) { return failed(error.message, false); }
                if (window.location.protocol === 'https:' && /^http:/i.test(url)) return failed(HF.labels.terminal_https_hint, false);
                frame.onload = function() { if (closed || sequence !== requestSequence) return; clearTimeout(timer); loading.classList.remove('show'); };
                frame.onerror = function() { if (!closed && sequence === requestSequence) failed(HF.labels.terminal_failed_hint, false); };
                timer = setTimeout(function() { if (!closed && sequence === requestSequence) failed(HF.labels.terminal_failed_hint, false); }, 8000);
                frame.src = url;
            }, function(message) { if (!closed && sequence === requestSequence) failed(message, false); });
        }
        install.addEventListener('click', function() {
            HF.confirm_window({ title: label('install_remote'), message: d.name + '\n' + d.username + '@' + d.host + ':' + d.port + '\n' + label('terminal_install') }).then(function(yes) {
                if (!yes || closed) return;
                HF.request_write(HF.file_endpoint('tool_install_start', owner), { tool: 'ttyd' }, '', function(task) { HF.remote_file_job('install', task, connect); });
            });
        });
        external.addEventListener('click', function() { if (url) window.open(url, '_blank', 'noopener,noreferrer'); });
        connect(); return record;
    };
    if (HF.SystemWindows) HF.SystemWindows.open_terminal = HF.open_terminal;
    var preparingFiles = new Map(), preparedFiles = new Map();
    function invalidateFiles(id) {
        preparedFiles.delete(id);
    }
    HF.ensure_remote_files = function(owner) {
        if (!owner || !owner.device_id) return Promise.resolve();
        var d = devices.get(owner.device_id), revision = owner.device_revision;
        if (!d || typeof revision !== 'string' || revision !== d.revision) return Promise.reject(new Error(label('stale_device')));
        var cached = preparedFiles.get(d.id);
        if (cached && cached.revision === revision && Date.now() - cached.time < 60000) return Promise.resolve(cached.data);
        var key = d.id + ':' + revision;
        if (preparingFiles.has(key)) return preparingFiles.get(key);
        var attempted = Object.create(null);
        function prepare() {
            if (!devices.has(d.id) || devices.get(d.id).revision !== revision) return Promise.reject(new Error(label('stale_device')));
            return request('agent_prepare', { device_id: d.id, device_revision: revision }).catch(function(error) {
                var info = error.data, kind = info && (info.stat_missing ? 'stat' : info.agent_missing ? 'agent' : '');
                if (!kind || attempted[kind] || info.device_revision !== revision || !devices.has(d.id) || devices.get(d.id).revision !== revision) throw error;
                attempted[kind] = true;
                error.stopFallback = true;
                return installRemoteStat(d, kind === 'agent').then(function(ready) {
                    if (!ready) throw error;
                    return prepare();
                }).catch(function(failure) { failure.stopFallback = true; throw failure; });
            });
        }
        var pending = prepare().then(function(data) {
            if (!data.ready || data.device_revision !== revision || !devices.has(d.id) || devices.get(d.id).revision !== revision) throw new Error(label('stale_device'));
            preparedFiles.set(d.id, { revision: revision, time: Date.now(), data: data });
            return data;
        }).finally(function() { preparingFiles.delete(key); });
        preparingFiles.set(key, pending);
        return pending;
    };
    function fileRequest(owner, action, data, retried) {
        return HF.ensure_remote_files(owner).then(function() {
            return request('rpc', Object.assign({}, owner, { rpc_action: action, rpc_data: JSON.stringify(data) }));
        }).then(function(res) {
            if (!res || res.code !== 0) {
                invalidateFiles(owner.device_id);
                if (!retried && res && res.data && res.data.helper_missing && ['list', 'detect_type', 'read_text', 'archive_status', 'thumbnail_generate_status', 'package_install_status', 'terminal_info'].indexOf(action) >= 0) return fileRequest(owner, action, data, true);
            }
            return res;
        }).catch(function(error) { invalidateFiles(owner.device_id); throw error; });
    }
    var localAjax = HF.Util.ajax;
    HF.Util.ajax = function(options) {
        var url = new URL(options.url || '', 'http://harbor.invalid');
        var id = url.searchParams.get('_hf_device');
        if (!id) return localAjax(options);
        var owner = { device_id: id, device_revision: url.searchParams.get('_hf_revision') || '' };
        var action = url.searchParams.get('_hf_action'), data = Object.assign({}, options.data || {});
        url.searchParams.forEach(function(value, key) { if (key.indexOf('_hf_') !== 0) data[key] = value; });
        fileRequest(owner, action, data).then(function(res) {
            if (res && res.data && typeof res.data === 'object') {
                res.data.device_id = id; res.data.device_revision = owner.device_revision;
                if (res.data.missing_tool) res.data.remote_retry = function() { HF.Util.ajax(options); };
                (res.data.items || []).forEach(function(item) { item.device_id = id; item.device_revision = owner.device_revision; });
            }
            if (options.success) options.success(res);
        }).catch(function(error) {
            if (options.success) options.success({ code: 1, message: error.message + (error.uncertain && String(options.type || 'GET').toUpperCase() === 'POST' ? '\n' + label('outcome_unknown') : ''), data: error.data });
        });
    };
    var originalOpenItem = HF.open_item;
    HF.open_item = function(item, force) {
        if (!item || !item.device_id) return originalOpenItem(item, force);
        HF.hide_details(); HF.hide_context_menus();
        if (item.type === 'directory') return HF.open_remote_path(item.device_id, item.path, true);
        if (force || item.preview === 'package' || HF.is_archive_item(item)) return originalOpenItem(item, force);
        HF.request_json(HF.file_endpoint('detect_type', item), { path: item.path }, function(data) {
            item.preview = data.kind === 'text' ? 'text' : data.kind === 'image' ? 'image' : data.kind === 'pdf' ? 'pdf' : data.kind === 'video' || data.kind === 'audio' ? 'video' : 'none';
            originalOpenItem(item);
        });
    };
    ['open_binary', 'open_text', 'open_image', 'open_pdf', 'open_video', 'open_properties', 'trigger_download', 'start_archive_extract'].forEach(function(key) {
        var original = HF[key];
        HF[key] = function(item) {
            if (!item || !item.device_id) return original.apply(HF, arguments);
            var args = Array.prototype.slice.call(arguments);
            HF.ensure_remote_files(item).then(function() {
                var record = original.apply(HF, args);
                if (key === 'open_properties') record = document.getElementById('fm_property_dialog')._fmWindow;
                if (record && record.title_node) record.title_node.textContent = nameOf(item.device_id) + ' · ' + record.title_node.textContent;
            }).catch(function(error) { HF.set_error_status(error.message); });
        };
        if (HF.DocumentWindows && HF.DocumentWindows[key] === original) HF.DocumentWindows[key] = HF[key];
        if (HF.SystemWindows && HF.SystemWindows[key] === original) HF.SystemWindows[key] = HF[key];
        if (HF.FileOperations && HF.FileOperations[key] === original) HF.FileOperations[key] = HF[key];
    });
    if (HF.FileOperations) HF.FileOperations.open_item = HF.open_item;
    HF.remote_file_job = function(kind, data, retry) {
        var owner = HF.file_context(data), job = { data: data, kind: kind };
        var source = document.getElementById(kind === 'archive' ? 'fm_archive_task_dialog' : kind === 'thumbnail' ? 'fm_thumbnail_dialog' : 'fm_package_install_dialog');
        var panel = HF.Util.createElement('div', 'fm-remote-install-panel');
        var body = source.querySelector('.fm-package-install-body').cloneNode(true), fields = Object.create(null);
        body.querySelectorAll('[id]').forEach(function(node) { fields[node.id] = node; node.removeAttribute('id'); });
        panel.appendChild(body);
        var actions = HF.Util.createElement('div', 'fm-dialog-actions');
        var install = button(label('install'), function() {
            var tool = job.data.missing_tool;
            if (!tool) return;
            var d = devices.get(owner.device_id);
            HF.confirm_window({ title: label('install_remote'), message: nameOf(owner.device_id) + '\n' + (d ? d.username + '@' + d.host + ':' + d.port : '') + '\n' + tool }).then(function(yes) {
                if (!yes) return;
                HF.request_write(HF.file_endpoint('tool_install_start', owner), { tool: tool }, '', function(task) { HF.remote_file_job('install', task, retry); });
            });
        });
        var close = button(HF.labels.close, function() { HF.window_manager.close(job.record); });
        actions.appendChild(install); actions.appendChild(close); panel.appendChild(actions);
        job.record = HF.window_manager.create({ title: nameOf(owner.device_id), icon: 'file', className: 'fm-remote-file-job', content: panel, width: 600, height: 500, minWidth: 300, minHeight: 180, persistSize: false, beforeClose: function() { return kind === 'install' || !!job.data.done || !!job.data.missing_tool; } });
        function paint() {
            if (kind === 'archive' || kind === 'thumbnail') {
                (kind === 'archive' ? HF.paint_archive_task : HF.paint_thumbnail_task)(job.data, function(id) {
                    if (id === 'fm_archive_task_title' || id === 'fm_thumbnail_title') return job.record.title_node;
                    if (id === 'fm_archive_task_close' || id === 'fm_archive_task_done' || id === 'fm_thumbnail_close' || id === 'fm_thumbnail_done') return close;
                    if (id === 'fm_archive_install_tool' || id === 'fm_thumbnail_install_tool') return install;
                    return fields[id];
                });
                job.record.title_node.textContent = nameOf(owner.device_id) + ' · ' + job.record.title_node.textContent;
            } else {
                var values = HF.package_install_fields(job.data, null);
                Object.keys(values).forEach(function(key) { if (fields['fm_package_install_' + key]) fields['fm_package_install_' + key].textContent = values[key]; });
                job.record.title_node.textContent = nameOf(owner.device_id) + ' · ' + values.title;
                install.style.display = 'none'; close.disabled = false;
            }
            HF.window_manager.render_taskbar();
        }
        function poll() {
            request('rpc', Object.assign({}, owner, { rpc_action: kind === 'archive' ? 'archive_status' : kind === 'thumbnail' ? 'thumbnail_generate_status' : 'package_install_status', rpc_data: JSON.stringify({ task_id: job.data.task_id }) })).then(function(res) {
                if (!res || res.code !== 0) throw new Error(res && res.message || HF.labels.request_failed);
                job.failures = 0; job.data = Object.assign({}, res.data, owner); paint();
                if (!job.data.done) setTimeout(poll, 1000);
                else {
                    if (job.data.success && activeDevice() === owner.device_id) HF.refresh_current();
                    if (job.data.success && kind === 'install' && retry) retry();
                }
            }).catch(function(error) { job.failures = (job.failures || 0) + 1; job.data.message = label('waiting') + ': ' + error.message; if (job.failures >= 30) { job.data.done = true; job.data.success = false; job.data.state = 'unknown'; job.data.message = label('outcome_unknown'); } paint(); if (!job.data.done) setTimeout(poll, 2000); });
        }
        paint();
        if (data.task_id && !data.done) poll();
        else if (data.success && kind === 'install' && retry) retry();
        return job;
    };
    var localArchiveProgress = HF.start_archive_progress;
    HF.start_archive_progress = function(data) {
        if (!data || !data.device_id) return localArchiveProgress(data);
        return HF.remote_file_job('archive', data);
    };
    var localArchiveMissing = HF.show_archive_missing_tool;
    HF.show_archive_missing_tool = function(res, mode) {
        if (!res || !res.data || !res.data.device_id) return localArchiveMissing(res, mode);
        return HF.remote_file_job('archive', Object.assign({ done: true, success: false, mode: mode, message: res.message }, res.data), res.data.remote_retry);
    };
    var localPackageInstall = HF.start_package_install;
    HF.start_package_install = function(item) {
        if (!item || !item.device_id) return localPackageInstall(item);
        HF.close_file_dialog('fm_package_confirm_dialog');
        HF.request_write(HF.file_endpoint('package_install_start', item), { path: item.path }, '', function(data) { HF.remote_file_job('install', data); });
    };
    var localThumbnails = HF.start_thumbnail_generation;
    HF.start_thumbnail_generation = function(path, owner) {
        owner = owner || HF.file_context();
        if (!owner.device_id) return localThumbnails(path);
        HF.Util.ajax({ url: HF.file_endpoint('thumbnail_generate_start', owner), type: 'POST', dataType: 'json', data: { path: path }, success: function(res) {
            if (res && res.code === 0) HF.remote_file_job('thumbnail', res.data);
            else if (res && res.data && res.data.missing_tool) HF.remote_file_job('thumbnail', Object.assign({ done: true, success: false, dependency_missing: true, path: path, message: res.message }, res.data), res.data.remote_retry);
            else HF.set_error_status(res && res.message || HF.labels.thumbnail_failed);
        } });
    };
    var pathTitle = HF.path_title;
    HF.path_title = function(path) { return activeDevice() ? (path === '/' ? nameOf(activeDevice()) : String(path).split('/').pop()) : pathTitle(path); };
})(window.HarborFile);
