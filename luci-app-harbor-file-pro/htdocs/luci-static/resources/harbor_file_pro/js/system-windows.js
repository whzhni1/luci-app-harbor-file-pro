
(function (HF) {
    HF.format_host_for_url = function format_host_for_url(hostname) {
        var host = String(hostname || '');
        return host.indexOf(':') >= 0 ? '[' + host + ']' : host;
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

    HF.resolve_terminal_url = function resolve_terminal_url(info) {
        var raw = String(info && info.url || '').trim();
        var https_page = window.location.protocol === 'https:';

        if (raw) {
            if (raw.charAt(0) === '/') {
                return window.location.origin + raw;
            }
            if (/^https?:\/\//i.test(raw)) {
                if (https_page) {
                    return raw;
                }
            }
        }

        
        var protocol = (https_page || Number(info && info.ssl) === 1) ? 'https:' : 'http:';
        var host = HF.format_host_for_url(window.location.hostname);
        var port = Number(info && info.port) || 7681;
        return protocol + '//' + host + ':' + port + '/';
    };

    HF.set_settings_tab = function set_settings_tab(tab) {
        var next_tab = tab === 'nginx' ? 'nginx' : 'basic';
        var tabs = document.querySelectorAll('[data-settings-tab]');
        for (var i = 0; i < tabs.length; i++) {
            var active = tabs[i].getAttribute('data-settings-tab') === next_tab;
            tabs[i].classList.toggle('active', active);
            tabs[i].setAttribute('aria-selected', active ? 'true' : 'false');
        }
        document.getElementById('fm_settings_panel_basic').classList.toggle('active', next_tab === 'basic');
        document.getElementById('fm_settings_panel_nginx').classList.toggle('active', next_tab === 'nginx');
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
        status.textContent = running ? HF.labels.installed : HF.labels.not_installed;
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
        document.getElementById('fm_settings_home_dir').value = HF.state.preferences.home_dir || '/tmp/root';
        document.getElementById('fm_settings_system_operations').checked = HF.state.preferences.allow_system_operations === 1;
        document.getElementById('fm_settings_show_hidden').checked = HF.state.preferences.show_hidden_files === 1;
        document.getElementById('fm_settings_thumbnails').checked = HF.state.preferences.enable_thumbnails === 1;
        document.getElementById('fm_settings_auto_indent').checked = HF.state.preferences.editor_auto_indent === 1;
        document.getElementById('fm_settings_auto_wrap').checked = HF.state.preferences.editor_auto_wrap === 1;
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
        var next_auto_indent = document.getElementById('fm_settings_auto_indent').checked ? 1 : 0;
        var next_auto_wrap = document.getElementById('fm_settings_auto_wrap').checked ? 1 : 0;
        var next_restore_dir = document.getElementById('fm_settings_restore_last_directory').checked ? 1 : 0;
        if (next_home_dir.charAt(0) !== '/') {
            HF.set_warning_status(HF.labels.invalid_path);
            return;
        }
        HF.save_preferences({
            section: 'basic',
            view_mode: next_view_mode,
            home_dir: next_home_dir,
            show_hidden_files: next_show_hidden,
            allow_system_operations: next_system_operations,
            enable_thumbnails: next_thumbnails,
            editor_auto_indent: next_auto_indent,
            editor_auto_wrap: next_auto_wrap,
            restore_last_directory: next_restore_dir
        }, HF.labels.settings_saved, function(data) {
            HF.close_modal();
            HF.apply_preferences(data);
            HF.refresh_navigation(HF.refresh_current);
        });
    }

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
            HF.close_modal();
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
            HF.close_modal();
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

    HF.begin_nginx_restart_countdown = function begin_nginx_restart_countdown() {
        if (HF.state.nginx_install_countdown_timer) {
            return;
        }
        document.getElementById('fm_nginx_spinner').style.display = 'block';
        document.getElementById('fm_nginx_install_actions').style.display = 'none';
        var seconds = 60;
        var tick = function() {
            document.getElementById('fm_nginx_install_text').textContent =
                HF.format_label(HF.labels.nginx_restart_countdown, seconds);
            if (seconds <= 0) {
                HF.state.nginx_install_countdown_timer = null;
                window.location.replace(HF.nginx_https_url());
                return;
            }
            seconds--;
            HF.state.nginx_install_countdown_timer = setTimeout(tick, 1000);
        };
        tick();
    }

    HF.fail_nginx_install = function fail_nginx_install(message) {
        HF.stop_nginx_install_timers();
        HF.state.nginx_installing = false;
        document.getElementById('fm_nginx_spinner').style.display = 'none';
        document.getElementById('fm_nginx_install_text').textContent =
            message || HF.labels.nginx_install_failed;
        document.getElementById('fm_nginx_install_actions').style.display = 'flex';
        HF.set_error_status(message || HF.labels.nginx_install_failed);
    }

    HF.start_nginx_install = function start_nginx_install() {
        var button = document.getElementById('fm_nginx_confirm_start');
        button.disabled = true;
        HF.close_modal();
        HF.stop_nginx_install_timers();
        HF.state.nginx_installing = true;
        HF.state.nginx_install_task = null;
        document.getElementById('fm_nginx_spinner').style.display = 'block';
        document.getElementById('fm_nginx_install_text').textContent = HF.labels.installing_nginx;
        document.getElementById('fm_nginx_install_actions').style.display = 'none';
        HF.open_modal('fm_nginx_install_dialog');
        HF.begin_nginx_restart_countdown();
        HF.Util.ajax({
            url: HF.api.nginx_install_start,
            type: 'POST',
            dataType: 'json',
            success: function(res) {
                if (!res || res.code !== 0) {
                    button.disabled = false;
                    HF.fail_nginx_install((res && res.message) || HF.labels.nginx_install_failed);
                    return;
                }
                HF.state.nginx_install_task = res.data || {};
            },
            error: function(xhr) {
                HF.state.nginx_install_task = null;
            }
        });
    }

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

    HF.stop_terminal_check = function stop_terminal_check() {
        if (HF.state.terminal_check_timer) {
            clearTimeout(HF.state.terminal_check_timer);
            HF.state.terminal_check_timer = null;
        }
    }

    HF.set_terminal_loading = function set_terminal_loading(message, hint) {
        var loading = document.getElementById('fm_terminal_loading');
        var error = document.getElementById('fm_terminal_error');
        document.getElementById('fm_terminal_loading_text').textContent = message || HF.labels.connecting_terminal;
        document.getElementById('fm_terminal_loading_hint').textContent = hint || '';
        document.getElementById('fm_terminal_install_tool').style.display = 'none';
        loading.classList.add('show');
        error.classList.remove('show');
    }

    HF.set_terminal_error = function set_terminal_error(message, hint, show_install, show_external) {
        var loading = document.getElementById('fm_terminal_loading');
        var error = document.getElementById('fm_terminal_error');
        document.getElementById('fm_terminal_error_text').textContent = message || HF.labels.terminal_failed;
        document.getElementById('fm_terminal_error_hint').textContent = hint || HF.labels.terminal_failed_hint;
        document.getElementById('fm_terminal_install_tool').style.display = show_install ? 'inline-flex' : 'none';
        document.getElementById('fm_terminal_open_external').style.display = show_external ? 'inline-flex' : 'none';
        loading.classList.remove('show');
        error.classList.add('show');
        HF.state.terminal_ready = false;
    }

    HF.clear_terminal_dialog = function clear_terminal_dialog(unload_frame) {
        HF.stop_terminal_check();
        var frame = document.getElementById('fm_terminal_frame');
        frame.onload = null;
        frame.onerror = null;
        if (unload_frame) {
            frame.setAttribute('src', 'about:blank');
            HF.state.terminal_url = '';
            HF.state.terminal_ready = false;
        }
        document.getElementById('fm_terminal_loading').classList.remove('show');
        document.getElementById('fm_terminal_error').classList.remove('show');
        document.getElementById('fm_terminal_loading_hint').textContent = '';
        document.getElementById('fm_terminal_install_tool').style.display = 'none';
        document.getElementById('fm_terminal_open_external').style.display = 'none';
        HF.state.terminal_context = null;
    }

    HF.attach_terminal_frame = function attach_terminal_frame(url) {
        var frame = document.getElementById('fm_terminal_frame');
        HF.set_terminal_loading(HF.labels.connecting_terminal, HF.labels.terminal_service_url + ': ' + url);
        HF.stop_terminal_check();
        var finished = false;

        function clear() {
            HF.stop_terminal_check();
            frame.onload = null;
            frame.onerror = null;
        }

        frame.onload = function() {
            finished = true;
            clear();
            document.getElementById('fm_terminal_loading').classList.remove('show');
            document.getElementById('fm_terminal_error').classList.remove('show');
            HF.state.terminal_url = url;
            HF.state.terminal_ready = true;
        };
        frame.onerror = function() {
            finished = true;
            clear();
            HF.set_terminal_error(HF.labels.terminal_failed, HF.labels.terminal_failed_hint);
            HF.set_error_status(HF.labels.terminal_failed);
        };
        frame.setAttribute('src', url);

        if (/^https:/i.test(url)) {
            HF.state.terminal_check_timer = setTimeout(function() {
                if (!finished) {
                    clear();
                    var https_page = window.location.protocol === 'https:';
                    var hint = https_page ? HF.labels.terminal_https_cert_hint : HF.labels.terminal_failed_hint;
                    HF.set_terminal_error(HF.labels.terminal_failed, hint, false, https_page);
                    HF.set_error_status(HF.labels.terminal_failed);
                }
            }, 8000);
        }
    }

    HF.test_terminal_connection = function test_terminal_connection(url, on_ok, on_fail) {
        HF.stop_terminal_check();
        var finished = false;

        function finish(success) {
            if (finished) {
                return;
            }
            finished = true;
            HF.stop_terminal_check();
            if (success) {
                on_ok();
            } else {
                on_fail();
            }
        }

        HF.state.terminal_check_timer = setTimeout(function() {
            finish(false);
        }, 5000);

        if (!window.fetch) {
            finish(true);
            return;
        }

        try {
            window.fetch(url, {
                method: 'GET',
                mode: 'no-cors',
                cache: 'no-store'
            }).then(function() {
                finish(true);
            }).catch(function() {
                finish(false);
            });
        } catch (error) {
            finish(false);
        }
    }

    HF.open_terminal = function open_terminal(item) {
        HF.hide_context_menus();
        HF.clear_terminal_dialog(false);
        HF.state.terminal_context = HF.resolve_terminal_target(item);
        document.getElementById('fm_terminal_title').textContent = HF.labels.terminal;
        HF.set_terminal_loading(HF.labels.connecting_terminal, HF.labels.terminal_current_path + ': ' + HF.state.terminal_context.path);
        HF.open_modal('fm_terminal_dialog');
        HF.Util.ajax({
            url: HF.api.terminal_info,
            type: 'GET',
            dataType: 'json',
            success: function(res) {
                var data = res && res.code === 0 ? (res.data || {}) : null;
                if (!data || !data.available) {
                    HF.set_terminal_error(HF.labels.terminal_failed, HF.labels.terminal_service_missing, true);
                    HF.set_error_status((res && res.message) || HF.labels.terminal_service_missing);
                    return;
                }
                HF.state.terminal_info = data;
                var url = HF.resolve_terminal_url(data);
                if (window.location.protocol === 'https:' && /^http:/i.test(url)) {
                    HF.set_terminal_error(HF.labels.terminal_failed, HF.labels.terminal_https_hint, false, true);
                    HF.set_error_status(HF.labels.terminal_failed);
                    return;
                }
                if (HF.state.terminal_ready && HF.state.terminal_url === url) {
                    document.getElementById('fm_terminal_loading').classList.remove('show');
                    document.getElementById('fm_terminal_error').classList.remove('show');
                    return;
                }
                if (/^https:/i.test(url)) {
                    HF.attach_terminal_frame(url);
                    return;
                }
                HF.test_terminal_connection(url, function() {
                    HF.attach_terminal_frame(url);
                }, function() {
                    HF.set_terminal_error(HF.labels.terminal_failed, HF.labels.terminal_failed_hint);
                    HF.set_error_status(HF.labels.terminal_failed);
                });
            },
            error: function() {
                HF.set_terminal_error(HF.labels.terminal_failed, HF.labels.terminal_failed_hint);
                HF.set_error_status(HF.labels.terminal_failed);
            }
        });
    }

    HF.open_terminal_external = function open_terminal_external() {
        var info = HF.state.terminal_info || {};
        var host = HF.format_host_for_url(window.location.hostname);
        var port = Number(info.port) || 7681;
        var raw = String(info.url || '').trim();
        var url;
        if (raw && /^https?:\/\//i.test(raw)) {
            url = raw;
        } else if (raw && raw.charAt(0) === '/') {
            url = window.location.origin + raw;
        } else {
            var protocol = Number(info.ssl) === 1 ? 'https:' : 'http:';
            url = protocol + '//' + host + ':' + port + '/';
        }
        window.open(url, '_blank', 'noopener');
    }

    HF.close_modal = function close_modal() {
        if (HF.state.nginx_installing &&
                document.getElementById('fm_nginx_install_dialog').style.display !== 'none') {
            return;
        }
        if (HF.state.install_task && !HF.state.install_task.done &&
                document.getElementById('fm_package_install_dialog').style.display !== 'none') {
            return;
        }
        if (HF.state.thumbnail_task && !HF.state.thumbnail_task.done &&
                document.getElementById('fm_thumbnail_dialog').style.display !== 'none') {
            return;
        }
        if (HF.state.archive_task && !HF.state.archive_task.done &&
                document.getElementById('fm_archive_task_dialog').style.display !== 'none') {
            return;
        }
        var cancel_pending = document.getElementById('fm_overwrite_dialog').style.display !== 'none' && HF.state.pending_upload;
        var dialogs = document.querySelectorAll('.fm-dialog');
        for (var i = 0; i < dialogs.length; i++) {
            dialogs[i].style.display = 'none';
        }
        document.getElementById('fm_modal_mask').style.display = 'none';
        if (HF.window_manager && HF.window_manager.close_all_legacy) {
            HF.window_manager.close_all_legacy();
        }

        HF.clear_terminal_dialog(false);
        if (cancel_pending) {
            HF.state.pending_upload = null;
            HF.state.uploading = false;
            HF.update_toolbar();
            document.getElementById('fm_upload_panel').className = 'fm-upload-panel';
        }
        HF.stop_install_poll();
        HF.stop_thumbnail_poll();
        HF.stop_archive_poll();
        HF.state.name_action = null;
        HF.state.delete_item = null;
        HF.state.delete_items = [];
        HF.state.transfer_action = null;
        HF.state.install_item = null;
        HF.state.install_task = null;
        HF.state.archive_items = [];
        HF.state.archive_task = null;
        HF.state.thumbnail_task = null;
        HF.state.thumbnail_path = '';
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
    
    HF.open_properties = function open_properties(item) {
        if (!item) {
            return;
        }
        document.getElementById('fm_property_icon').src = HF.icon_url(item.icon_name || HF.item_icon_name(item, 'file'));
        document.getElementById('fm_property_name').textContent = item.name;
        document.getElementById('fm_property_path').textContent = item.path;
        document.getElementById('fm_property_type').textContent = item.display_type;
        document.getElementById('fm_property_size').textContent = item.display_size;
        document.getElementById('fm_property_mtime').textContent = item.display_mtime;
        
        var mode = item.mode || '---';
        document.getElementById('fm_property_mode_text').textContent = mode;
        document.getElementById('fm_property_mode_input').value = mode;
        HF.updatePermissionCheckboxes(mode);

        document.getElementById('fm_property_mode_edit').style.display = 'none';

        document.getElementById('fm_property_edit_mode').onclick = function() {
            document.getElementById('fm_property_mode_edit').style.display = 'contents';
        };

        document.getElementById('fm_property_mode_cancel').onclick = function() {
            document.getElementById('fm_property_mode_edit').style.display = 'none';
            document.getElementById('fm_property_mode_input').value = mode;
            HF.updatePermissionCheckboxes(mode);
        };

        document.getElementById('fm_property_mode_save').onclick = function() {
            var newMode = document.getElementById('fm_property_mode_input').value.trim();
            if (!/^[0-7]{3,4}$/.test(newMode)) {
                HF.set_warning_status(HF.tr('Invalid permissions'));
                return;
            }
            HF.Util.ajax({
                url: HF.api.chmod,
                type: 'POST',
                data: { path: item.path, mode: newMode },
                dataType: 'json',
                success: function(res) {
                    if (res && res.code === 0) {
                        HF.set_status(HF.tr('Permissions updated'), 'success');
                        mode = newMode;
                        document.getElementById('fm_property_mode_text').textContent = mode;
                        document.getElementById('fm_property_mode_edit').style.display = 'none';
                        HF.refresh_after_write(item.path);
                    } else {
                        HF.set_error_status(res.message || HF.tr('Update failed'));
                    }
                },
                error: function() {
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
    }

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
