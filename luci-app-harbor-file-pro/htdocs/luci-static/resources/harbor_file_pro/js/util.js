
(function (HF) {
    HF.permBits = [8,7,6, 5,4,3, 2,1,0];
    HF.icon_base = HF.resource + 'icons/';
    HF.status_duration_fast = 1500;
    HF.status_duration_warning = 2000;
    HF.status_duration_long = 3000;
    HF.system_folder_paths = {
        '/bin': true,
        '/sbin': true,
        '/proc': true,
        '/dev': true,
        '/usr/bin': true,
        '/usr/sbin': true,
        '/usr/lib': true,
        '/usr/lib64': true,
        '/sys': true,
        '/lib64': true,
        '/overlay': true,
        '/rom': true
    };
    HF.state = {
        navigation: { quick_access: [], folders: [], drives: [], bookmarks: [], bookmark_folders: [], fav_expanded: [] },
        notice_record: null,
        system_blocked_notified: false,
        preferences: {
            view_mode: 1,
            allow_system_operations: 0,
            show_hidden_files: 0,
            home_dir: '/tmp/root',
            enable_thumbnails: 0,
            editor_auto_indent: 0,
            editor_auto_wrap: 0,
            restore_last_directory: 0,
            show_line_numbers: 0,
            last_directory: '',
            uwsgi_request_buffering: 0,
            client_max_body_size: 128,
            uwsgi_config_available: false,
            'reload-on-as': 256,
            'reload-on-as_enabled': 0,
            'reload-on-rss': 192,
            'reload-on-rss_enabled': 0,
            'post-buffering': 8192,
            'limit-as': 1000,
            'reload-mercy': 8,
            'buffer-size': 10000,
            uhttpd_config_available: false,
            uhttpd_script_timeout: 600,
            uhttpd_network_timeout: 600,
            web_server: 'unknown',
            nginx_running: false,
            fcm: 0,
            window_width: 820,
            window_height: 590,
            mobile_window_width: 360,
            mobile_window_height: 560
        },
        current: null,
        current_directory_data: null,
        selected: null,
        selected_items: [],
        selected_order: [],
        selection_anchor: null,
        selection_box: null,
        selection_base: [],
        selection_dragging: false,
        selection_moved: false,
        selection_start_x: 0,
        selection_start_y: 0,
        marquee_scroll_x: 0,
        marquee_scroll_y: 0,
        marquee_last_x: 0,
        marquee_last_y: 0,
        item_hover_timer: null,
        item_hover_card: null,
        item_hover_event: null,
        sort_field: 'name',
        sort_order: 'asc',
        sort_path: '',
        suppress_next_click: false,
        context_item: null,
        history: [],
        history_index: -1,
        uploading: false,
        pending_upload: null,
        drag_target: null,
        upload_target: null,
        clipboard: null,
        name_action: null,
        delete_item: null,
        delete_items: [],
        status_timer: null,
        upload_panel_timer: null,
        install_poll_timer: null,
        install_item: null,
        install_task: null,
        archive_poll_timer: null,
        archive_items: [],
        archive_task: null,
        nginx_installing: false,
        nginx_install_task: null,
        nginx_install_countdown_timer: null,
        thumbnail_poll_timer: null,
        thumbnail_task: null,
        thumbnail_path: '',
        terminal_context: null,
        terminal_info: null,
        detected_types: {},
        detect_waiters: {},
        last_directory_sent: '',
        last_directory_timer: null,
        terminal_check_timer: null,
        terminal_url: '',
        terminal_ready: false,
        drag_item: null,
        drag_items: [],
        uploaded_bytes: 0,
        upload_total: 0,
        upload_speed: 0,
        upload_last_loaded: 0,
        upload_last_tick: 0,
        address_editing: false,
        view_mode: 'medium',
        transfer_action: null,
        target_path: '/',
    };

    HF.request_json = function request_json(url, data, on_ok, on_error) {
        function fail_hard(message) {
            if (on_error) {
                on_error(message);
                return;
            }
            HF.set_error_status(message || HF.labels.request_failed);
        }
        HF.Util.ajax({
            url: url,
            type: 'GET',
            data: data || {},
            dataType: 'json',
            success: function(res) {
                if (!res || res.code !== 0) {
                    fail_hard(res && res.message ? res.message : HF.labels.request_failed);
                    return;
                }
                on_ok(res.data || {});
            },
            error: function(xhr) {
                fail_hard(HF.labels.request_failed + ': HTTP ' + xhr.status);
            }
        });
    }

    HF.status_timeout = function status_timeout(type, duration) {
        if (typeof duration === 'number' && duration >= 0) {
            return duration;
        }
        if (type === 'warning') {
            return HF.status_duration_warning;
        }
        if (type === 'error') {
            return HF.status_duration_long;
        }
        return HF.status_duration_fast;
    }

    
    HF.notify = function notify(message, type, auto_close) {
        type = type || 'notice';
        if (!HF.window_manager) {
            return null;
        }
        var modal = (type === 'error' || type === 'warning');
        if (modal && HF.state.notice_record && !HF.state.notice_record.closed) {
            HF.window_manager.close(HF.state.notice_record);
        }
        var body = HF.Util.createElement('div', 'fm-notify-body');
        var text = HF.Util.createElement('div', 'fm-notify-message', String(message || ''));
        body.appendChild(text);
        var titles = { error: 'Error', warning: 'Warning', success: 'Success', notice: 'Notice' };
        var record = HF.window_manager.create({
            title: HF.tr(titles[type] || 'Notice'),
            icon: 'file',
            className: 'fm-notify-window fm-notify-' + type,
            content: body,
            width: 440,
            height: 130,
            minWidth: 240,
            minHeight: 90,
            persistSize: false
        });
        if (modal) {
            HF.state.notice_record = record;
            HF.window_manager.show_modal_overlay(record);
        }
        if (auto_close > 0) {
            setTimeout(function() {
                HF.window_manager.close(record);
            }, auto_close);
        }
        return record;
    };

    
    HF.confirm_window = function confirm_window(options) {
        options = options || {};
        if (!HF.window_manager) {
            return Promise.resolve(true);
        }
        return new Promise(function(resolve) {
            var body = HF.Util.createElement('div', 'fm-confirm-body');
            var msg = HF.Util.createElement('div', 'fm-confirm-message', String(options.message || ''));
            var actions = HF.Util.createElement('div', 'fm-confirm-actions');
            body.appendChild(msg);
            body.appendChild(actions);
            var settled = false;
            var record = null;
            function finish(value) {
                if (settled) {
                    return;
                }
                settled = true;
                if (record) {
                    HF.window_manager.close(record);
                }
                resolve(value);
            }
            record = HF.window_manager.create({
                title: options.title || HF.tr('Confirm'),
                icon: 'file',
                className: 'fm-confirm-window',
                content: body,
                width: 440,
                height: 160,
                minWidth: 280,
                minHeight: 120,
                persistSize: false,
                beforeClose: function() {
                    finish(false);
                    return true;
                }
            });
            HF.window_manager.show_modal_overlay(record);
            var cancel_btn = HF.wm_window_action(options.cancel_label || HF.tr('Cancel'), false);
            var ok_btn = HF.wm_window_action(options.confirm_label || HF.tr('Confirm'), true);
            cancel_btn.addEventListener('click', function() { finish(false); });
            ok_btn.addEventListener('click', function() { finish(true); });
            actions.appendChild(cancel_btn);
            actions.appendChild(ok_btn);
        });
    };

    HF.set_status = function set_status(message, type, duration) {
        if (!message) {
            return;
        }
        if (message === HF.labels.system_folder_blocked) {
            if (HF.state.system_blocked_notified) {
                return;
            }
            HF.state.system_blocked_notified = true;
        }
        var auto;
        if (type === 'error' || type === 'warning') {
            auto = 0; 
        } else {
            auto = typeof duration === 'number' ? duration : 1000;
        }
        HF.notify(message, type || 'notice', auto);
    }

    HF.set_warning_status = function set_warning_status(message) {
        HF.set_status(message, 'warning');
    }

    HF.set_error_status = function set_error_status(message) {
        HF.set_status(message, 'error');
    }

    HF.set_write_block_status = function set_write_block_status(message) {
        HF.set_status(message, String(message || '').indexOf('5%') >= 0 ? 'error' : 'warning');
    }

    HF.request_write = function request_write(url, data, success_message, on_ok, on_error) {
        HF.Util.ajax({
            url: url,
            type: 'POST',
            data: data,
            dataType: 'json',
            success: function(res) {
                if (!res || res.code !== 0) {
                    HF.set_error_status((res && res.message) || HF.labels.operation_failed);
                    if (on_error) {
                        on_error((res && res.message) || HF.labels.operation_failed);
                    }
                    return;
                }
                HF.set_status(success_message, 'success');
                if (on_ok) {
                    on_ok(res.data || {});
                }
            },
            error: function(xhr) {
                var message = HF.upload_error_message(xhr, HF.labels.operation_failed);
                HF.set_error_status(message);
                if (on_error) {
                    on_error(message);
                }
            }
        });
    }

    HF.archive_error_message = function archive_error_message(res, fallback) {
        var data = (res && res.data) || {};
        if (data.missing_tool) {
            return HF.format_label(HF.labels.archive_missing_tool_install, data.missing_tool);
        }
        var message = (res && res.message) || fallback || HF.labels.archive_failed;
        if (data.failed_path) {
            message = message + ' (' + data.failed_path + ')';
        }
        return message;
    }

    HF.request_archive_write = function request_archive_write(url, data, on_ok, on_error) {
        function handle_error(res) {
            if (typeof on_error === 'function') {
                on_error(res);
            } else {
                HF.set_error_status(HF.archive_error_message(res, HF.labels.archive_failed));
            }
        }
        HF.Util.ajax({
            url: url,
            type: 'POST',
            data: data,
            dataType: 'json',
            success: function(res) {
                if (!res || res.code !== 0) {
                    handle_error(res);
                    return;
                }
                if (on_ok) {
                    on_ok(res.data || {});
                }
            },
            error: function(xhr) {
                handle_error(HF.response_json(xhr) || {});
            }
        });
    }

    HF.clear_node = function clear_node(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    HF.icon_url = function icon_url(name) {
        return HF.icon_base + name + '.svg';
    }

    HF.is_child_path = function is_child_path(path, root) {
        return path === root || path.indexOf(root + '/') === 0;
    }

    HF.view_mode_to_value = function view_mode_to_value(mode) {
        var modes = ['large', 'medium', 'small', 'list', 'details', 'tile'];
        var index = modes.indexOf(mode);
        return index >= 0 ? index : 1;
    }

    HF.value_to_view_mode = function value_to_view_mode(value) {
        var modes = ['large', 'medium', 'small', 'list', 'details', 'tile'];
        var index = Number(value);
        return modes[index] || 'medium';
    }

    HF.item_icon_name = function item_icon_name(item, kind) {
        if (item.icon_name) {
            return item.icon_name;
        }
        if (kind === 'drive') {
            return 'drive';
        }
        if (item.type === 'directory') {
            return 'folder';
        }
        if (item.preview === 'text' || item.preview === 'image' || item.preview === 'video' || item.preview === 'pdf') {
            return item.preview;
        }
        return 'file';
    }

    HF.normalize_integer_setting = function normalize_integer_setting(value, fallback) {
        var number = Number(value);
        return isNaN(number) ? fallback : Math.floor(number);
    }

    HF.format_size = function format_size(bytes) {
        var value = Number(bytes || 0);
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var index = 0;
        while (value >= 1024 && index < units.length - 1) {
            value = value / 1024;
            index++;
        }
        return value.toFixed(index === 0 ? 0 : 1) + ' ' + units[index];
    }

    HF.format_kb = function format_kb(kb) {
        return HF.format_size(Number(kb || 0) * 1024);
    }

    HF.format_speed = function format_speed(bytes_per_second) {
        var value = Number(bytes_per_second || 0);
        if (!isFinite(value) || value <= 0) {
            return '0 B/s';
        }
        return HF.format_size(value) + '/s';
    }

    HF.format_time = function format_time(timestamp) {
        if (!timestamp) {
            return '-';
        }
        var date = new Date(Number(timestamp) * 1000);
        if (isNaN(date.getTime())) {
            return '-';
        }
        var pad = function(value) { return value < 10 ? '0' + value : String(value); };
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
            ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    HF.parent_directory = function parent_directory(path) {
        var value = String(path || '');
        if (!value || value === '/') {
            return '/';
        }
        var index = value.lastIndexOf('/');
        if (index <= 0) {
            return '/';
        }
        return value.substring(0, index) || '/';
    }

    HF.format_label = function format_label(template, value) {
        return String(template || '').replace(/%[ds]/, String(value));
    }

    HF.upload_error_message = function upload_error_message(xhr, fallback) {
        try {
            var response = JSON.parse(xhr.responseText || '{}');
            return response.message || fallback;
        } catch (error) {
            return fallback;
        }
    }

    HF.response_json = function response_json(xhr) {
        try {
            return JSON.parse(xhr.responseText || '{}');
        } catch (error) {
            return {};
        }
    }

    HF.localized_space_message = function localized_space_message(message) {
        return String(message || '').indexOf('5%') >= 0 ? HF.labels.space_less_than_50mb : message;
    }
    HF.Util = HF.Util || {};
    HF.Util.ajax = function (options) {
        var url = options.url || '';
        var type = (options.type || 'GET').toUpperCase();
        var query = '';
        if (options.data) {
            var parts = [];
            for (var key in options.data) {
                if (Object.prototype.hasOwnProperty.call(options.data, key) &&
                        options.data[key] !== undefined && options.data[key] !== null) {
                    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(options.data[key])));
                }
            }
            query = parts.join('&');
        }
        if (type === 'GET' && query) {
            url += (url.indexOf('?') >= 0 ? '&' : '?') + query;
        }
        if (options.cache === false || options.cache === 'no-store') {
            url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
        }
        var xhr = new XMLHttpRequest();
        xhr.open(type, url, true);
        if (type === 'POST') {
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
        }
        xhr.onload = function () {
            if (xhr.status < 200 || xhr.status >= 300) {
                if (options.error) { options.error(xhr); }
                return;
            }
            var result = xhr.responseText;
            if (options.dataType === 'json') {
                try { result = JSON.parse(xhr.responseText); }
                catch (e) { if (options.error) { options.error(xhr); } return; }
            }
            if (options.success) { options.success(result); }
        };
        xhr.onerror = function () {
            if (options.error) { options.error(xhr); }
        };
        xhr.send(type === 'POST' ? query : null);
    };
    HF.Util.trim = function (value) { return String(value == null ? '' : value).trim(); };

    HF.Util.createHistory = function (limit, coalesce_ms) {
        var undoStack = [];
        var redoStack = [];
        var max = limit || 100;
        var coalesce = coalesce_ms === undefined ? 800 : coalesce_ms;
        var lastCapture = 0;
        return {
            capture: function (snapshot) {
                redoStack.length = 0;
                var now = Date.now();
                if (coalesce > 0 && now - lastCapture < coalesce && undoStack.length) {
                    return; 
                }
                undoStack.push(snapshot);
                if (undoStack.length > max) {
                    undoStack.shift();
                }
                lastCapture = now;
            },
            undo: function (current) {
                if (!undoStack.length) { return null; }
                redoStack.push(current);
                lastCapture = 0;
                return undoStack.pop();
            },
            redo: function (current) {
                if (!redoStack.length) { return null; }
                undoStack.push(current);
                lastCapture = 0;
                return redoStack.pop();
            },
            canUndo: function () { return undoStack.length > 0; },
            canRedo: function () { return redoStack.length > 0; },
            reset: function () { undoStack.length = 0; redoStack.length = 0; lastCapture = 0; }
        };
    };
    HF.Util.createElement = function (tag, class_name, text) {
        var node = document.createElement(tag);
        if (class_name) { node.className = class_name; }
        if (text !== undefined && text !== null) { node.textContent = text; }
        return node;
    };

    HF.Util.request_json = HF.request_json;
    HF.Util.request_write = HF.request_write;
    HF.Util.request_archive_write = HF.request_archive_write;
    HF.Util.set_status = HF.set_status;
    HF.Util.set_warning_status = HF.set_warning_status;
    HF.Util.set_error_status = HF.set_error_status;
    HF.Util.set_write_block_status = HF.set_write_block_status;
    HF.Util.status_timeout = HF.status_timeout;
    HF.Util.format_size = HF.format_size;
    HF.Util.format_kb = HF.format_kb;
    HF.Util.format_speed = HF.format_speed;
    HF.Util.format_time = HF.format_time;
    HF.Util.format_label = HF.format_label;
    HF.Util.parent_directory = HF.parent_directory;
    HF.Util.icon_url = HF.icon_url;
    HF.Util.item_icon_name = HF.item_icon_name;
    HF.Util.is_child_path = HF.is_child_path;
    HF.Util.view_mode_to_value = HF.view_mode_to_value;
    HF.Util.value_to_view_mode = HF.value_to_view_mode;
    HF.Util.normalize_integer_setting = HF.normalize_integer_setting;
    HF.Util.response_json = HF.response_json;
    HF.Util.upload_error_message = HF.upload_error_message;
    HF.Util.localized_space_message = HF.localized_space_message;
    HF.Util.archive_error_message = HF.archive_error_message;
    HF.Util.clear_node = HF.clear_node;
})(window.HarborFile = window.HarborFile || {});
