
(function (HF) {
    HF.format_host_for_url = function format_host_for_url(hostname) {
        var host = String(hostname || '');
        return host.indexOf(':') >= 0 && host.charAt(0) !== '[' ? '[' + host + ']' : host;
    }

    HF.resolve_terminal_target = function resolve_terminal_target(item) {
        if (item && item.type === 'directory') {
            return {
                path: item.path,
                label: item.path === '/' ? HF.labels.system_disk : item.path
            };
        }
        if (item && item.path) {
            var parent = HF.parent_directory(item.path);
            return {
                path: parent,
                label: parent === '/' ? HF.labels.system_disk : parent
            };
        }
        if (HF.state.current && HF.state.current.kind === 'directory') {
            return {
                path: HF.state.current.path,
                label: HF.state.current.path === '/' ? HF.labels.system_disk : HF.state.current.path
            };
        }
        return {
            path: '/',
            label: HF.labels.system_disk
        };
    }

    HF.resolve_terminal_url = function resolve_terminal_url(info, remote_host) {
        var raw = String(info && info.url || '').trim();
        var protocol = Number(info && info.ssl) === 1 ? 'https:' : 'http:';
        var host = HF.format_host_for_url(remote_host || window.location.hostname);
        var origin = remote_host ? protocol + '//' + host : window.location.origin;
        var url = new URL(raw || protocol + '//' + host + ':' + (Number(info && info.port) || 7681) + '/', origin + '/');
        if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error(HF.labels.terminal_failed);
        return url.href;
    };

    HF.set_settings_tab = function set_settings_tab(tab) {
        var next_tab = ['basic', 'editor', 'nginx', 'remote'].indexOf(tab) >= 0 ? tab : 'basic';
        var tabs = document.querySelectorAll('[data-settings-tab]');
        for (var i = 0; i < tabs.length; i++) {
            var active = tabs[i].getAttribute('data-settings-tab') === next_tab;
            tabs[i].classList.toggle('active', active);
            tabs[i].setAttribute('aria-selected', active ? 'true' : 'false');
        }
        document.getElementById('fm_settings_panel_basic').classList.toggle('active', next_tab === 'basic');
        document.getElementById('fm_settings_panel_editor').classList.toggle('active', next_tab === 'editor');
        if (next_tab === 'editor' && HF.render_prism_settings) HF.render_prism_settings(true);
        document.getElementById('fm_settings_panel_nginx').classList.toggle('active', next_tab === 'nginx');
        document.getElementById('fm_settings_panel_remote').classList.toggle('active', next_tab === 'remote');
        if (next_tab === 'remote' && HF.render_remote_settings) HF.render_remote_settings();
    }

    HF.render_nginx_settings = function render_nginx_settings() {
        var web_server = HF.state.preferences.web_server || 'unknown';
        var running = HF.state.preferences.nginx_running === true || web_server === 'nginx';
        var uhttpd_running = !running && web_server === 'uhttpd';
        var title = document.getElementById('fm_web_server_title');
        var status = document.getElementById('fm_nginx_status');
        var install = document.getElementById('fm_nginx_install');
        var options = document.getElementById('fm_nginx_options');
        var uhttpd_options = document.getElementById('fm_uhttpd_options');
        var actions = document.getElementById('fm_nginx_page_actions');
        var fcm_note = document.getElementById('fm_nginx_fcm_note');
        title.textContent = HF.tr('Nginx');
        status.textContent = running || HF.state.preferences.nginx_available ? HF.labels.installed : HF.labels.not_installed;
        status.style.display = 'inline-flex';
        status.classList.toggle('checking', false);
        install.style.display = running ? 'none' : 'inline-flex';
        options.style.display = running ? 'block' : 'none';
        uhttpd_options.style.display = uhttpd_running ? 'block' : 'none';
        actions.style.display = running || uhttpd_running ? 'flex' : 'none';
        fcm_note.style.display = !running && HF.state.preferences.fcm === 1 ? 'block' : 'none';
    }

    HF.refresh_nginx_settings = function refresh_nginx_settings() {
        var status = document.getElementById('fm_nginx_status');
        status.textContent = HF.labels.checking;
        status.style.display = 'inline-flex';
        status.classList.toggle('checking', true);
        document.getElementById('fm_nginx_install').style.display = 'none';
        document.getElementById('fm_uhttpd_options').style.display = 'none';
        document.getElementById('fm_nginx_fcm_note').style.display = 'none';
        HF.Util.ajax({
            url: HF.api.preferences,
            type: 'GET',
            data: { _: Date.now() },
            dataType: 'json',
            success: function(res) {
                if (res && res.code === 0) {
                    HF.apply_preferences(res.data || {});
                }
                HF.render_nginx_settings();
            },
            error: HF.render_nginx_settings
        });
    }

    HF.form_integer_value = function form_integer_value(id, fallback) {
        var value = HF.Util.trim(document.getElementById(id).value || '');
        return value === '' ? fallback : HF.normalize_integer_setting(value, fallback);
    }

    HF.render_nginx_body_size_unit = function render_nginx_body_size_unit() {
        var value = HF.form_integer_value(
            'fm_settings_client_max_body_size',
            HF.state.preferences.client_max_body_size
        );
        document.getElementById('fm_client_max_body_size_unit').textContent =
            value === 0 ? HF.labels.unlimited : 'M';
    }

    HF.sync_uwsgi_toggle_inputs = function sync_uwsgi_toggle_inputs() {
        document.getElementById('fm_settings_reload_on_as').disabled =
            !document.getElementById('fm_settings_reload_on_as_enabled').checked;
        document.getElementById('fm_settings_reload_on_rss').disabled =
            !document.getElementById('fm_settings_reload_on_rss_enabled').checked;
    }

    HF.populate_settings_dialog = function populate_settings_dialog() {
        document.getElementById('fm_settings_view_mode').value = String(HF.state.preferences.view_mode);
        document.getElementById('fm_settings_theme').value = HF.state.preferences.theme || 'auto';
        document.getElementById('fm_settings_full_width').checked = HF.state.preferences.full_width !== 0;
        document.getElementById('fm_settings_home_dir').value = HF.state.preferences.home_dir || '/tmp/root';
        document.getElementById('fm_settings_system_operations').checked = HF.state.preferences.allow_system_operations === 1;
        document.getElementById('fm_settings_show_hidden').checked = HF.state.preferences.show_hidden_files === 1;
        document.getElementById('fm_settings_thumbnails').checked = HF.state.preferences.enable_thumbnails === 1;
        document.getElementById('fm_settings_auto_indent').checked = HF.state.preferences.editor_auto_indent === 1;
        document.getElementById('fm_settings_auto_wrap').checked = HF.state.preferences.editor_auto_wrap === 1;
        document.getElementById('fm_settings_line_numbers').checked = HF.state.preferences.show_line_numbers === 1;
        document.getElementById('fm_settings_prism').checked = HF.state.preferences.editor_prism === 1;
        document.getElementById('fm_prism_source').value = HF.state.preferences.editor_prism_source || 'npmmirror';
        if (HF.render_prism_settings) HF.render_prism_settings();
        document.getElementById('fm_settings_restore_last_directory').checked = HF.state.preferences.restore_last_directory === 1;
        document.getElementById('fm_settings_uwsgi_request_buffering').checked =
            HF.state.preferences.uwsgi_request_buffering === 1;
        document.getElementById('fm_settings_client_max_body_size').value =
            String(HF.state.preferences.client_max_body_size);
        document.getElementById('fm_settings_reload_on_as_enabled').checked =
            HF.state.preferences['reload-on-as_enabled'] === 1;
        document.getElementById('fm_settings_reload_on_as').value =
            String(HF.state.preferences['reload-on-as']);
        document.getElementById('fm_settings_reload_on_rss_enabled').checked =
            HF.state.preferences['reload-on-rss_enabled'] === 1;
        document.getElementById('fm_settings_reload_on_rss').value =
            String(HF.state.preferences['reload-on-rss']);
        document.getElementById('fm_settings_post_buffering').value =
            String(HF.state.preferences['post-buffering']);
        document.getElementById('fm_settings_limit_as').value =
            String(HF.state.preferences['limit-as']);
        document.getElementById('fm_settings_reload_mercy').value =
            String(HF.state.preferences['reload-mercy']);
        document.getElementById('fm_settings_buffer_size').value =
            String(HF.state.preferences['buffer-size']);
        document.getElementById('fm_settings_uhttpd_script_timeout').value =
            String(HF.state.preferences.uhttpd_script_timeout);
        document.getElementById('fm_settings_uhttpd_network_timeout').value =
            String(HF.state.preferences.uhttpd_network_timeout);
        HF.render_nginx_body_size_unit();
        HF.sync_uwsgi_toggle_inputs();
    }

    HF.open_settings_dialog = function open_settings_dialog() {
        if (HF.glass_record && !HF.glass_record.closed) {
            HF.window_manager.restore(HF.glass_record);
            return;
        }
        HF.load_preferences(function() {
            HF.populate_settings_dialog();
            HF.set_settings_tab('basic');
            HF.render_nginx_settings();
            HF.open_modal('fm_settings_dialog');
            HF.refresh_nginx_settings();
        });
    }

    HF.save_basic_settings_dialog = function save_basic_settings_dialog() {
        var next_view_mode = Number(document.getElementById('fm_settings_view_mode').value);
        var next_home_dir = HF.Util.trim(document.getElementById('fm_settings_home_dir').value || '') || '/tmp/root';
        var next_system_operations = document.getElementById('fm_settings_system_operations').checked ? 1 : 0;
        var next_show_hidden = document.getElementById('fm_settings_show_hidden').checked ? 1 : 0;
        var next_thumbnails = document.getElementById('fm_settings_thumbnails').checked ? 1 : 0;
        var next_restore_dir = document.getElementById('fm_settings_restore_last_directory').checked ? 1 : 0;
        if (next_home_dir.charAt(0) !== '/') {
            HF.set_warning_status(HF.labels.invalid_path);
            return;
        }
        HF.save_preferences({
            section: 'basic',
            view_mode: next_view_mode,
            theme: document.getElementById('fm_settings_theme').value,
            full_width: document.getElementById('fm_settings_full_width').checked ? 1 : 0,
            home_dir: next_home_dir,
            show_hidden_files: next_show_hidden,
            allow_system_operations: next_system_operations,
            enable_thumbnails: next_thumbnails,
            restore_last_directory: next_restore_dir
        }, HF.labels.settings_saved, function(data) {
            HF.apply_preferences(data);
            HF.refresh_navigation(HF.refresh_current);
        });
    }

    HF.save_editor_settings_dialog = function save_editor_settings_dialog() {
        var save = document.getElementById('fm_settings_editor_save');
        if (save.disabled) return;
        var controls = ['fm_settings_auto_indent', 'fm_settings_auto_wrap', 'fm_settings_prism', 'fm_settings_line_numbers', 'fm_settings_editor_save', 'fm_settings_editor_cancel', 'fm_prism_source'].map(function(id) { return document.getElementById(id); });
        var record = document.getElementById('fm_settings_dialog')._fmWindow;
        var before = record && record.before_close;
        if (record) record.before_close = function() { return false; };
        var values = { section: 'editor', editor_prism_source: document.getElementById('fm_prism_source').value };
        ['editor_auto_indent', 'editor_auto_wrap', 'editor_prism', 'show_line_numbers'].forEach(function(key, index) { values[key] = controls[index].checked ? 1 : 0; });
        controls.forEach(function(node) { node.disabled = true; });
        function finish() {
            controls.forEach(function(node) { node.disabled = false; });
            if (record) record.before_close = before;
            if (HF.render_prism_settings) HF.render_prism_settings();
        }
        HF.save_preferences(values, HF.labels.settings_saved, finish, finish);
    };

    HF.save_uhttpd_settings_dialog = function save_uhttpd_settings_dialog() {
        var button = document.getElementById('fm_settings_nginx_save');
        var script_timeout = HF.form_integer_value(
            'fm_settings_uhttpd_script_timeout',
            HF.state.preferences.uhttpd_script_timeout
        );
        var network_timeout = HF.form_integer_value(
            'fm_settings_uhttpd_network_timeout',
            HF.state.preferences.uhttpd_network_timeout
        );
        button.disabled = true;
        HF.save_preferences({
            section: 'web_server',
            uhttpd_script_timeout: script_timeout,
            uhttpd_network_timeout: network_timeout
        }, HF.labels.web_server_settings_saved, function(data) {
            button.disabled = false;
            HF.apply_preferences(data || {});
        }, function() {
            button.disabled = false;
        });
    }

    HF.save_nginx_settings_dialog = function save_nginx_settings_dialog() {
        var button = document.getElementById('fm_settings_nginx_save');
        var buffering = document.getElementById('fm_settings_uwsgi_request_buffering').checked ? 1 : 0;
        var body_size = HF.form_integer_value(
            'fm_settings_client_max_body_size',
            HF.state.preferences.client_max_body_size
        );
        var reload_on_as = HF.form_integer_value('fm_settings_reload_on_as', HF.state.preferences['reload-on-as']);
        var reload_on_rss = HF.form_integer_value('fm_settings_reload_on_rss', HF.state.preferences['reload-on-rss']);
        var post_buffering = HF.form_integer_value('fm_settings_post_buffering', HF.state.preferences['post-buffering']);
        var limit_as = HF.form_integer_value('fm_settings_limit_as', HF.state.preferences['limit-as']);
        var reload_mercy = HF.form_integer_value('fm_settings_reload_mercy', HF.state.preferences['reload-mercy']);
        var buffer_size = HF.form_integer_value('fm_settings_buffer_size', HF.state.preferences['buffer-size']);
        body_size = Math.max(0, Math.min(1024, body_size));
        if (HF.state.preferences.nginx_running !== true) {
            HF.open_nginx_install_confirm();
            return;
        }
        button.disabled = true;
        HF.save_preferences({
            section: 'web_server',
            uwsgi_request_buffering: buffering,
            client_max_body_size: body_size,
            'reload-on-as_enabled': document.getElementById('fm_settings_reload_on_as_enabled').checked ? 1 : 0,
            'reload-on-as': reload_on_as,
            'reload-on-rss_enabled': document.getElementById('fm_settings_reload_on_rss_enabled').checked ? 1 : 0,
            'reload-on-rss': reload_on_rss,
            'post-buffering': post_buffering,
            'limit-as': limit_as,
            'reload-mercy': reload_mercy,
            'buffer-size': buffer_size
        }, HF.labels.nginx_settings_saved, function(data) {
            button.disabled = false;
            HF.apply_preferences(data || {});
        }, function() {
            button.disabled = false;
        });
    }

    HF.save_web_server_settings_dialog = function save_web_server_settings_dialog() {
        if (HF.state.preferences.web_server === 'uhttpd' && HF.state.preferences.nginx_running !== true) {
            HF.save_uhttpd_settings_dialog();
            return;
        }
        HF.save_nginx_settings_dialog();
    }

    HF.use_recommended_nginx_settings = function use_recommended_nginx_settings() {
        document.getElementById('fm_settings_client_max_body_size').value = '0';
        document.getElementById('fm_settings_uwsgi_request_buffering').checked = false;
        document.getElementById('fm_settings_reload_on_as_enabled').checked = false;
        document.getElementById('fm_settings_reload_on_as').value = '256';
        document.getElementById('fm_settings_reload_on_rss_enabled').checked = false;
        document.getElementById('fm_settings_reload_on_rss').value = '192';
        document.getElementById('fm_settings_limit_as').value = '16000';
        document.getElementById('fm_settings_post_buffering').value = '0';
        document.getElementById('fm_settings_reload_mercy').value = '16';
        document.getElementById('fm_settings_buffer_size').value = '10000';
        HF.render_nginx_body_size_unit();
        HF.sync_uwsgi_toggle_inputs();
        HF.save_nginx_settings_dialog();
    }

    HF.open_nginx_install_confirm = function open_nginx_install_confirm() {
        HF.close_modal();
        document.getElementById('fm_nginx_confirm_start').disabled = false;
        HF.open_modal('fm_nginx_confirm_dialog');
    }

    HF.stop_nginx_install_timers = function stop_nginx_install_timers() {
        if (HF.state.nginx_install_countdown_timer) {
            clearTimeout(HF.state.nginx_install_countdown_timer);
            HF.state.nginx_install_countdown_timer = null;
        }
    }

    HF.nginx_https_url = function nginx_https_url() {
        var hostname = window.location.hostname || window.location.host;
        if (hostname.indexOf(':') >= 0 && hostname.charAt(0) !== '[') {
            hostname = '[' + hostname + ']';
        }
        return 'https://' + hostname + '/';
    }

    HF.begin_nginx_restart_countdown = function(job) {
        HF.stop_nginx_install_timers();
        var seconds = 60;
        function tick() {
            if (HF.state.install_job !== job) { HF.stop_nginx_install_timers(); return; }
            job.data.message = HF.format_label(HF.labels.nginx_restart_countdown, seconds);
            HF.update_package_install_view(job.data);
            if (seconds-- <= 0) { HF.state.nginx_install_countdown_timer = null; window.location.replace(HF.nginx_https_url()); return; }
            HF.state.nginx_install_countdown_timer = setTimeout(tick, 1000);
        }
        tick();
    };

    HF.start_nginx_install = function() {
        HF.close_file_dialog('fm_nginx_confirm_dialog');
        return HF.install_plugin({ name: 'nginx-ssl-util luci-nginx', action: 'nginx_install_start', params: {}, verify: function() { return HF.check_dependency('nginx', {}); },
            on_start: HF.begin_nginx_restart_countdown, on_error: function(data, job) { if (HF.state.install_job === job) HF.stop_nginx_install_timers(); }, on_close: HF.stop_nginx_install_timers });
    };

    HF.open_modal = function open_modal(id) {
        HF.hide_item_hover_card();
        var dialog = document.getElementById(id);
        
        var display_mode = 'flex';
        document.getElementById('fm_modal_mask').style.display = 'none';
        if (HF.window_manager && HF.window_manager.open_legacy) {
            HF.window_manager.open_legacy(dialog, display_mode);
            return;
        }
        dialog.style.display = display_mode;
    }

    HF.create_terminal_window = function create_terminal_window(options) {
        var owner = HF.file_context(options.owner || {});
        var fields = Object.create(null), closed = false, timer = null, sequence = 0, url = '', installing = false, dependency = null;
        var panel = document.getElementById('fm_terminal_dialog').querySelector('.fm-terminal-shell').cloneNode(true);
        panel.querySelectorAll('[id]').forEach(function(node) { fields[node.id] = node; node.removeAttribute('id'); });
        var frame = fields.fm_terminal_frame, loading = fields.fm_terminal_loading, failure = fields.fm_terminal_error;
        var install = fields.fm_terminal_install_tool, external = fields.fm_terminal_open_external;
        var record = HF.window_manager.create({ title: options.title, icon: 'terminal', className: 'fm-remote-terminal', content: panel, width: 820, height: 590, minWidth: 390, minHeight: 270,
            onClose: function() { closed = true; sequence++; clearTimeout(timer); frame.onload = null; frame.onerror = null; frame.remove(); }
        });
        var controls = record.element.querySelector('.fm-window-controls');
        function openExternal() { if (url) window.open(url, '_blank', 'noopener,noreferrer'); }
        var externalControl = HF.window_manager.add_control(controls, 'external', '↗', HF.labels.open_terminal_external, openExternal);
        controls.insertBefore(externalControl, controls.firstChild); externalControl.disabled = true;
        var reconnect = HF.window_manager.add_control(controls, 'reconnect', '↻', HF.labels.refresh, connect);
        controls.insertBefore(reconnect, controls.firstChild);
        function failed(message, missing) {
            clearTimeout(timer); loading.classList.remove('show'); failure.classList.add('show');
            fields.fm_terminal_error_text.textContent = HF.labels.terminal_failed;
            fields.fm_terminal_error_hint.textContent = message;
            install.style.display = missing ? '' : 'none'; external.style.display = url ? '' : 'none';
        }
        function offerInstall(offer) {
            if (closed || installing) return;
            var requestSequence = sequence;
            installing = true; install.disabled = true;
            function finished() { installing = false; install.disabled = false; }
            HF.start_terminal_tool_install(function() { finished(); if (!closed && requestSequence === sequence) connect(true); }, finished, owner, dependency, offer);
        }
        function connect(retried) {
            if (closed) return;
            var requestSequence = ++sequence;
            frame.onload = null; frame.onerror = null;
            var next = frame.cloneNode(false); next.src = 'about:blank'; frame.replaceWith(next); frame = next;
            url = ''; externalControl.disabled = true;
            clearTimeout(timer); failure.classList.remove('show'); loading.classList.add('show');
            install.style.display = 'none'; external.style.display = 'none';
            fields.fm_terminal_loading_hint.textContent = options.title + ' · ' + owner.path;
            HF.request_json(HF.file_endpoint('terminal_info', owner), {}, function(info) {
                HF.check_dependency('ttyd', owner, info).then(function(info) {
                    if (closed || sequence !== requestSequence) return;
                    dependency = info;
                    if (!info.available) { failed(HF.labels.terminal_service_missing, true); if (retried !== true) offerInstall(true); return; }
                    try { url = HF.resolve_terminal_url(info, options.host); externalControl.disabled = false; } catch (error) { return failed(error.message, false); }
                    if (window.location.protocol === 'https:' && /^http:/i.test(url)) return failed(HF.labels.terminal_https_hint, false);
                    frame.onload = function() { if (closed || sequence !== requestSequence) return; clearTimeout(timer); loading.classList.remove('show'); failure.classList.remove('show'); };
                    frame.onerror = function() { if (!closed && sequence === requestSequence) failed(HF.labels.terminal_failed_hint, false); };
                    timer = setTimeout(function() { if (!closed && sequence === requestSequence) failed(HF.labels.terminal_failed_hint, false); }, 8000);
                    frame.src = url;
                }, function(error) { if (!closed && sequence === requestSequence) failed(error.message, false); });
            }, function(message) { if (!closed && sequence === requestSequence) failed(message, false); });
        }
        install.addEventListener('click', offerInstall);
        external.addEventListener('click', openExternal);
        connect(); return record;
    };

    HF.open_terminal = function open_terminal(item) {
        HF.hide_context_menus(); HF.hide_details();
        return HF.create_terminal_window({ owner: HF.resolve_terminal_target(item), title: HF.labels.terminal });
    };

    HF.close_package_install = function close_package_install() {
        if (HF.state.install_task && !HF.state.install_task.done) return;
        var dialog = document.getElementById('fm_package_install_dialog');
        if (dialog._fmWindow && HF.window_manager) HF.window_manager.close(dialog._fmWindow);
        else dialog.style.display = 'none';
        HF.stop_install_poll();
        HF.state.install_item = null;
        HF.state.install_task = null;
    }

    HF.close_modal = function close_modal() {
        if (getComputedStyle(document.getElementById('fm_package_install_dialog')).display !== 'none') {
            HF.close_package_install();
            return;
        }
        if (HF.state.archive_task && !HF.state.archive_task.done &&
                document.getElementById('fm_archive_task_dialog').style.display !== 'none') {
            return;
        }
        HF.property_size_token = (HF.property_size_token || 0) + 1;
        if (HF.state.target_picker) HF.close_target_dialog();
        var cancel_pending = document.getElementById('fm_overwrite_dialog').style.display !== 'none' && HF.state.pending_upload;
        var dialogs = document.querySelectorAll('.fm-dialog');
        for (var i = 0; i < dialogs.length; i++) {
            if (!dialogs[i]._fmWindow || !dialogs[i]._fmWindow.options.keepOnModalClose) dialogs[i].style.display = 'none';
        }
        document.getElementById('fm_modal_mask').style.display = 'none';
        if (HF.window_manager && HF.window_manager.close_all_legacy) {
            HF.window_manager.close_all_legacy();
        }

        if (cancel_pending) {
            HF.state.pending_upload = null;
            HF.state.uploading = false;
            HF.update_toolbar();
            document.getElementById('fm_upload_panel').className = 'fm-upload-panel';
        }
        HF.stop_archive_poll();
        HF.state.name_action = null;
        HF.state.delete_item = null;
        HF.state.delete_items = [];
        HF.state.transfer_action = null;
        if (!HF.state.install_job) HF.state.install_item = null;
        HF.state.archive_items = [];
        HF.state.archive_task = null;
    }

    HF.updatePermissionCheckboxes = function updatePermissionCheckboxes(modeStr) {
        var mode = parseInt(modeStr, 8);
        if (isNaN(mode)) mode = 0;
        var checks = document.querySelectorAll('.perm-check');
        checks.forEach(function(cb, index) {
            cb.checked = (mode & (1 << HF.permBits[index])) !== 0;
        });
    }

    HF.getModeFromCheckboxes = function getModeFromCheckboxes() {
        var checks = document.querySelectorAll('.perm-check');
        var mode = 0;
        checks.forEach(function(cb, index) {
            if (cb.checked) mode |= (1 << HF.permBits[index]);
        });
        return mode.toString(8).padStart(3, '0');
    }
    
    HF.measure_property_directory = function measure_property_directory(item, token) {
        var field = document.getElementById('fm_property_size');
        var dialog = document.getElementById('fm_property_dialog');
        var pending = [item.path], visited = new Set();
        var size = 0, files = 0, folders = 0, skipped = 0;
        function active() {
            return HF.property_size_token === token &&
                (dialog._fmWindow ? !dialog._fmWindow.closed : dialog.style.display !== 'none');
        }
        function show(done) {
            field.textContent = (done ? '' : HF.labels.folder_size_loading + ' · ') +
                (skipped ? '≥ ' : '') + HF.format_size(size) + ' (' + size + ' ' + HF.labels.bytes + ')' +
                ' · ' + files + ' ' + HF.labels.files + ' · ' + folders + ' ' + HF.labels.folders +
                (skipped ? ' · ' + HF.labels.skip + ': ' + skipped : '');
        }
        function next() {
            if (!active()) return;
            if (!pending.length) { show(true); return; }
            var path = pending.pop();
            HF.request_json(HF.file_endpoint('list', item), { path: path, directory_size: 1 }, function(data) {
                if (!active()) return;
                if (!visited.has(data.identity)) {
                    visited.add(data.identity);
                    if (path !== item.path) folders++;
                    size += Number(data.size || 0);
                    files += Number(data.files || 0);
                    skipped += Number(data.skipped || 0);
                    (data.directories || []).forEach(function(child) { pending.push(child); });
                }
                show(false);
                setTimeout(next, 0);
            }, function(message) {
                if (!active()) return;
                if (path === item.path) { field.textContent = message || HF.labels.request_failed; return; }
                skipped++;
                show(false);
                setTimeout(next, 0);
            });
        }
        field.textContent = HF.labels.folder_size_loading;
        next();
    };

    HF.open_properties = function open_properties(item) {
        if (!item) {
            return;
        }
        var size_token = HF.property_size_token = (HF.property_size_token || 0) + 1;
        document.getElementById('fm_property_icon').src = HF.icon_url(item.icon_name || HF.item_icon_name(item, 'file'));
        document.getElementById('fm_property_name').textContent = item.name;
        document.getElementById('fm_property_path').textContent = item.path;
        document.getElementById('fm_property_type').textContent = item.display_type;
        document.getElementById('fm_property_size').textContent = item.display_size;
        document.getElementById('fm_property_mtime').textContent = item.display_mtime;
        HF.render_sha256(document.getElementById('fm_property_sha256'), item, true);
        
        var mode = item.mode || '---';
        document.getElementById('fm_property_mode_text').textContent = mode;
        document.getElementById('fm_property_mode_input').value = mode;
        HF.updatePermissionCheckboxes(mode);

        var recursive = document.getElementById('fm_property_recursive');
        var directories = document.getElementById('fm_property_recursive_directories');
        var directory = item.type === 'directory' && !item.is_symlink;
        var save = document.getElementById('fm_property_mode_save');
        function update_recursive_scope() {
            var enabled = directory && recursive.checked;
            document.getElementById('fm_property_recursive_directories_option').style.display = enabled ? 'flex' : 'none';
            recursive.disabled = !directory || save.disabled;
            directories.disabled = !enabled || save.disabled;
        }
        function reset_recursive_scope() {
            recursive.checked = false;
            directories.checked = true;
            update_recursive_scope();
        }
        recursive.onchange = function() {
            directories.checked = true;
            update_recursive_scope();
        };
        save.disabled = false;
        reset_recursive_scope();
        document.getElementById('fm_property_recursive_option').style.display = directory ? 'flex' : 'none';
        document.getElementById('fm_property_mode_edit').style.display = 'none';

        document.getElementById('fm_property_edit_mode').onclick = function() {
            reset_recursive_scope();
            document.getElementById('fm_property_mode_input').value = mode;
            HF.updatePermissionCheckboxes(mode);
            document.getElementById('fm_property_mode_edit').style.display = 'contents';
        };

        document.getElementById('fm_property_mode_cancel').onclick = function() {
            reset_recursive_scope();
            document.getElementById('fm_property_mode_edit').style.display = 'none';
            document.getElementById('fm_property_mode_input').value = mode;
            HF.updatePermissionCheckboxes(mode);
        };

        save.onclick = function() {
            if (save.disabled) return;
            var newMode = document.getElementById('fm_property_mode_input').value.trim();
            if (!/^[0-7]{3,4}$/.test(newMode)) {
                HF.set_warning_status(HF.tr('Invalid permissions'));
                return;
            }
            var apply_recursive = directory && recursive.checked;
            var apply_directories = directories.checked;
            save.disabled = true;
            update_recursive_scope();
            HF.Util.ajax({
                url: HF.file_endpoint('chmod', item),
                type: 'POST',
                data: { path: item.path, mode: newMode, recursive: apply_recursive ? '1' : '0', recursive_directories: apply_directories ? '1' : '0' },
                dataType: 'json',
                success: function(res) {
                    if (HF.property_size_token !== size_token) return;
                    save.disabled = false;
                    update_recursive_scope();
                    if (res && res.code === 0) {
                        HF.set_status(HF.tr('Permissions updated'), 'success');
                        reset_recursive_scope();
                        if (!apply_recursive || apply_directories) mode = newMode;
                        document.getElementById('fm_property_mode_text').textContent = mode;
                        document.getElementById('fm_property_mode_edit').style.display = 'none';
                        HF.refresh_after_write(item.path);
                    } else {
                        HF.set_error_status(res && res.message || HF.tr('Update failed'));
                    }
                },
                error: function() {
                    if (HF.property_size_token !== size_token) return;
                    save.disabled = false;
                    update_recursive_scope();
                    HF.set_error_status(HF.tr('Update failed'));
                }
            });
        };

        document.getElementById('fm_property_mode_input').addEventListener('input', function() {
            var val = this.value;
            if (/^[0-7]{0,4}$/.test(val)) {
                HF.updatePermissionCheckboxes(val);
            }
        });

        document.querySelectorAll('.perm-check').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var mode = HF.getModeFromCheckboxes();
                document.getElementById('fm_property_mode_input').value = mode;
            });
        });
        HF.open_modal('fm_property_dialog');
        if (item.type === 'directory' && !item.is_symlink) HF.measure_property_directory(item, size_token);
    }

    HF.open_glass_tuner = function open_glass_tuner() {
        var manager = HF.window_manager;
        if (HF.glass_record && !HF.glass_record.closed) {
            manager.restore(HF.glass_record);
            return;
        }
        var settings = document.getElementById('fm_settings_dialog');
        var settings_record = settings && settings._fmWindow;
        var theme_input = document.getElementById('fm_settings_theme');
        var baseline = HF.glass_values(HF.state.preferences);
        var draft = Object.assign({ theme: theme_input.value || HF.state.preferences.theme }, baseline);
        var busy = false;
        var saved = false;
        var profile = '';
        var inputs = {};
        var outputs = {};
        var content = document.createElement('div');
        content.className = 'fm-glass-tuner-content';
        function element(tag, parent, text, className) {
            var node = HF.Util.createElement(tag, className, text ? HF.tr(text) : '');
            parent.appendChild(node);
            return node;
        }
        var theme_label = element('label', content, 'Theme', 'fm-glass-field');
        var theme = element('select', theme_label, '', 'fm-form-select');
        theme.id = 'fm_glass_theme';
        ['auto', 'light', 'dark'].forEach(function(mode) {
            var option = element('option', theme, mode === 'auto' ? 'Auto' : mode === 'light' ? 'Light' : 'Dark');
            option.value = mode;
        });
        var current = element('div', content, '', 'fm-glass-current');
        current.setAttribute('aria-live', 'polite');
        ['transparency', 'blur'].forEach(function(kind) {
            var label = element('label', content, '', 'fm-glass-field');
            var heading = element('span', label, '', 'fm-glass-slider-heading');
            element('span', heading, kind === 'transparency' ? 'Transparency' : 'Blur');
            outputs[kind] = element('output', heading);
            var input = element('input', label);
            input.id = 'fm_glass_' + kind;
            outputs[kind].htmlFor = input.id;
            input.type = 'range';
            input.min = '0';
            input.max = kind === 'transparency' ? '60' : '32';
            input.step = '1';
            input.addEventListener('input', function() {
                if (busy) return;
                draft['glass_' + profile + '_' + kind] = Number(input.value);
                HF.apply_theme();
            });
            inputs[kind] = input;
        });
        var error = element('div', content, '', 'fm-glass-error');
        error.setAttribute('role', 'alert');
        var resets = element('div', content, '', 'fm-glass-actions');
        var actions = element('div', content, '', 'fm-glass-actions');
        function button(parent, text, action, primary) {
            var node = element('button', parent, text, 'fm-dialog-action' + (primary ? ' primary' : ''));
            node.type = 'button';
            node.addEventListener('click', action);
            return node;
        }
        button(resets, 'Reset current', function() {
            if (busy) return;
            ['transparency', 'blur'].forEach(function(kind) {
                var key = 'glass_' + profile + '_' + kind;
                draft[key] = HF.glass_defaults[key];
            });
            HF.apply_theme();
        });
        button(resets, 'Reset all appearance', function() {
            if (busy) return;
            Object.assign(draft, HF.glass_defaults, { theme: 'auto' });
            HF.apply_theme();
        });
        button(actions, 'Cancel', function() { manager.close(record); });
        function set_busy(value) {
            busy = value;
            record.element.setAttribute('aria-busy', value ? 'true' : 'false');
            content.querySelectorAll('input, select, button').forEach(function(node) { node.disabled = value; });
            record.close_button.disabled = value;
        }
        button(actions, 'Save', function() {
            if (busy) return;
            var values = { section: 'appearance', theme: draft.theme };
            Object.keys(baseline).forEach(function(key) {
                if (baseline[key] !== draft[key]) values[key] = draft[key];
            });
            error.textContent = '';
            set_busy(true);
            HF.save_preferences(values, HF.labels.settings_saved, function() {
                saved = true;
                set_busy(false);
                manager.close(record);
            }, function() {
                set_busy(false);
                error.textContent = HF.tr('Save failed. Your draft is kept; retry or cancel.');
            });
        }, true);
        HF.glass_draft = draft;
        HF.refresh_glass_tuner = function(active) {
            profile = active;
            theme.value = draft.theme;
            current.textContent = HF.tr('Current profile') + ': ' + HF.tr(active === 'dark' ? 'Dark' : 'Light');
            ['transparency', 'blur'].forEach(function(kind) {
                var value = draft['glass_' + active + '_' + kind];
                inputs[kind].value = String(value);
                outputs[kind].value = value + (kind === 'transparency' ? '%' : ' px');
                inputs[kind].setAttribute('aria-valuetext', outputs[kind].value);
            });
        };
        theme.addEventListener('change', function() {
            if (busy) return;
            draft.theme = theme.value;
            HF.apply_theme();
        });
        if (settings_record) manager.minimize(settings_record);
        var record = manager.create({
            title: HF.tr('Glass appearance'),
            className: 'fm-glass-tuner',
            content: content,
            width: 370,
            height: 430,
            minWidth: 280,
            minHeight: 200,
            keepInViewport: true,
            persistSize: false,
            beforeClose: function() { return !busy; },
            onClose: function() {
                document.removeEventListener('keydown', escape, true);
                HF.glass_draft = null;
                HF.glass_record = null;
                HF.refresh_glass_tuner = null;
                if (saved) theme_input.value = HF.state.preferences.theme;
                HF.apply_theme();
                if (settings_record && !settings_record.closed) {
                    manager.restore(settings_record);
                    document.getElementById('fm_settings_glass_adjust').focus({ preventScroll: true });
                }
            }
        });
        function escape(event) {
            if (event.key !== 'Escape' || manager.active !== record && !(record.minimized && !manager.active)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            manager.close(record);
        }
        document.addEventListener('keydown', escape, true);
        HF.glass_record = record;
        var header = record.element.querySelector('.fm-window-titlebar');
        header.tabIndex = 0;
        header.setAttribute('aria-label', HF.tr('Move panel with arrow keys'));
        header.addEventListener('keydown', function(event) {
            if (event.target !== header || !/^Arrow(Left|Right|Up|Down)$/.test(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            var rect = Object.assign({}, record.rect);
            var step = event.shiftKey ? 10 : 2;
            if (event.key === 'ArrowLeft') rect.left -= step;
            if (event.key === 'ArrowRight') rect.left += step;
            if (event.key === 'ArrowUp') rect.top -= step;
            if (event.key === 'ArrowDown') rect.top += step;
            manager.apply_rect(record, rect);
        });
        HF.apply_theme();
        inputs.transparency.focus({ preventScroll: true });
    };

    HF.SystemWindows = {
        open_modal: HF.open_modal,
        close_modal: HF.close_modal,
        open_properties: HF.open_properties,
        open_settings: HF.open_settings_dialog,
        open_terminal: HF.open_terminal,
        open_nginx_install_confirm: HF.open_nginx_install_confirm,
        start_nginx_install: HF.start_nginx_install
    };
})(window.HarborFile = window.HarborFile || {});
