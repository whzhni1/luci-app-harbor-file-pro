
(function (HF) {
    'use strict';

    HF.update_language = function update_language() {
        return String(document.documentElement.lang || '').trim().toLowerCase().replace(/_/g, '-');
    };

    HF.reset_update_result = function reset_update_result() {
        HF.state.update_epoch = (HF.state.update_epoch || 0) + 1;
        var latest = document.getElementById('fm_about_latest');
        var btn = document.getElementById('fm_update_start');
        if (latest) {
            latest.textContent = '…';
        }
        if (btn) {
            btn.style.display = 'none';
        }
    };

    HF.check_update = function check_update() {
        var latest = document.getElementById('fm_about_latest');
        var btn = document.getElementById('fm_update_start');
        var version = document.getElementById('fm_about_version');
        var check = document.getElementById('fm_update_check');
        if (!latest) {
            return;
        }
        HF.reset_update_result();
        var epoch = HF.state.update_epoch;
        check.disabled = true;
        HF.Util.ajax({
            url: HF.api.update_check,
            type: 'GET',
            data: { language: HF.update_language() },
            dataType: 'json',
            success: function(res) {
                check.disabled = false;
                if (epoch !== HF.state.update_epoch) {
                    return;
                }
                var data = (res && res.code === 0 && res.data) || {};
                version.textContent = 'v' + (data.current || '-');
                if (!data.fetcher) {
                    latest.textContent = HF.labels.update_no_tool;
                    return;
                }
                var from_mirror = data.mirror ? ' · ' + data.mirror : '';
                if (data.latest) {
                    latest.textContent = 'v' + data.latest;
                }
                if (data.has_update) {
                    latest.textContent = 'v' + data.latest + ' (' + HF.labels.update_available + from_mirror + ')';
                    btn.style.display = '';
                }
                else if (data.latest) {
                    latest.textContent = 'v' + data.latest + ' (' + HF.labels.up_to_date + from_mirror + ')';
                }
                else {
                    latest.textContent = HF.labels.update_check_failed;
                }
            },
            error: function() {
                check.disabled = false;
                if (epoch !== HF.state.update_epoch) {
                    return;
                }
                latest.textContent = HF.labels.update_check_failed;
            }
        });
    };

    HF.stop_update_poll = function stop_update_poll() {
        if (HF.state.update_poll_timer) {
            clearTimeout(HF.state.update_poll_timer);
            HF.state.update_poll_timer = null;
        }
    };

    HF.set_install_progress = function set_install_progress(visible, percent, text) {
        var wrap = document.getElementById('fm_install_progress_wrap');
        var bar = document.getElementById('fm_install_progress_bar');
        if (!wrap || !bar) {
            return;
        }
        wrap.style.display = visible ? '' : 'none';
        bar.style.width = Math.max(0, Math.min(100, percent || 0)) + '%';
        if (text !== undefined && text !== null) {
            var status = document.getElementById('fm_package_install_status');
            if (status) {
                status.textContent = text;
            }
        }
    };

    HF.poll_update_status = function poll_update_status(task_id) {
        HF.stop_update_poll();
        HF.Util.ajax({
            url: HF.api.update_status,
            type: 'GET',
            data: { task_id: task_id },
            dataType: 'json',
            success: function(res) {
                if (!res || res.code !== 0) {
                    HF.set_error_status((res && res.message) || HF.labels.request_failed);
                    return;
                }
                var task = res.data || {};
                var done = task.done;
                var phase = task.phase;
                var percent = (task.total > 0) ? (task.downloaded * 100 / task.total) : 0;
                var detail = ' ' + HF.format_size(task.downloaded || 0) +
                    ((task.total > 0) ? ' / ' + HF.format_size(task.total) : '');

                if (!done && (phase === 'main' || phase === 'lang')) {
                    HF.set_install_progress(true, percent,
                        (phase === 'lang' ? HF.labels.downloading_lang : HF.labels.downloading_update) + detail);
                }
                else if (!done) {
                    HF.set_install_progress(false, 0, HF.labels.installing_update);
                }

                HF.update_package_install_view({
                    done: done,
                    success: task.success,
                    message: done ? (task.success ? HF.labels.update_finished : HF.labels.install_failed)
                                  : (phase === 'main' || phase === 'lang'
                                      ? (phase === 'lang' ? HF.labels.downloading_lang : HF.labels.downloading_update) + detail
                                      : HF.labels.installing_update),
                    log: task.log,
                    package_type: 'repository',
                    installer: 'update',
                    exit_code: done ? (task.success ? 0 : 1) : undefined
                });
                document.getElementById('fm_package_install_name').textContent = 'Harbor File Pro';
                document.getElementById('fm_package_install_path').textContent =
                    'v-latest (' + (phase || '-') + ')';

                if (!done) {
                    HF.state.update_poll_timer = setTimeout(function() {
                        HF.poll_update_status(task_id);
                    }, 1000);
                    return;
                }
                HF.set_install_progress(false, 0);
                if (task.success) {
                    HF.set_status(HF.labels.update_finished, 'success');
                }
            },
            error: function() {
                HF.state.update_poll_timer = setTimeout(function() {
                    HF.poll_update_status(task_id);
                }, 2000);
            }
        });
    };

    HF.start_update = function start_update() {
        HF.close_modal();
        HF.state.install_item = { name: 'Harbor File Pro', ext: 'repository' };
        HF.update_package_install_view({
            done: false,
            success: false,
            message: HF.labels.downloading_update,
            package_type: 'repository',
            installer: 'update'
        });
        HF.set_install_progress(true, 0, HF.labels.downloading_update);
        HF.open_modal('fm_package_install_dialog');
        HF.request_write(HF.api.update_start, { language: HF.update_language() }, '', function(data) {
            if (data && data.task_id) {
                HF.poll_update_status(data.task_id);
            }
        }, function(message) {
            HF.set_install_progress(false, 0);
            HF.update_package_install_view({
                done: true,
                success: false,
                message: message || HF.labels.install_failed,
                package_type: 'repository',
                installer: 'update'
            });
        });
    };

    HF.prism_request = function prism_request(action, data) {
        return new Promise(function(resolve, reject) {
            var url = HF.api['update_' + action];
            if (!url) { reject(new Error(HF.labels.request_failed)); return; }
            HF.Util.ajax({
                url: url, type: action === 'start' ? 'POST' : 'GET', dataType: 'json',
                timeout: action === 'status' ? 12000 : 45000,
                data: Object.assign({ component: 'prism' }, data || {}),
                success: function(res) {
                    if (res && res.code === 0) resolve(res.data || {});
                    else reject(new Error(res && res.message || HF.labels.request_failed));
                },
                error: function(xhr) { reject(new Error(HF.upload_error_message(xhr, HF.labels.request_failed))); }
            });
        });
    };

    HF.get_prism_assets = function get_prism_assets() {
        if (!HF.prism_assets_promise) {
            var fallback = { current: '1.30.0', bundle: 'prism/builtin/prism.js' };
            HF.prism_assets_promise = HF.prism_request('status').then(function(data) {
                return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(data.current || '') &&
                    /^prism\/(builtin|releases\/[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{16})\/prism\.js$/.test(data.bundle || '') ? data : fallback;
            }).catch(function() { return fallback; }).then(function(data) { HF.prism_loaded_version = data.current; return data; });
        }
        return HF.prism_assets_promise;
    };

    var prism_view = { reading: false, checking: false, starting: false, busy: false, info: null, latest: '', available: false, message: '', timer: null, source: '', epoch: 0, taskId: '' };

    HF.render_prism_tools = function render_prism_tools() {
        var host = document.getElementById('fm_prism_tools');
        if (!host || !HF.settings_tool_row) return;
        HF.clear_node(host);
        var tools = prism_view.info && prism_view.info.tools;
        if (tools && tools.fetcher === 'wget') return;
        var installed = tools && !!tools.fetcher;
        var status = tools ? HF.settings_tool_status(installed) : (prism_view.reading ? HF.tr('Checking') : HF.labels.remote_unknown);
        var row = HF.settings_tool_row('curl', status, HF.tr('Download update resources using curl.'));
        row.dataset.prismTool = 'curl';
        if (tools && !installed) {
            var install = HF.settings_tool_button(HF.labels.remote_install, function() { HF.install_settings_tool('curl'); });
            install.dataset.installTool = 'curl';
            install.disabled = !tools.can_install || prism_view.reading || prism_view.checking || prism_view.starting || prism_view.busy || !!(HF.state.settings_tool_starting || HF.state.install_task && !HF.state.install_task.done);
            if (!tools.can_install) install.title = HF.tr('No supported package manager found');
            row._actions.appendChild(install);
        }
        host.appendChild(row);
    };

    HF.render_prism_settings = function render_prism_settings(load) {
        var toggle = document.getElementById('fm_settings_prism');
        var details = document.getElementById('fm_prism_details');
        if (!toggle || !details) return;
        var source = document.getElementById('fm_prism_source');
        if (source.value !== prism_view.source) {
            prism_view.source = source.value;
            prism_view.epoch++;
            prism_view.checking = false;
            prism_view.latest = '';
            prism_view.available = false;
            prism_view.message = '';
        }
        details.hidden = !toggle.checked;
        if (!toggle.checked) {
            clearTimeout(prism_view.timer);
            prism_view.timer = null;
            return;
        }
        HF.render_prism_tools();
        var info = prism_view.info;
        document.getElementById('fm_prism_version').textContent = HF.tr('Current version') + ': ' + (info && info.current || '1.30.0');
        var support = window.CSS && CSS.highlights && window.Highlight;
        document.getElementById('fm_prism_status').textContent = (support ? '' : HF.tr('This browser uses plain text because range highlighting is unavailable.') + '\n') + (prism_view.message || info && info.notice || '');
        var saving = document.getElementById('fm_settings_editor_save').disabled;
        HF.size_select_to_content(source);
        source.disabled = saving || prism_view.starting || prism_view.busy;
        document.getElementById('fm_prism_check').disabled = saving || prism_view.reading || prism_view.checking || prism_view.starting || prism_view.busy;
        var update = document.getElementById('fm_prism_update');
        update.hidden = !prism_view.available;
        update.textContent = info && prism_view.latest === info.current ? HF.tr('Reinstall') : HF.labels.update_now;
        update.disabled = saving || prism_view.reading || prism_view.checking || prism_view.starting || prism_view.busy;
        if (load && !prism_view.reading && !prism_view.checking && !prism_view.starting) HF.read_prism_status();
    };

    HF.read_prism_status = function read_prism_status() {
        if (prism_view.reading) { prism_view.reload = true; return; }
        prism_view.reading = true;
        HF.render_prism_settings();
        HF.prism_request('status').then(function(data) {
            prism_view.info = data;
            prism_view.available = !!prism_view.latest && !!data.can_update;
            if (!prism_view.latest && !prism_view.message) prism_view.message = data.notice || '';
            var busy = !!(data.task && !data.task.done);
            var source = document.getElementById('fm_prism_source');
            if (busy && data.task.source && Array.from(source.options).some(function(option) { return option.value === data.task.source; })) {
                if (prism_view.source !== data.task.source) prism_view.epoch++;
                source.value = prism_view.source = data.task.source;
                prism_view.latest = '';
                prism_view.available = false;
                prism_view.checking = false;
            }
            if (data.task && data.task.task_id && (busy || prism_view.busy && prism_view.taskId === data.task.task_id)) {
                prism_view.taskId = data.task.task_id;
                prism_view.message = busy ? HF.labels.installing_update : data.task.success ? HF.labels.update_finished : HF.tr('Update failed');
                if (!busy) { prism_view.available = false; prism_view.latest = ''; }
            } else if (prism_view.busy && !busy) {
                prism_view.message = '';
            }
            prism_view.busy = busy;
        }).catch(function(error) {
            if (prism_view.info) prism_view.info = Object.assign({}, prism_view.info, { tools: null });
            prism_view.message = error.message;
            prism_view.available = false;
        }).then(function() {
            prism_view.reading = false;
            HF.render_prism_settings();
            clearTimeout(prism_view.timer);
            if (prism_view.reload) {
                prism_view.reload = false;
                if (!document.getElementById('fm_prism_details').hidden) { HF.read_prism_status(); return; }
            }
            if (prism_view.busy && !document.getElementById('fm_prism_details').hidden)
                prism_view.timer = setTimeout(HF.read_prism_status, 1500);
        });
    };

    HF.check_prism_update = function check_prism_update() {
        HF.render_prism_settings();
        if (prism_view.reading || prism_view.checking || prism_view.starting || prism_view.busy || !document.getElementById('fm_settings_prism').checked) return;
        var epoch = ++prism_view.epoch, source = prism_view.source;
        prism_view.checking = true;
        prism_view.available = false;
        prism_view.latest = '';
        prism_view.message = HF.tr('Checking');
        HF.render_prism_settings();
        HF.prism_request('check', { source: source }).then(function(data) {
            if (epoch !== prism_view.epoch) return;
            prism_view.info = data;
            prism_view.latest = data.latest || '';
            prism_view.available = !!data.latest && !!data.can_update;
            prism_view.message = data.notice || (data.latest === data.current ? HF.labels.up_to_date : data.latest ? HF.labels.latest_version + ': ' + data.latest : HF.labels.update_check_failed);
        }).catch(function(error) { if (epoch === prism_view.epoch) prism_view.message = error.message; }).then(function() {
            if (epoch !== prism_view.epoch) return;
            prism_view.checking = false;
            HF.render_prism_settings();
        });
    };

    HF.start_prism_update = function start_prism_update() {
        HF.render_prism_settings();
        if (!prism_view.available || prism_view.reading || prism_view.checking || prism_view.starting || prism_view.busy || !document.getElementById('fm_settings_prism').checked) return;
        prism_view.starting = true;
        HF.render_prism_settings();
        HF.prism_request('start', { version: prism_view.latest, source: prism_view.source }).then(function(data) {
            prism_view.taskId = data.task_id || '';
            prism_view.starting = false;
            prism_view.busy = true;
            prism_view.available = false;
            prism_view.latest = '';
            HF.read_prism_status();
        }).catch(function(error) {
            prism_view.starting = false;
            prism_view.message = error.message;
            HF.render_prism_settings();
        });
    };
})(window.HarborFile = window.HarborFile || {});
