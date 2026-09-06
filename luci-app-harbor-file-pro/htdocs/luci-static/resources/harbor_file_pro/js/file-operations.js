
(function (HF) {
    HF.thumbnails_enabled_for_view = function thumbnails_enabled_for_view() {
        return ['large', 'medium', 'small', 'tile'].indexOf(HF.state.view_mode) >= 0;
    }

    HF.should_use_thumbnail = function should_use_thumbnail(item, kind) {
        return kind === 'file' &&
            HF.state.preferences.enable_thumbnails === 1 &&
            HF.thumbnails_enabled_for_view() &&
            item.preview === 'image' &&
            item.thumbnail_available === true;
    }

    HF.thumbnail_url = function thumbnail_url(item) {
        return HarborIO.thumbnailURL(item.path) +
            '&v=' + encodeURIComponent(String(item.size || 0) + '-' + String(item.mtime || 0));
    }

    HF.thumbnail_frame_size = function thumbnail_frame_size(frame) {
        var rect = frame.getBoundingClientRect ? frame.getBoundingClientRect() : null;
        var width = rect && rect.width ? rect.width : frame.clientWidth;
        var height = rect && rect.height ? rect.height : frame.clientHeight;
        if (!width || !height) {
            if (HF.state.view_mode === 'large') {
                width = height = 72;
            } else if (HF.state.view_mode === 'small') {
                width = height = 22;
            } else {
                width = height = 44;
            }
        }
        return { width: width, height: height };
    }

    HF.fit_thumbnail_image = function fit_thumbnail_image(image, frame) {
        var natural_width = image.naturalWidth || 0;
        var natural_height = image.naturalHeight || 0;
        if (!natural_width || !natural_height) {
            return;
        }
        var size = HF.thumbnail_frame_size(frame);
        var scale = Math.min(size.width / natural_width, size.height / natural_height);
        image.style.width = Math.max(1, Math.round(natural_width * scale)) + 'px';
        image.style.height = Math.max(1, Math.round(natural_height * scale)) + 'px';
        image.style.maxWidth = 'none';
        image.style.maxHeight = 'none';
    }

    HF.package_ext_value = function package_ext_value(ext, path) {
        var value = String(ext || '').toLowerCase();
        if (!value && path) {
            value = String(path).replace(/^.*\.([^.\/]+)$/, '$1').toLowerCase();
        }
        return value;
    }

    HF.package_type_label = function package_type_label(ext, path) {
        var value = HF.package_ext_value(ext, path);
        if (value === 'ipk') {
            return HF.labels.ipk_package;
        }
        if (value === 'apk') {
            return HF.labels.apk_package;
        }
        if (value === 'repository') {
            return HF.labels.system_package;
        }
        return HF.labels.file;
    }

    HF.package_installer_name = function package_installer_name(ext, path) {
        return HF.package_ext_value(ext, path) === 'apk' ? 'apk' : 'opkg';
    }

    HF.archive_format_suffix = function archive_format_suffix(format) {
        return {
            'tar.gz': '.tar.gz',
            'tar': '.tar',
            'zip': '.zip'
        }[format] || '.tar.gz';
    }

    HF.archive_file_name = function archive_file_name(path) {
        return String(path || '').replace(/^.*\//, '');
    }

    HF.archive_base_name = function archive_base_name(name) {
        var value = String(name || 'archive');
        return value.replace(/(\.tar\.gz|\.tar\.bz2|\.tar\.xz|\.tgz|\.tar|\.zip|\.gz|\.7z|\.iso)$/i, '') || 'archive';
    }

    HF.archive_extract_format = function archive_extract_format(item) {
        var name = String((item && item.name) || '').toLowerCase();
        if (/\.tar\.gz$/.test(name)) {
            return 'tar.gz';
        }
        if (/\.tgz$/.test(name)) {
            return 'tgz';
        }
        if (/\.tar$/.test(name)) {
            return 'tar';
        }
        if (/\.zip$/.test(name)) {
            return 'zip';
        }
        if (/\.tar\.bz2$/.test(name)) {
            return 'tar.bz2';
        }
        if (/\.tar\.xz$/.test(name)) {
            return 'tar.xz';
        }
        if (/\.gz$/.test(name)) {
            return 'gz';
        }
        if (/\.7z$/.test(name)) {
            return '7z';
        }
        if (/\.iso$/.test(name)) {
            return 'iso';
        }
        return '';
    }

    HF.is_archive_item = function is_archive_item(item) {
        return !!(item && item.type !== 'directory' && HF.archive_extract_format(item));
    }

    HF.default_archive_name = function default_archive_name(items, format) {
        var base = 'archive';
        if (items.length === 1) {
            base = HF.archive_base_name(items[0].name || HF.archive_file_name(items[0].path));
        } else if (HF.state.current && HF.state.current.path) {
            base = HF.archive_base_name(HF.archive_file_name(HF.state.current.path));
        }
        return base + HF.archive_format_suffix(format);
    }

    HF.sync_archive_format_options = function sync_archive_format_options() {
        var items = HF.normalize_item_list(HF.state.archive_items || []);
        var format_select = document.getElementById('fm_archive_format');
        var format = format_select.value;
        document.getElementById('fm_archive_name').value = HF.default_archive_name(items, format);
        if (!HF.state.archive_target_dir) {
            HF.state.archive_target_dir = (HF.state.current && HF.state.current.path) || '/';
        }
        document.getElementById('fm_archive_target').value = HF.state.archive_target_dir;
    }

    HF.open_archive_dialog = function open_archive_dialog(items) {
        items = HF.normalize_item_list(items);
        if (!items.length || !HF.state.current || HF.state.current.kind !== 'directory') {
            return;
        }
        HF.state.archive_items = items;
        HF.state.archive_target_dir = HF.state.current.path;
        document.getElementById('fm_archive_title').textContent = HF.labels.compress;
        document.getElementById('fm_archive_source').textContent =
            items.length === 1 ? items[0].path : HF.format_label(HF.labels.selected_items, items.length);
        document.getElementById('fm_archive_format').value = 'tar.gz';
        HF.sync_archive_format_options();
        HF.open_modal('fm_archive_dialog');
        document.getElementById('fm_archive_name').focus();
    }

    HF.update_archive_task_view = function update_archive_task_view(data) {
        var task = data || {};
        HF.state.archive_task = task;
        var creating = task.mode !== 'extract';
        var tool = task.missing_tool || '';
        var tool_missing = !!tool;
        document.getElementById('fm_archive_task_title').textContent = tool_missing ?
            HF.labels.archive_command_missing :
            (task.done ?
                (HF.task_unconfirmed(task) ? HF.labels.task_status_unknown :
                    (task.success ? (creating ? HF.labels.archive_created : HF.labels.archive_extracted) : HF.labels.archive_failed)) :
                (creating ? HF.labels.creating_archive : HF.labels.extracting_archive));
        document.getElementById('fm_archive_task_status').textContent = tool_missing ?
            HF.format_label(HF.labels.archive_tool_required, tool) :
            (task.message || (creating ? HF.labels.creating_archive : HF.labels.extracting_archive));
        document.getElementById('fm_archive_task_path').textContent =
            task.output_path || task.destination_path || task.path || '-';
        document.getElementById('fm_archive_task_format').textContent = task.format || '-';
        document.getElementById('fm_archive_task_exit').textContent =
            task.exit_code === undefined || task.exit_code === null ? '-' : String(task.exit_code);
        var command_line = task.command ? '$ ' + task.command : '';
        var log_text = task.log || '';
        if (command_line && log_text.indexOf(command_line) < 0)
            log_text = log_text ? command_line + '\n' + log_text : command_line;
        document.getElementById('fm_archive_task_log').textContent = log_text || HF.labels.no_log_yet;
        var install_button = document.getElementById('fm_archive_install_tool');
        if (install_button) {
            install_button.style.display = tool_missing ? '' : 'none';
            if (tool_missing) {
                install_button.textContent = HF.format_label(HF.labels.install_tool, tool);
            }
        }
        document.getElementById('fm_archive_task_close').disabled = !task.done && !tool_missing;
        document.getElementById('fm_archive_task_done').disabled = !task.done && !tool_missing;
    }

    HF.task_unconfirmed = function task_unconfirmed(task) {
        return !!(task && task.done && task.state === 'unknown');
    }

    HF.report_task_poll_error = function report_task_poll_error(state_key, view, res, xhr, retry) {
        var task = HF.state[state_key] || {};
        task.poll_errors = (task.poll_errors || 0) + 1;
        task.message = HF.format_label(HF.labels.task_status_retry, task.poll_errors) + ': ' +
            ((res && res.message) ? res.message : (xhr ? HF.upload_error_message(xhr, HF.labels.request_failed) : HF.labels.request_failed));
        if (task.poll_errors >= 30) {
            task.done = true;
            task.state = 'unknown';
        }
        HF.state[state_key] = task;
        view(task);
        if (!task.done && retry) {
            retry();
        }
    }

    HF.stop_archive_poll = function stop_archive_poll() {
        if (HF.state.archive_poll_timer) {
            clearTimeout(HF.state.archive_poll_timer);
            HF.state.archive_poll_timer = null;
        }
    }

    HF.poll_archive_task = function poll_archive_task(task_id) {
        HF.stop_archive_poll();
        HF.Util.ajax({
            url: HF.api.archive_status,
            type: 'GET',
            data: { task_id: task_id },
            dataType: 'json',
            success: function(res) {
                if (!res || res.code !== 0) {
                    HF.report_task_poll_error('archive_task', HF.update_archive_task_view, res, null, function() {
                        HF.poll_archive_task(task_id);
                    });
                    return;
                }
                HF.update_archive_task_view(res.data || {});
                if (HF.state.archive_task && !HF.state.archive_task.done) {
                    HF.state.archive_poll_timer = setTimeout(function() {
                        HF.poll_archive_task(task_id);
                    }, 1000);
                    return;
                }
                if (HF.state.archive_task && HF.state.archive_task.done) {
                    if (HF.state.archive_task.success) {
                        HF.refresh_after_write(HF.state.archive_task.output_path || HF.state.archive_task.destination_path);
                    }
                }
            },
            error: function(xhr) {
                HF.report_task_poll_error('archive_task', HF.update_archive_task_view, null, xhr, function() {
                    HF.poll_archive_task(task_id);
                });
            }
        });
    }

    HF.start_archive_progress = function start_archive_progress(data) {
        HF.close_modal();
        HF.update_archive_task_view(data || {});
        HF.open_modal('fm_archive_task_dialog');
        if (data && data.task_id) {
            HF.poll_archive_task(data.task_id);
        }
    }

    
    HF.show_archive_missing_tool = function show_archive_missing_tool(res, mode) {
        var data = (res && res.data) || {};
        var tool = data.missing_tool || '';
        HF.state.archive_missing_tool = data;
        HF.update_archive_task_view({
            done: true,
            success: false,
            mode: mode,
            missing_tool: tool,
            format: tool,
            message: (res && res.message) || HF.labels.archive_command_missing,
            log: HF.format_label(HF.labels.archive_tool_required, tool)
        });
        HF.open_modal('fm_archive_task_dialog');
    };

    HF.start_archive_tool_install = function start_archive_tool_install() {
        var data = HF.state.archive_missing_tool || {};
        var tool = data.missing_tool || '';
        var package_name = data.package_name || tool;
        if (!tool) {
            return;
        }
        HF.close_modal();
        HF.state.install_item = { name: package_name, path: package_name, ext: 'repository' };
        HF.update_package_install_view({
            state: 'running',
            done: false,
            success: false,
            message: HF.labels.install_running,
            package_type: 'repository',
            package_name: package_name,
            path: package_name,
            log: HF.labels.no_log_yet
        });
        HF.open_modal('fm_package_install_dialog');
        HF.request_write(HF.api.tool_install_start, { tool: tool }, '', function(data2) {
            HF.state.install_item = {
                name: data2.package_name || package_name,
                path: data2.package_name || package_name,
                ext: 'repository'
            };
            HF.update_package_install_view(data2 || {});
            HF.open_modal('fm_package_install_dialog');
            if (data2.task_id && !data2.done) {
                HF.poll_package_install(data2.task_id);
            }
        }, function(message) {
            HF.update_package_install_view({
                state: 'failed',
                done: true,
                success: false,
                message: message || HF.labels.install_failed,
                package_type: 'repository',
                package_name: package_name,
                path: package_name,
                log: HF.labels.no_log_yet
            });
        });
    }

    HF.submit_archive_dialog = function submit_archive_dialog() {
        var items = HF.normalize_item_list(HF.state.archive_items || []);
        var format = document.getElementById('fm_archive_format').value;
        if (!items.length) {
            HF.set_warning_status(HF.labels.no_files);
            return;
        }

        var output_name = document.getElementById('fm_archive_name').value.trim();
        if (!output_name || /[\\\/\x00-\x1f\x7f]/.test(output_name)) {
            HF.set_warning_status(HF.labels.invalid_name);
            return;
        }
        var target_dir = document.getElementById('fm_archive_target').value.trim();
        if (!target_dir || target_dir.charAt(0) !== '/') {
            HF.set_warning_status(HF.labels.enter_absolute_path);
            return;
        }
        var payload = {
            sources: JSON.stringify(HF.item_list_paths(items)),
            format: format,
            output_name: output_name,
            target_dir: target_dir
        };
        function submit(overwrite) {
            if (overwrite) {
                payload.overwrite = '1';
            }
            HF.request_archive_write(HF.api.archive_create_start, payload, HF.start_archive_progress, function(res) {
                if (res && res.code === 3) {
                    HF.confirm_window({
                        title: HF.labels.overwrite,
                        message: HF.labels.archive_overwrite_confirm
                    }).then(function(ok) {
                        if (ok) {
                            submit(true);
                        }
                    });
                    return;
                }
                if (res && res.code === 2 && res.data && res.data.missing_tool) {
                    HF.close_modal();
                    HF.show_archive_missing_tool(res, 'create');
                    return;
                }
                HF.set_error_status(HF.archive_error_message(res, HF.labels.archive_failed));
            });
        }
        submit(false);
    }

    HF.extract_default_target = function extract_default_target(item) {
        var parent = HF.parent_directory(item.path);
        if (!parent || parent === '') {
            parent = '/';
        }
        var base = HF.archive_base_name(item.name || HF.archive_file_name(item.path));
        return (parent === '/' ? '' : parent) + '/' + base;
    }

    HF.set_extract_rows = function set_extract_rows(entries) {
        var rows = (entries || []).map(function(entry) {
            return { name: String(entry.name || ''), dir: !!entry.dir, size: entry.size, checked: true, expanded: false };
        }).filter(function(row) {
            return row.name !== '';
        });
        rows.sort(function(a, b) {
            var ka = (a.dir ? a.name + '/' : a.name).toLowerCase();
            var kb = (b.dir ? b.name + '/' : b.name).toLowerCase();
            if (ka !== kb) {
                return ka < kb ? -1 : 1;
            }
            return a.dir === b.dir ? 0 : (a.dir ? -1 : 1);
        });
        HF.state.extract_rows = rows;
        HF.state.extract_collapsed = {};
        rows.forEach(function(row) {
            if (row.dir) {
                HF.state.extract_collapsed[row.name] = true;
            }
        });
        HF.state.extract_selectable = !HF.state.extract_truncated;
        HF.render_extract_list();
    }

    HF.extract_child_files = function extract_child_files(name) {
        var prefix = name + '/';
        return (HF.state.extract_rows || []).filter(function(row) {
            return !row.dir && row.name.indexOf(prefix) === 0;
        });
    }

    HF.extract_files = function extract_files() {
        return (HF.state.extract_rows || []).filter(function(row) {
            return !row.dir;
        });
    }

    HF.extract_hidden = function extract_hidden(name) {
        var parts = String(name || '').split('/');
        var path = '';
        for (var i = 0; i < parts.length - 1; i++) {
            path = path === '' ? parts[i] : path + '/' + parts[i];
            if (HF.state.extract_collapsed[path]) {
                return true;
            }
        }
        return false;
    }

    HF.toggle_extract_fold = function toggle_extract_fold(row) {
        if (row.expanded) {
            HF.state.extract_collapsed[row.name] = true;
        } else {
            delete HF.state.extract_collapsed[row.name];
        }
        row.expanded = !row.expanded;
        HF.render_extract_list();
    }

    HF.render_extract_list = function render_extract_list() {
        var box = document.getElementById('fm_extract_list');
        if (!box) {
            return;
        }
        var top = box.scrollTop;
        (HF.state.extract_rows || []).forEach(function(row) { row.input = null; });
        HF.clear_node(box);
        (HF.state.extract_rows || []).filter(function(row) {
            return !HF.extract_hidden(row.name);
        }).forEach(function(row) {
            var label = document.createElement('label');
            label.className = 'fm-extract-row' + (row.dir ? ' is-dir' : '');
            label.style.paddingLeft = ((row.name.match(/\//g) || []).length * 14) + 'px';
            if (!HF.state.extract_selectable) {
                label.className += ' is-plain';
            }
            if (row.dir) {
                var fold = document.createElement('span');
                fold.className = 'fm-extract-fold';
                fold.setAttribute('data-fold', row.name);
                fold.textContent = row.expanded ? '\u25be' : '\u25b8';
                label.appendChild(fold);
            }
            var icon = document.createElement('img');
            icon.className = 'fm-extract-icon';
            icon.src = HF.icon_url(HF.icon_name_of({
                name: leaf,
                path: row.name,
                type: row.dir ? 'directory' : 'file',
                preview: 'none'
            }));
            icon.alt = '';
            icon.draggable = false;
            label.appendChild(icon);
            var input = null;
            if (HF.state.extract_selectable) {
                input = document.createElement('input');
                input.type = 'checkbox';
                input.setAttribute('data-name', row.name);
                if (row.dir) {
                    input.setAttribute('data-dir', '1');
                }
            }
            row.input = input;
            var name = document.createElement('span');
            name.className = 'fm-extract-name';
            var leaf = row.name.indexOf('/') >= 0 ? row.name.slice(row.name.lastIndexOf('/') + 1) : row.name;
            name.textContent = row.dir ? leaf + '/' : leaf;
            name.setAttribute('title', row.name);
            var size = document.createElement('span');
            size.className = 'fm-extract-size';
            size.textContent = (row.size === null || row.size === undefined) ? '-' : HF.format_size(row.size);
            if (input) {
                label.appendChild(input);
            }
            label.appendChild(name);
            label.appendChild(size);
            box.appendChild(label);
        });
        box.scrollTop = top;
        HF.sync_extract_checks();
    }

    HF.on_extract_list_click = function on_extract_list_click(event) {
        var fold = event && event.target;
        if (!fold || !fold.getAttribute) {
            return;
        }
        var name = fold.getAttribute('data-fold');
        if (name === null || name === '') {
            return;
        }
        if (event.preventDefault) {
            event.preventDefault();
        }
        var row = (HF.state.extract_rows || []).filter(function(r) { return r.dir && r.name === name; })[0];
        if (row) {
            HF.toggle_extract_fold(row);
        }
    }

    HF.sync_extract_checks = function sync_extract_checks() {
        var rows = HF.state.extract_rows || [];
        var files = HF.extract_files();
        var picked = files.filter(function(row) { return row.checked; }).length;
        rows.forEach(function(row) {
            if (!row.input) {
                return;
            }
            if (row.dir) {
                var kids = HF.extract_child_files(row.name);
                row.input.checked = kids.length ? kids.every(function(k) { return k.checked; }) : row.checked;
            } else {
                row.input.checked = row.checked;
            }
        });
        var all = document.getElementById('fm_extract_all');
        if (all) {
            var usable = HF.state.extract_selectable && files.length > 0;
            all.disabled = !usable;
            all.checked = usable && picked === files.length;
        }
        HF.show_extract_count(picked, files.length);
    }

    HF.show_extract_count = function show_extract_count(picked, total) {
        var count = document.getElementById('fm_extract_count');
        if (!count) {
            return;
        }
        count.textContent = HF.state.extract_hint ? HF.state.extract_hint : (picked + ' / ' + total);
    }

    HF.set_extract_hint = function set_extract_hint(text) {
        HF.state.extract_hint = text || '';
        HF.show_extract_count(HF.extract_files().filter(function(r) { return r.checked; }).length,
            HF.extract_files().length);
    }

    HF.set_all_extract_entries = function set_all_extract_entries() {
        var checked = document.getElementById('fm_extract_all').checked;
        (HF.state.extract_rows || []).forEach(function(row) { row.checked = checked; });
        HF.sync_extract_checks();
    }

    HF.on_extract_row_change = function on_extract_row_change(event) {
        var input = event && event.target;
        if (!input || input.type !== 'checkbox') {
            return;
        }
        var name = input.getAttribute('data-name') || '';
        var row = (HF.state.extract_rows || []).filter(function(r) { return r.name === name; })[0];
        if (!row) {
            return;
        }
        HF.toggle_extract_row(row, input.checked);
    }

    HF.toggle_extract_row = function toggle_extract_row(row, value) {
        var rows = HF.state.extract_rows || [];
        row.checked = value;
        if (row.dir) {
            var prefix = row.name + '/';
            rows.forEach(function(other) {
                if (other.name.indexOf(prefix) === 0) {
                    other.checked = value;
                }
            });
        } else {
            var parts = row.name.split('/');
            var path = '';
            for (var i = 0; i < parts.length - 1; i++) {
                path = path === '' ? parts[i] : path + '/' + parts[i];
                (function(dir_path) {
                    var kids = HF.extract_child_files(dir_path);
                    rows.forEach(function(other) {
                        if (other.dir && other.name === dir_path) {
                            other.checked = kids.length ? kids.every(function(k) { return k.checked; }) : value;
                        }
                    });
                })(path);
            }
        }
        HF.sync_extract_checks();
    }

    HF.extract_payload_selection = function extract_payload_selection() {
        var files = HF.extract_files();
        var picked = files.filter(function(row) { return row.checked; });
        if (!HF.state.extract_selectable) {
            return { members: '', empty: false };
        }
        if (!picked.length) {
            return { members: '', empty: files.length > 0 };
        }
        if (picked.length === files.length) {
            return { members: '', empty: false };
        }
        return {
            members: JSON.stringify(picked.map(function(row) { return row.name; })),
            empty: false
        };
    }

    HF.start_archive_extract = function start_archive_extract(item) {
        if (!HF.is_archive_item(item)) {
            HF.set_warning_status(HF.labels.unsupported_archive);
            return;
        }
        HF.state.extract_item = item;
        HF.state.extract_rows = [];
        HF.state.extract_truncated = false;
        HF.state.extract_selectable = true;
        HF.state.extract_collapsed = {};
        document.getElementById('fm_extract_source').textContent = item.path;
        document.getElementById('fm_extract_target').value = HF.extract_default_target(item);
        document.getElementById('fm_extract_all').checked = true;
        HF.clear_node(document.getElementById('fm_extract_list'));
        HF.set_extract_hint(HF.labels.extract_loading);
        HF.open_modal('fm_extract_dialog');
        document.getElementById('fm_extract_target').focus();
        HF.request_json(HF.api.list, { path: item.path }, function(data) {
            HF.state.extract_truncated = !!data.truncated;
            HF.set_extract_hint(data.truncated ? HF.format_label(HF.labels.extract_truncated, (data.entries || []).length) : '');
            HF.set_extract_rows(data.entries || []);
        }, function(message) {
            HF.state.extract_truncated = false;
            HF.set_extract_rows([]);
            HF.set_extract_hint(HF.labels.extract_list_failed + (message ? ': ' + message : ''));
        });
    }

    HF.submit_extract_dialog = function submit_extract_dialog() {
        var item = HF.state.extract_item;
        if (!item) {
            return;
        }
        var target_dir = document.getElementById('fm_extract_target').value.trim();
        if (!target_dir || target_dir.charAt(0) !== '/') {
            HF.set_warning_status(HF.labels.enter_absolute_path);
            return;
        }
        var selection = HF.extract_payload_selection();
        if (selection.empty) {
            HF.set_warning_status(HF.labels.extract_none_selected);
            return;
        }
        var payload = { path: item.path, target_dir: target_dir };
        if (selection.members) {
            payload.members = selection.members;
        }
        function submit(overwrite) {
            if (overwrite) {
                payload.overwrite = '1';
            }
            HF.request_archive_write(HF.api.archive_extract_start, payload, HF.start_archive_progress, function(res) {
                if (res && res.code === 3) {
                    HF.confirm_window({
                        title: HF.labels.overwrite,
                        message: HF.labels.extract_overwrite_confirm
                    }).then(function(ok) {
                        if (ok) {
                            submit(true);
                        }
                    });
                    return;
                }
                if (res && res.code === 2 && res.data && res.data.missing_tool) {
                    HF.close_modal();
                    HF.show_archive_missing_tool(res, 'extract');
                    return;
                }
                HF.set_error_status(HF.archive_error_message(res, HF.labels.archive_failed));
            });
        }
        submit(false);
    }

    HF.is_system_folder = function is_system_folder(path) {
        var current_path = String(path || '');
        for (var root in HF.system_folder_paths) {
            if (HF.system_folder_paths.hasOwnProperty(root) && HF.is_child_path(current_path, root)) {
                return true;
            }
        }
        return false;
    }

    HF.can_modify_system_path = function can_modify_system_path(path) {
        return HF.state.preferences.allow_system_operations === 1 || !HF.is_system_folder(path);
    }

    HF.can_modify_item = function can_modify_item(item) {
        return !!(item && item.path !== '/' && HF.can_modify_system_path(item.path));
    }

    HF.context_selection = function context_selection(item) {
        if (item && HF.is_item_selected(item)) {
            return HF.selected_items();
        }
        return item ? [item] : [];
    }

    HF.item_list_paths = function item_list_paths(items) {
        return HF.normalize_item_list(items).map(function(item) {
            return item.path;
        });
    }

    HF.item_list_can_copy = function item_list_can_copy(items) {
        return HF.normalize_item_list(items).every(function(item) {
            return !!(item && item.path && item.path !== '/');
        });
    }

    HF.item_list_can_modify = function item_list_can_modify(items) {
        var normalized = HF.normalize_item_list(items);
        return normalized.length > 0 && normalized.every(function(item) {
            return HF.can_modify_item(item);
        });
    }

    HF.first_write_block_reason = function first_write_block_reason(items) {
        var normalized = HF.normalize_item_list(items);
        for (var i = 0; i < normalized.length; i++) {
            var reason = HF.get_system_block_reason(normalized[i].path);
            if (reason) {
                return reason;
            }
            if (!HF.can_modify_item(normalized[i])) {
                return HF.labels.some_items_cannot_modify;
            }
        }
        return '';
    }

    HF.get_space_block_reason = function get_space_block_reason(path) {
        if (HF.state.current && HF.state.current.kind === 'directory' &&
                HF.state.current.path === path && HF.state.current.has_operation_space === false) {
            return HF.labels.space_less_than_50mb;
        }
        return '';
    }

    HF.get_write_block_reason = function get_write_block_reason(path) {
        return HF.get_system_block_reason(path) || HF.get_space_block_reason(path);
    }

    HF.has_clipboard = function has_clipboard() {
        return !!(HF.state.clipboard && HF.state.clipboard.items && HF.state.clipboard.items.length && HF.state.clipboard.mode);
    }

    HF.can_paste_to_path = function can_paste_to_path(path) {
        return HF.has_clipboard() && !!path && HF.can_modify_system_path(path) && !HF.get_space_block_reason(path);
    }

    HF.can_upload_to_path = function can_upload_to_path(path) {
        return !!path && HF.can_modify_system_path(path) && !HF.get_space_block_reason(path);
    }

    HF.can_move_to_path = HF.can_upload_to_path;

    HF.get_system_block_reason = function get_system_block_reason(path) {
        return !HF.can_modify_system_path(path) ? HF.labels.system_folder_blocked : '';
    }

    HF.set_button_state = function set_button_state(id, disabled, reason) {
        var button = typeof id === 'string' ? document.getElementById(id) : id;
        if (!button) {
            return;
        }
        button.disabled = !!disabled;
        button.title = disabled && reason ? reason : '';
    }

    HF.apply_preferences = function apply_preferences(data) {
        var view_value = Number(data && data.view_mode);
        var allow_value = Number(data && data.allow_system_operations);
        var hidden_value = Number(data && data.show_hidden_files);
        var thumbnail_value = Number(data && data.enable_thumbnails);
        var auto_indent_value = Number(data && data.editor_auto_indent);
        var auto_wrap_value = Number(data && data.editor_auto_wrap);
        var restore_dir_value = Number(data && data.restore_last_directory);
        var last_dir_value = data && data.last_directory;
        var line_numbers_value = Number(data && data.show_line_numbers);
        var mirror_value = data && data.update_mirror;
        var request_buffering_value = Number(data && data.uwsgi_request_buffering);
        var body_size_value = Number(data && data.client_max_body_size);
        HF.state.preferences.view_mode = isNaN(view_value) ? 1 : view_value;
        HF.state.preferences.allow_system_operations = allow_value === 1 ? 1 : 0;
        HF.state.preferences.show_hidden_files = hidden_value === 1 ? 1 : 0;
        HF.state.preferences.enable_thumbnails = thumbnail_value === 1 ? 1 : 0;
        HF.state.preferences.editor_auto_indent = auto_indent_value === 1 ? 1 : 0;
        HF.state.preferences.editor_auto_wrap = auto_wrap_value === 1 ? 1 : 0;
        HF.state.preferences.restore_last_directory = restore_dir_value === 1 ? 1 : 0;
        if (typeof last_dir_value === 'string' && last_dir_value.charAt(0) === '/') {
            HF.state.preferences.last_directory = last_dir_value;
        }
        if (line_numbers_value === 1) {
            HF.state.preferences.show_line_numbers = 1;
        } else if (line_numbers_value === 0) {
            HF.state.preferences.show_line_numbers = 0;
        }
        HF.state.preferences.uwsgi_request_buffering = request_buffering_value === 1 ? 1 : 0;
        HF.state.preferences.client_max_body_size =
            isNaN(body_size_value) ? 128 : Math.max(0, Math.min(1024, Math.floor(body_size_value)));
        HF.state.preferences.uwsgi_config_available = data && data.uwsgi_config_available === true;
        HF.state.preferences['reload-on-as'] =
            HF.normalize_integer_setting(data && data['reload-on-as'], HF.state.preferences['reload-on-as']);
        HF.state.preferences['reload-on-as_enabled'] =
            Number(data && data['reload-on-as_enabled']) === 1 ? 1 : 0;
        HF.state.preferences['reload-on-rss'] =
            HF.normalize_integer_setting(data && data['reload-on-rss'], HF.state.preferences['reload-on-rss']);
        HF.state.preferences['reload-on-rss_enabled'] =
            Number(data && data['reload-on-rss_enabled']) === 1 ? 1 : 0;
        HF.state.preferences['post-buffering'] =
            HF.normalize_integer_setting(data && data['post-buffering'], HF.state.preferences['post-buffering']);
        HF.state.preferences['limit-as'] =
            HF.normalize_integer_setting(data && data['limit-as'], HF.state.preferences['limit-as']);
        HF.state.preferences['reload-mercy'] =
            HF.normalize_integer_setting(data && data['reload-mercy'], HF.state.preferences['reload-mercy']);
        HF.state.preferences['buffer-size'] =
            HF.normalize_integer_setting(data && data['buffer-size'], HF.state.preferences['buffer-size']);
        HF.state.preferences.uhttpd_config_available = data && data.uhttpd_config_available === true;
        HF.state.preferences.uhttpd_script_timeout =
            HF.normalize_integer_setting(data && data.uhttpd_script_timeout, HF.state.preferences.uhttpd_script_timeout);
        HF.state.preferences.uhttpd_network_timeout =
            HF.normalize_integer_setting(data && data.uhttpd_network_timeout, HF.state.preferences.uhttpd_network_timeout);
        HF.state.preferences.home_dir = data && data.home_dir ? String(data.home_dir) : '/tmp/root';
        if (mirror_value === 'auto' || mirror_value === 'gitee' || mirror_value === 'github' || mirror_value === 'gitlab') {
            HF.state.preferences.update_mirror = mirror_value;
        }
        HF.state.preferences.window_width = Math.max(180, Math.min(4096,
            HF.normalize_integer_setting(data && data.window_width, HF.state.preferences.window_width)));
        HF.state.preferences.window_height = Math.max(130, Math.min(4096,
            HF.normalize_integer_setting(data && data.window_height, HF.state.preferences.window_height)));
        HF.state.preferences.mobile_window_width = Math.max(180, Math.min(4096,
            HF.normalize_integer_setting(data && data.mobile_window_width, HF.state.preferences.mobile_window_width)));
        HF.state.preferences.mobile_window_height = Math.max(130, Math.min(4096,
            HF.normalize_integer_setting(data && data.mobile_window_height, HF.state.preferences.mobile_window_height)));
        if (data && data.web_server) {
            HF.state.preferences.web_server = String(data.web_server);
        }
        if (data && data.nginx_running !== undefined) {
            HF.state.preferences.nginx_running = data.nginx_running === true || Number(data.nginx_running) === 1;
        }
        if (data && data.fcm !== undefined) {
            HF.state.preferences.fcm = Number(data.fcm) === 1 ? 1 : 0;
        }
        if (data && data.open_type_map) {
            try {
                HF.state.open_type_map = JSON.parse(data.open_type_map);
            } catch (e) {
                HF.state.open_type_map = {};
            }
        }
        HF.state.view_mode = HF.value_to_view_mode(HF.state.preferences.view_mode);
        HF.apply_editor_wrap_to_windows();
    }

    HF.apply_editor_wrap_to_windows = function apply_editor_wrap_to_windows() {
        var records = HF.window_manager && HF.window_manager.records || [];
        var on = HF.state.preferences.editor_auto_wrap === 1;
        for (var i = 0; i < records.length; i++) {
            var apply = records[i].options && records[i].options.applyWrap;
            if (typeof apply === 'function') {
                apply(on);
            }
        }
    }

    HF.save_preferences = function save_preferences(options, success_message, on_ok, on_error) {
        var section = options && options.section === 'window' ? 'window' :
            (options && (options.section === 'nginx' || options.section === 'web_server') ? 'web_server' : 'basic');
        var payload = { section: section };
        if (section === 'window') {
            payload.window_width = options && options.window_width !== undefined ?
                options.window_width : HF.state.preferences.window_width;
            payload.window_height = options && options.window_height !== undefined ?
                options.window_height : HF.state.preferences.window_height;
            payload.window_target = options && options.window_target === 'mobile' ? 'mobile' : 'desktop';
        } else if (section === 'web_server') {
            payload.uwsgi_request_buffering = options && options.uwsgi_request_buffering !== undefined ?
                options.uwsgi_request_buffering : HF.state.preferences.uwsgi_request_buffering;
            payload.client_max_body_size = options && options.client_max_body_size !== undefined ?
                options.client_max_body_size : HF.state.preferences.client_max_body_size;
            payload['reload-on-as_enabled'] = options && options['reload-on-as_enabled'] !== undefined ?
                options['reload-on-as_enabled'] : HF.state.preferences['reload-on-as_enabled'];
            payload['reload-on-as'] = options && options['reload-on-as'] !== undefined ?
                options['reload-on-as'] : HF.state.preferences['reload-on-as'];
            payload['reload-on-rss_enabled'] = options && options['reload-on-rss_enabled'] !== undefined ?
                options['reload-on-rss_enabled'] : HF.state.preferences['reload-on-rss_enabled'];
            payload['reload-on-rss'] = options && options['reload-on-rss'] !== undefined ?
                options['reload-on-rss'] : HF.state.preferences['reload-on-rss'];
            payload['post-buffering'] = options && options['post-buffering'] !== undefined ?
                options['post-buffering'] : HF.state.preferences['post-buffering'];
            payload['limit-as'] = options && options['limit-as'] !== undefined ?
                options['limit-as'] : HF.state.preferences['limit-as'];
            payload['reload-mercy'] = options && options['reload-mercy'] !== undefined ?
                options['reload-mercy'] : HF.state.preferences['reload-mercy'];
            payload['buffer-size'] = options && options['buffer-size'] !== undefined ?
                options['buffer-size'] : HF.state.preferences['buffer-size'];
            payload.uhttpd_script_timeout = options && options.uhttpd_script_timeout !== undefined ?
                options.uhttpd_script_timeout : HF.state.preferences.uhttpd_script_timeout;
            payload.uhttpd_network_timeout = options && options.uhttpd_network_timeout !== undefined ?
                options.uhttpd_network_timeout : HF.state.preferences.uhttpd_network_timeout;
        } else {
            payload.view_mode = options && options.view_mode !== undefined ? options.view_mode : HF.state.preferences.view_mode;
            payload.allow_system_operations = options && options.allow_system_operations !== undefined ?
                options.allow_system_operations : HF.state.preferences.allow_system_operations;
            payload.show_hidden_files = options && options.show_hidden_files !== undefined ?
                options.show_hidden_files : HF.state.preferences.show_hidden_files;
            payload.home_dir = options && options.home_dir !== undefined ? options.home_dir : HF.state.preferences.home_dir;
            payload.enable_thumbnails = options && options.enable_thumbnails !== undefined ?
                options.enable_thumbnails : HF.state.preferences.enable_thumbnails;
            payload.editor_auto_indent = options && options.editor_auto_indent !== undefined ?
                options.editor_auto_indent : HF.state.preferences.editor_auto_indent;
            payload.editor_auto_wrap = options && options.editor_auto_wrap !== undefined ?
                options.editor_auto_wrap : HF.state.preferences.editor_auto_wrap;
            payload.restore_last_directory = options && options.restore_last_directory !== undefined ?
                options.restore_last_directory : HF.state.preferences.restore_last_directory;
            payload.update_mirror = options && options.update_mirror !== undefined ?
                options.update_mirror : HF.state.preferences.update_mirror;
        }
        HF.request_write(HF.api.save_preferences, payload, success_message || '', function(data) {
            if (section === 'window') {
                var width_key = payload.window_target === 'mobile' ? 'mobile_window_width' : 'window_width';
                var height_key = payload.window_target === 'mobile' ? 'mobile_window_height' : 'window_height';
                HF.state.preferences[width_key] = Math.max(180, Math.min(4096,
                    HF.normalize_integer_setting(data && data[width_key], Number(payload.window_width))));
                HF.state.preferences[height_key] = Math.max(130, Math.min(4096,
                    HF.normalize_integer_setting(data && data[height_key], Number(payload.window_height))));
            } else {
                HF.apply_preferences(data || payload);
            }
            if (on_ok) {
                on_ok(data || payload);
            }
        }, on_error);
    }

    HF.load_preferences = function load_preferences(on_done) {
        HF.Util.ajax({
            url: HF.api.preferences,
            type: 'GET',
            dataType: 'json',
            success: function(res) {
                if (res && res.code === 0) {
                    HF.apply_preferences(res.data || {});
                }
                if (on_done) {
                    on_done();
                }
            },
            error: function() {
                HF.apply_preferences(HF.state.preferences);
                if (on_done) {
                    on_done();
                }
            }
        });
    }

    HF.current_key = function current_key(entry) {
        if (!entry) {
            return '';
        }
        return entry.kind === 'directory' ? 'directory:' + entry.path : entry.kind;
    }

    HF.push_history = function push_history(entry) {
        if (HF.current_key(HF.state.history[HF.state.history_index]) === HF.current_key(entry)) {
            HF.update_toolbar();
            return;
        }
        HF.state.history = HF.state.history.slice(0, HF.state.history_index + 1);
        HF.state.history.push({ kind: entry.kind, path: entry.path || '' });
        HF.state.history_index = HF.state.history.length - 1;
        HF.update_toolbar();
    }

    HF.navigate = function navigate(entry, add_history) {
        if (entry.kind === 'directory') {
            HF.open_path(entry.path, add_history);
        } else {
            HF.show_virtual(entry.kind, add_history);
        }
    }

    HF.update_toolbar = function update_toolbar() {
        document.getElementById('fm_back').disabled = HF.state.history_index <= 0;
        document.getElementById('fm_forward').disabled = HF.state.history_index >= HF.state.history.length - 1;
        document.getElementById('fm_up').disabled = !HF.state.current || HF.state.current.kind !== 'directory';
        HF.update_selection_button();
        HF.render_breadcrumb();
    }

    HF.normalize_item_list = function normalize_item_list(items) {
        var result = [];
        var seen = {};
        (items || []).forEach(function(item) {
            if (!item || !item.path || seen[item.path]) {
                return;
            }
            seen[item.path] = true;
            result.push(item);
        });
        return result;
    }

    HF.selected_items = function selected_items() {
        return HF.normalize_item_list(HF.state.selected_items || []);
    }

    HF.is_item_selected = function is_item_selected(item) {
        if (!item || !item.path) {
            return false;
        }
        return HF.state.selected_order.indexOf(item.path) >= 0;
    }

    HF.apply_selection_classes = function apply_selection_classes() {
        var selected = {};
        HF.state.selected_order.forEach(function(path) {
            selected[path] = true;
        });
        var nodes = document.querySelectorAll('.fm-item[data-path]');
        for (var i = 0; i < nodes.length; i++) {
            var path = nodes[i].getAttribute('data-path');
            nodes[i].classList.toggle('selected', !!selected[path]);
            var checkbox = nodes[i].querySelector('.fm-item-checkbox');
            if (checkbox) {
                HF.sync_item_checkbox(checkbox, selected[path]);
            }
        }
        HF.update_selection_button();
    }

    HF.set_selected_items = function set_selected_items(items, primary, anchor) {
        var normalized = HF.normalize_item_list(items);
        HF.state.selected_items = normalized;
        HF.state.selected_order = normalized.map(function(item) { return item.path; });
        HF.state.selected = normalized.length > 0 ? (primary || normalized[normalized.length - 1]) : null;
        if (anchor !== undefined) {
            HF.state.selection_anchor = anchor;
        } else if (HF.state.selected) {
            HF.state.selection_anchor = HF.state.selected;
        } else {
            HF.state.selection_anchor = null;
        }
        HF.apply_selection_classes();
        HF.render_details();
        HF.update_selection_button();
    }

    HF.clear_selection = function clear_selection() {
        HF.set_selected_items([], null, null);
    }

    HF.all_rendered_selected = function all_rendered_selected() {
        var rendered = HF.rendered_file_items();
        return rendered.length > 0 && HF.selected_items().length >= rendered.length;
    };

    HF.update_selection_button = function update_selection_button() {
        var button = document.getElementById('fm_select_mode');
        var icon = document.getElementById('fm_select_mode_icon');
        var exit_btn = document.getElementById('fm_select_exit');
        if (!button || !icon) return;
        var mode = !!HF.state.selection_mode;
        var count = HF.selected_items().length;
        var all_selected = mode && HF.all_rendered_selected();
        icon.innerHTML = all_selected ? '&#9745;' : '&#9744;';
        button.classList.toggle('active', mode);
        if (!mode) {
            button.title = HF.tr('Selection mode') || 'Selection mode';
        } else {
            button.title = all_selected ? (HF.tr('Deselect all') || 'Deselect all') : (HF.tr('Select all') || 'Select all');
        }
        if (exit_btn) exit_btn.style.display = mode ? '' : 'none';
        var badge = document.getElementById('fm_select_count');
        if (badge) {
            badge.textContent = mode && count ? String(count) : '';
        }
    };

    HF.handle_selection_button = function handle_selection_button() {
        if (!HF.state.selection_mode) {
            HF.state.selection_mode = true;
            HF.clear_selection();
            return;
        }
        if (HF.all_rendered_selected()) {
            HF.clear_selection();
            return;
        }
        var items = HF.rendered_file_items().map(function(entry) { return entry.item; });
        HF.set_selected_items(items, items.length ? items[items.length - 1] : null, items.length ? items[0] : null);
    };

    HF.exit_selection_mode = function exit_selection_mode() {
        HF.state.selection_mode = false;
        HF.clear_selection();
    };

    HF.set_item_checked = function set_item_checked(item, checked) {
        if (!!checked !== HF.is_item_selected(item)) {
            HF.toggle_selected_item(item);
        }
    };

    HF.sync_item_checkbox = function sync_item_checkbox(checkbox, checked) {
        checkbox.checked = !!checked;
        checkbox.style.display = HF.state.selection_mode ? 'block' : 'none';
    };

    HF.set_selected = function set_selected(item, node) {
        HF.set_selected_items(item ? [item] : [], item || null, item || null);
        if (node) {
            node.classList.add('selected');
        }
    }

    HF.toggle_selected_item = function toggle_selected_item(item) {
        if (!item || !item.path) {
            return;
        }
        var items = HF.selected_items();
        if (HF.is_item_selected(item)) {
            items = items.filter(function(entry) { return entry.path !== item.path; });
            HF.set_selected_items(items, items.length ? items[items.length - 1] : null, item);
        } else {
            items.push(item);
            HF.set_selected_items(items, item, item);
        }
    }

    HF.rendered_file_items = function rendered_file_items() {
        var nodes = Array.prototype.slice.call(document.querySelectorAll('#fm_content .fm-item[data-path]'));
        return nodes.map(function(node) {
            return { node: node, item: node._fmItem };
        }).filter(function(entry) {
            return !!(entry.item && entry.item.path);
        });
    }

    HF.select_range_to = function select_range_to(item) {
        if (!item || !item.path) {
            return;
        }
        var rendered = HF.rendered_file_items();
        var anchor_path = HF.state.selection_anchor && HF.state.selection_anchor.path;
        var start = -1;
        var end = -1;
        rendered.forEach(function(entry, index) {
            if (entry.item.path === anchor_path) {
                start = index;
            }
            if (entry.item.path === item.path) {
                end = index;
            }
        });
        if (start < 0 || end < 0) {
            HF.set_selected(item);
            return;
        }
        var from = Math.min(start, end);
        var to = Math.max(start, end);
        HF.set_selected_items(rendered.slice(from, to + 1).map(function(entry) {
            return entry.item;
        }), item, HF.state.selection_anchor);
    }

    HF.handle_item_click = function handle_item_click(event, item, node) {
        if (HF.state.suppress_next_click) {
            HF.state.suppress_next_click = false;
            return;
        }
        if (event.shiftKey) {
            HF.select_range_to(item);
        } else if (event.ctrlKey || event.metaKey) {
            HF.toggle_selected_item(item);
        } else {
            HF.set_selected(item, node);
        }
    }

    HF.render_details = function render_details() {
        var items = HF.selected_items();
        if (items.length > 1) {
            var size = 0;
            var has_directory = false;
            items.forEach(function(item) {
                if (item.type === 'directory') {
                    has_directory = true;
                } else {
                    size += Number(item.size || 0);
                }
            });
            document.getElementById('fm_detail_name').textContent = HF.format_label(HF.labels.selected_items, items.length);
            document.getElementById('fm_detail_path').textContent = '-';
            document.getElementById('fm_detail_type').textContent = HF.labels.multiple_items;
            document.getElementById('fm_detail_size').textContent = has_directory ? '-' : HF.format_size(size);
            document.getElementById('fm_detail_mtime').textContent = '-';
            return;
        }
        var item = HF.state.selected;
        document.getElementById('fm_detail_name').textContent = item ? item.name : '-';
        document.getElementById('fm_detail_path').textContent = item ? item.path : '-';
        document.getElementById('fm_detail_type').textContent = item ? item.display_type : '-';
        document.getElementById('fm_detail_size').textContent = item ? item.display_size : '-';
        document.getElementById('fm_detail_mtime').textContent = item ? item.display_mtime : '-';
        document.getElementById('fm_detail_mode').textContent = item ? (item.mode || '-') : '-';
    }

    HF.ensure_item_hover_card = function ensure_item_hover_card() {
        if (!HF.state.item_hover_card) {
            var host = document.querySelector('.file-manager');
            if (!host) {
                return null;
            }
            var card = document.createElement('div');
            card.className = 'fm-item-hover-card';
            host.appendChild(card);
            HF.state.item_hover_card = card;
        }
        return HF.state.item_hover_card;
    }

    HF.position_item_hover_card = function position_item_hover_card(event) {
        var card = HF.state.item_hover_card;
        if (!card || card.style.display !== 'block' || !event) {
            return;
        }
        var left = Number(event.clientX || 0) + 14;
        var top = Number(event.clientY || 0) + 14;
        var rect = card.getBoundingClientRect();
        left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
        top = Math.max(8, Math.min(top, window.innerHeight - rect.height - 8));
        card.style.left = left + 'px';
        card.style.top = top + 'px';
    }

    HF.append_item_hover_row = function append_item_hover_row(card, label, value) {
        var row = document.createElement('div');
        row.className = 'fm-item-hover-row';
        var label_node = document.createElement('div');
        label_node.className = 'fm-item-hover-label';
        label_node.textContent = label;
        var value_node = document.createElement('div');
        value_node.className = 'fm-item-hover-value';
        value_node.textContent = value || '-';
        row.appendChild(label_node);
        row.appendChild(value_node);
        card.appendChild(row);
    }

    HF.show_item_hover_card = function show_item_hover_card(item, event) {
        if (!item || HF.state.drag_item || HF.state.selection_dragging) {
            return;
        }
        var card = HF.ensure_item_hover_card();
        if (!card) {
            return;
        }
        HF.clear_node(card);
        HF.append_item_hover_row(card, HF.labels.name, item.name);
        HF.append_item_hover_row(card, HF.labels.type, item.display_type);
        HF.append_item_hover_row(card, HF.labels.size, item.display_size);
        HF.append_item_hover_row(card, HF.labels.modified, item.display_mtime);
        HF.append_item_hover_row(card, HF.labels.path, item.path);
        HF.append_item_hover_row(card, HF.labels.permissions, item.mode || '-');
        card.style.display = 'block';
        HF.position_item_hover_card(event);
    }

    HF.hide_item_hover_card = function hide_item_hover_card() {
        if (HF.state.item_hover_timer) {
            clearTimeout(HF.state.item_hover_timer);
            HF.state.item_hover_timer = null;
        }
        HF.state.item_hover_event = null;
        if (HF.state.item_hover_card) {
            HF.state.item_hover_card.style.display = 'none';
        }
    }

    HF.schedule_item_hover_card = function schedule_item_hover_card(item, event) {
        if (!item || event.pointerType === 'touch') {
            return;
        }
        if (HF.state.item_hover_timer) {
            clearTimeout(HF.state.item_hover_timer);
        }
        HF.state.item_hover_event = {
            clientX: event.clientX,
            clientY: event.clientY
        };
        HF.state.item_hover_timer = setTimeout(function() {
            HF.state.item_hover_timer = null;
            HF.show_item_hover_card(item, HF.state.item_hover_event);
        }, 1000);
    }

    HF.bind_item_hover = function bind_item_hover(node, item) {
        node.addEventListener('mouseenter', function(event) {
            HF.schedule_item_hover_card(item, event);
        });
        node.addEventListener('mousemove', function(event) {
            HF.state.item_hover_event = {
                clientX: event.clientX,
                clientY: event.clientY
            };
            HF.position_item_hover_card(HF.state.item_hover_event);
        });
        node.addEventListener('mouseleave', HF.hide_item_hover_card);
        node.addEventListener('mousedown', HF.hide_item_hover_card);
        node.addEventListener('contextmenu', HF.hide_item_hover_card);
    }

    HF.rects_intersect = function rects_intersect(a, b) {
        return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
    }

    HF.intersect_rect = function intersect_rect(a, b) {
        var rect = {
            left: Math.max(a.left, b.left),
            top: Math.max(a.top, b.top),
            right: Math.min(a.right, b.right),
            bottom: Math.min(a.bottom, b.bottom)
        };
        rect.width = rect.right - rect.left;
        rect.height = rect.bottom - rect.top;
        return rect;
    }

    HF.rect_contains = function rect_contains(rect, x, y, tolerance) {
        return (rect.width > 0 || rect.height > 0) &&
            x >= rect.left - tolerance && x <= rect.right + tolerance &&
            y >= rect.top - tolerance && y <= rect.bottom + tolerance;
    }

    HF.is_item_content_at = function is_item_content_at(x, y) {
        var target = document.elementFromPoint(x, y);
        var item = target ? target.closest('.fm-item') : null;
        if (!item) {
            return false;
        }
        var zones = item.querySelectorAll('.fm-item-icon, .fm-item-thumbnail-frame, .fm-item-checkbox');
        for (var z = 0; z < zones.length; z++) {
            if (HF.rect_contains(zones[z].getBoundingClientRect(), x, y, 3)) {
                return true;
            }
        }
        var clipped = ['.fm-item-name', '.fm-item-meta', '.fm-symlink-target', '.fm-item-column'];
        for (var i = 0; i < clipped.length; i++) {
            var el = item.querySelector(clipped[i]);
            if (!el || !el.firstChild) {
                continue;
            }
            var range = document.createRange();
            range.selectNodeContents(el);
            var rect = HF.intersect_rect(range.getBoundingClientRect(), el.getBoundingClientRect());
            if (HF.rect_contains(rect, x, y, 3)) {
                return true;
            }
        }
        return false;
    }

    HF.event_on_item_content = function event_on_item_content(event) {
        return event.fm_content_hit === true || HF.is_item_content_at(event.clientX, event.clientY);
    }

    HF.blank_menu_allowed = function blank_menu_allowed() {
        return !HF.state.selection_mode;
    }

    HF.selection_rect = function selection_rect(x1, y1, x2, y2) {
        return {
            left: Math.min(x1, x2),
            top: Math.min(y1, y2),
            right: Math.max(x1, x2),
            bottom: Math.max(y1, y2)
        };
    }

    HF.ensure_selection_box = function ensure_selection_box() {
        if (!HF.state.selection_box) {
            HF.state.selection_box = document.createElement('div');
            HF.state.selection_box.className = 'fm-selection-box';
            document.body.appendChild(HF.state.selection_box);
        }
        return HF.state.selection_box;
    }

    HF.marquee_scroller = function marquee_scroller() {
        var node = document.getElementById('fm_content');
        while (node && node !== document.body) {
            if (/(auto|scroll)/.test(window.getComputedStyle(node).overflowY) &&
                    node.scrollHeight > node.clientHeight) {
                return node;
            }
            node = node.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }

    HF.marquee_scroll_offset = function marquee_scroll_offset() {
        var scroller = HF.marquee_scroller();
        return {
            x: HF.state.marquee_scroll_x - scroller.scrollLeft,
            y: HF.state.marquee_scroll_y - scroller.scrollTop
        };
    }

    HF.snapshot_marquee_origin = function snapshot_marquee_origin(x, y) {
        var scroller = HF.marquee_scroller();
        HF.state.selection_start_x = x;
        HF.state.selection_start_y = y;
        HF.state.marquee_scroll_x = scroller.scrollLeft;
        HF.state.marquee_scroll_y = scroller.scrollTop;
    }

    HF.apply_marquee_selection = function apply_marquee_selection(cx, cy) {
        if (!HF.state.selection_dragging) {
            return;
        }
        HF.state.marquee_last_x = cx;
        HF.state.marquee_last_y = cy;
        var offset = HF.marquee_scroll_offset();
        var rect = HF.selection_rect(
            HF.state.selection_start_x + offset.x,
            HF.state.selection_start_y + offset.y,
            cx,
            cy
        );
        var width = rect.right - rect.left;
        var height = rect.bottom - rect.top;
        if (width > 3 || height > 3) {
            HF.state.selection_moved = true;
        }
        var box = HF.ensure_selection_box();
        box.style.display = HF.state.selection_moved ? 'block' : 'none';
        box.style.left = rect.left + 'px';
        box.style.top = rect.top + 'px';
        box.style.width = width + 'px';
        box.style.height = height + 'px';
        if (!HF.state.selection_moved) {
            return;
        }
        var selected = HF.state.selection_base.slice();
        var seen = {};
        selected.forEach(function(item) {
            if (item && item.path) {
                seen[item.path] = true;
            }
        });
        HF.rendered_file_items().forEach(function(entry) {
            if (entry.node.offsetParent === null || seen[entry.item.path]) {
                return;
            }
            if (HF.rects_intersect(rect, entry.node.getBoundingClientRect())) {
                selected.push(entry.item);
                seen[entry.item.path] = true;
            }
        });
        HF.set_selected_items(selected, selected.length ? selected[selected.length - 1] : null, HF.state.selection_anchor);
    }

    HF.update_marquee_selection = function update_marquee_selection(event) {
        HF.apply_marquee_selection(event.clientX, event.clientY);
    }

    HF.sync_marquee_on_scroll = function sync_marquee_on_scroll() {
        if (HF.state.selection_dragging && HF.state.selection_moved) {
            HF.apply_marquee_selection(HF.state.marquee_last_x, HF.state.marquee_last_y);
        }
    }

    HF.stop_marquee_selection = function stop_marquee_selection(event) {
        if (!HF.state.selection_dragging) {
            return;
        }
        document.removeEventListener('mousemove', HF.update_marquee_selection);
        document.removeEventListener('mouseup', HF.stop_marquee_selection);
        document.removeEventListener('scroll', HF.sync_marquee_on_scroll, true);
        document.getElementById('fm_content').classList.remove('selecting');
        if (HF.state.selection_box) {
            HF.state.selection_box.style.display = 'none';
        }
        if (HF.state.selection_moved) {
            HF.state.suppress_next_click = true;
        } else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
            HF.clear_selection();
        }
        HF.state.selection_dragging = false;
        HF.state.selection_moved = false;
        HF.state.selection_base = [];
    }

    HF.start_marquee_selection = function start_marquee_selection(event) {
        if (event.button !== 0 || event.target.closest('.fm-item') || event.target.closest('button, input, textarea, select, a')) {
            return;
        }
        if (!HF.state.current || (HF.state.current.kind !== 'directory' && HF.state.current.kind !== 'quick_access' && HF.state.current.kind !== 'this_pc')) {
            return;
        }
        HF.hide_context_menus();
        HF.state.selection_dragging = true;
        HF.state.selection_moved = false;
        HF.state.selection_start_x = event.clientX;
        HF.state.selection_start_y = event.clientY;
        HF.snapshot_marquee_origin(event.clientX, event.clientY);
        HF.state.marquee_last_x = event.clientX;
        HF.state.marquee_last_y = event.clientY;
        HF.state.selection_base = (event.ctrlKey || event.metaKey) ? HF.selected_items() : [];
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
            HF.clear_selection();
        }
        document.getElementById('fm_content').classList.add('selecting');
        HF.ensure_selection_box();
        document.addEventListener('mousemove', HF.update_marquee_selection);
        document.addEventListener('mouseup', HF.stop_marquee_selection);
        document.addEventListener('scroll', HF.sync_marquee_on_scroll, true);
    }

    HF.create_sidebar_button = function create_sidebar_button(label, icon, class_name, on_click) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = class_name;
        var image = document.createElement('img');
        image.className = 'fm-nav-icon';
        image.src = HF.icon_url(icon);
        image.alt = '';
        image.draggable = false;
        var text = document.createElement('span');
        text.className = 'fm-nav-label';
        text.textContent = label;
        button.appendChild(image);
        button.appendChild(text);
        button.addEventListener('click', on_click);
        return button;
    }

    HF.bookmark_index = function bookmark_index(path) {
        var list = (HF.state.navigation && HF.state.navigation.bookmarks) || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].path === path) {
                return i;
            }
        }
        return -1;
    }

    HF.all_bookmark_folders = function all_bookmark_folders() {
        var explicit = HF.state.navigation.bookmark_folders || [];
        var used = [];
        (HF.state.navigation.bookmarks || []).forEach(function(entry) {
            var f = entry.folder || '';
            if (f && explicit.indexOf(f) < 0 && used.indexOf(f) < 0) {
                used.push(f);
            }
        });
        return explicit.concat(used);
    }

    HF.close_anchor_menus = function close_anchor_menus(except_menu) {
        var menus = document.querySelectorAll('.fm-tool-dropdown[data-anchor-menu], .fm-fav-panel[data-anchor-menu]');
        for (var i = 0; i < menus.length; i++) {
            if (menus[i] !== except_menu) {
                HF.hide_anchor_menu(menus[i]);
            }
        }
    }

    HF.hide_anchor_menu = function hide_anchor_menu(menu) {
        if (!menu || menu.style.display === 'none') {
            return;
        }
        menu.style.display = 'none';
        var button = document.getElementById(menu.getAttribute('data-anchor-menu'));
        if (button) {
            button.classList.remove('menu-open');
        }
        HF.keep_page_still(HF.anchor_menus_visible());
    }

    HF.anchor_menu_open = function anchor_menu_open(button) {
        var menu = document.getElementById(button.getAttribute('data-menu'));
        return !!menu && menu.style.display === 'block';
    }

    HF.toggle_anchor_menu = function toggle_anchor_menu(button) {
        var menu = document.getElementById(button.getAttribute('data-menu'));
        if (!menu) {
            return;
        }
        var open = HF.anchor_menu_open(button);
        HF.close_anchor_menus();
        if (open) {
            return;
        }
        if (menu.id === 'fm_fav_panel') {
            HF.render_fav_panel();
        }
        HF.hide_context_menus();
        HF.show_anchor_menu(menu, button);
        button.classList.add('menu-open');
    }

    HF.fav_panel = function fav_panel() {
        return document.getElementById('fm_fav_panel');
    }

    HF.scroll_inside_overlay = function scroll_inside_overlay(target) {
        return !!(target && target.closest && target.closest('.fm-fav-panel, .fm-tool-dropdown, .fm-context-menu'));
    }

    HF.anchor_menus_visible = function anchor_menus_visible() {
        var menus = document.querySelectorAll('.fm-tool-dropdown[data-anchor-menu], .fm-fav-panel[data-anchor-menu]');
        for (var i = 0; i < menus.length; i++) {
            if (menus[i].style.display === 'block') {
                return true;
            }
        }
        return false;
    }

    HF.keep_page_still = function keep_page_still(locked) {
        var state = HF.state.page_still || { on: false, overflow: '' };
        if (!!locked === state.on) {
            return;
        }
        if (locked) {
            state.overflow = document.body.style.overflow || '';
        }
        document.body.style.overflow = locked ? 'hidden' : state.overflow;
        state.on = !!locked;
        HF.state.page_still = state;
    }

    HF.position_anchor_menu = function position_anchor_menu(menu, button) {
        var rect = button.getBoundingClientRect();
        var width = menu.offsetWidth || 170;
        var left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
        var top = rect.bottom + 6;
        if (top + menu.offsetHeight > window.innerHeight - 8) {
            top = Math.max(8, rect.top - menu.offsetHeight - 6);
        }
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }

    HF.reposition_anchor_menus = function reposition_anchor_menus() {
        var menus = document.querySelectorAll('.fm-tool-dropdown[data-anchor-menu], .fm-fav-panel[data-anchor-menu]');
        for (var i = 0; i < menus.length; i++) {
            if (menus[i].style.display !== 'block') {
                continue;
            }
            var button = document.getElementById(menus[i].getAttribute('data-anchor-menu'));
            if (button) {
                HF.position_anchor_menu(menus[i], button);
            }
        }
    }

    HF.show_anchor_menu = function show_anchor_menu(menu, button) {
        menu.style.display = 'block';
        HF.position_anchor_menu(menu, button);
        HF.keep_page_still(true);
    }

    HF.bind_toolbar_actions = function bind_toolbar_actions() {
        var menus = document.querySelectorAll('.fm-toolbar [data-menu]');
        for (var i = 0; i < menus.length; i++) {
            (function(button) {
                button.addEventListener('click', function(event) {
                    event.stopPropagation();
                    HF.toggle_anchor_menu(button);
                });
            })(menus[i]);
        }
        var star = document.getElementById('fm_address_star');
        if (star) {
            star.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                HF.toggle_bookmark();
            });
        }
        var follow = function() {
            if (!HF.state.page_still || !HF.state.page_still.on) {
                return;
            }
            HF.reposition_anchor_menus();
        };
        window.addEventListener('resize', follow, { passive: true });
        document.addEventListener('scroll', follow, { passive: true, capture: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('scroll', follow, { passive: true });
            window.visualViewport.addEventListener('resize', follow, { passive: true });
        }
    }

    HF.fav_panel_row = function fav_panel_row(entry) {
        var row = document.createElement('div');
        row.className = 'fm-fav-row';
        var main = document.createElement('button');
        main.type = 'button';
        main.className = 'fm-fav-main';
        var star = document.createElement('span');
        star.className = 'fm-fav-star' + (entry.exists ? '' : ' is-missing');
        star.textContent = '\u2605';
        var copy = document.createElement('span');
        copy.className = 'fm-fav-copy';
        var name = document.createElement('span');
        name.className = 'fm-fav-name';
        name.textContent = entry.label;
        var path = document.createElement('span');
        path.className = 'fm-fav-path';
        path.textContent = entry.path;
        copy.appendChild(name);
        copy.appendChild(path);
        main.appendChild(star);
        main.appendChild(copy);
        main.addEventListener('click', function() {
            if (HF.state.suppress_next_click) {
                HF.state.suppress_next_click = false;
                return;
            }
            HF.close_anchor_menus();
            if (entry.exists) {
                HF.open_path(entry.path, true);
            } else {
                HF.set_warning_status(HF.labels.unavailable + ': ' + entry.path);
            }
        });
        row.appendChild(main);
        HF.bind_bookmark_menu(row, entry);
        return row;
    }

    HF.fav_panel_header = function fav_panel_header() {
        var bar = document.createElement('div');
        bar.className = 'fm-fav-head';
        var title = document.createElement('span');
        title.className = 'fm-fav-head-title';
        title.textContent = HF.labels.favorites;
        bar.appendChild(title);
        var created = document.createElement('button');
        created.type = 'button';
        created.className = 'fm-fav-new';
        created.title = HF.labels.new_folder;
        created.setAttribute('aria-label', HF.labels.new_folder);
        var image = document.createElement('img');
        image.className = 'fm-fav-icon';
        image.src = HF.icon_url('folder-new');
        image.alt = '';
        image.draggable = false;
        image.onerror = function() { this.style.display = 'none'; };
        created.appendChild(image);
        created.addEventListener('click', function(event) {
            event.stopPropagation();
            HF.open_name_dialog('bm_folder_new');
        });
        bar.appendChild(created);
        return bar;
    }

    HF.render_fav_panel = function render_fav_panel() {
        var panel = HF.fav_panel();
        if (!panel) {
            return;
        }
        HF.clear_node(panel);
        panel.appendChild(HF.fav_panel_header());
        var expanded = HF.state.navigation.fav_expanded || [];
        var entries = HF.state.navigation.bookmarks || [];

        entries.forEach(function(entry) {
            if (!entry.folder) {
                panel.appendChild(HF.fav_panel_row(entry));
            }
        });

        HF.all_bookmark_folders().forEach(function(folder) {
            var is_collapsed = expanded.indexOf(folder) < 0;
            var group = document.createElement('div');
            group.className = 'fm-fav-folder';
            var header = document.createElement('button');
            header.type = 'button';
            header.className = 'fm-fav-folder-head' + (is_collapsed ? ' is-collapsed' : '');
            var caret = document.createElement('span');
            caret.className = 'fm-heading-caret';
            caret.textContent = is_collapsed ? '\u25B8' : '\u25BE';
            var fimage = document.createElement('img');
            fimage.className = 'fm-fav-icon';
            fimage.src = HF.icon_url('folder');
            fimage.alt = '';
            fimage.draggable = false;
            var name = document.createElement('span');
            name.className = 'fm-fav-folder-name';
            name.textContent = folder;
            header.appendChild(caret);
            header.appendChild(fimage);
            header.appendChild(name);
            var body = document.createElement('div');
            body.className = 'fm-fav-folder-body';
            body.style.display = is_collapsed ? 'none' : 'block';
            header.addEventListener('click', function() {
                if (HF.state.suppress_next_click) {
                    HF.state.suppress_next_click = false;
                    return;
                }
                var now_collapsed = body.style.display !== 'none';
                body.style.display = now_collapsed ? 'none' : 'block';
                caret.textContent = now_collapsed ? '\u25B8' : '\u25BE';
                header.classList.toggle('is-collapsed', now_collapsed);
                var expanded_list = HF.state.navigation.fav_expanded || [];
                var at = expanded_list.indexOf(folder);
                if (now_collapsed && at >= 0) {
                    expanded_list.splice(at, 1);
                }
                else if (!now_collapsed && at < 0) {
                    expanded_list.push(folder);
                }
                HF.request_write(HF.api.bookmark_folder_state,
                    { name: folder, expanded: now_collapsed ? '0' : '1' }, '', function() {});
            });
            entries.forEach(function(entry) {
                if (entry.folder === folder) {
                    body.appendChild(HF.fav_panel_row(entry));
                }
            });
            var stub = { label: folder, path: folder, folder: folder, is_folder: true, body: body, head: header, caret: caret };
            HF.bind_bookmark_menu(header, stub);
            group.appendChild(header);
            group.appendChild(body);
            panel.appendChild(group);
        });

    }

    document.addEventListener('click', function(event) {
        var target = event.target;
        if (target && target.closest && target.closest('[data-menu], .fm-tool-dropdown, .fm-fav-panel, .fm-context-menu, .fm-dialog')) {
            return;
        }
        HF.hide_context_menus();
    });

    HF.update_star = function update_star() {
        var star = document.getElementById('fm_address_star');
        if (!star) {
            return;
        }
        var path = HF.state.current && HF.state.current.kind === 'directory' ? HF.state.current.path : null;
        star.style.display = path ? '' : 'none';
        var starred = path !== null && HF.bookmark_index(path) >= 0;
        star.textContent = starred ? '\u2605' : '\u2606';
        star.classList.toggle('is-starred', starred);
        star.title = starred ? HF.labels.remove_bookmark : HF.labels.add_bookmark;
        star.setAttribute('aria-label', star.title);
    }

    HF.apply_bookmarks = function apply_bookmarks(data) {
        if (Array.isArray(data))
            data = { bookmarks: data };
        data = data || {};
        HF.state.navigation.bookmarks = data.bookmarks || [];
        HF.state.navigation.bookmark_folders = data.bookmark_folders || [];
        HF.state.navigation.fav_expanded = data.fav_expanded || [];
        HF.render_sidebar();
        HF.update_star();
        var panel = HF.fav_panel();
        if (panel && panel.style.display === 'block') {
            HF.render_fav_panel();
        }
    }

    HF.bookmark_folders = function bookmark_folders() {
        return HF.all_bookmark_folders();
    }

    HF.fill_bookmark_folder_options = function fill_bookmark_folder_options(selected) {
        var select = document.getElementById('fm_bookmark_folder');
        if (!select) {
            return;
        }
        HF.clear_node(select);
        var def = document.createElement('option');
        def.value = '';
        def.textContent = HF.labels.no_folder;
        select.appendChild(def);
        HF.bookmark_folders().forEach(function(folder) {
            var opt = document.createElement('option');
            opt.value = folder;
            opt.textContent = folder;
            select.appendChild(opt);
        });
        var nw = document.createElement('option');
        nw.value = '__new__';
        nw.textContent = HF.labels.new_folder + ' \u2026';
        select.appendChild(nw);
        select.value = (selected && HF.bookmark_folders().indexOf(selected) >= 0) ? selected : '';
        if (select.value !== '__new__') {
            document.getElementById('fm_bookmark_folder_new').style.display = 'none';
            document.getElementById('fm_bookmark_folder_new').value = '';
        }
    }

    HF.selected_bookmark_folder = function selected_bookmark_folder() {
        var select = document.getElementById('fm_bookmark_folder');
        if (!select || select.value !== '__new__') {
            return select ? select.value : '';
        }
        return document.getElementById('fm_bookmark_folder_new').value.trim();
    }

    HF.open_bookmark_editor = function open_bookmark_editor(existing, from_favorites) {
        var path = existing ? existing.path :
            (!from_favorites && HF.state.current && HF.state.current.kind === 'directory' ? HF.state.current.path : '/');
        var label = existing ? existing.label :
            (path === '/' ? '' : (HF.mount_point_name(path) || String(path).replace(/\/$/, '').split('/').pop() || path));
        HF.state.bookmark_editing = existing || null;
        document.getElementById('fm_bookmark_title').textContent = existing ? HF.labels.edit_bookmark : HF.labels.add_bookmark;
        document.getElementById('fm_bookmark_label').value = label;
        document.getElementById('fm_bookmark_path').value = path;
        HF.fill_bookmark_folder_options(existing ? existing.folder : '');
        HF.open_modal('fm_bookmark_dialog');
        document.getElementById('fm_bookmark_label').focus();
        document.getElementById('fm_bookmark_label').select();
    }

    HF.submit_bookmark_dialog = function submit_bookmark_dialog() {
        var label = document.getElementById('fm_bookmark_label').value.trim();
        var path = document.getElementById('fm_bookmark_path').value.trim();
        if (!path || path.charAt(0) !== '/') {
            HF.set_warning_status(HF.labels.invalid_name);
            return;
        }
        var editing = HF.state.bookmark_editing || null;
        HF.request_write(HF.api.bookmark_save, {
                label: label,
                path: path,
                folder: HF.selected_bookmark_folder(),
                original_path: editing ? editing.path : ''
            },
            editing ? HF.labels.bookmark_updated : HF.labels.bookmark_saved,
            function(data) {
                HF.apply_bookmarks(data);
                HF.state.bookmark_editing = null;
                HF.close_modal();
            });
    }

    HF.delete_bookmark = function delete_bookmark(entry) {
        HF.request_write(HF.api.bookmark_delete, { path: entry.path },
            HF.labels.bookmark_removed,
            function(data) {
                HF.apply_bookmarks(data);
            });
    }

    HF.delete_bookmark_folder = function delete_bookmark_folder(folder) {
        HF.request_write(HF.api.bookmark_folder_delete, { name: folder }, HF.labels.delete_folder + ': ' + folder,
            function(data) { HF.apply_bookmarks(data); });
    }

    HF.open_bookmark_folder = function open_bookmark_folder(item) {
        if (item && item.body && item.body.style.display === 'none') {
            item.body.style.display = 'block';
            if (item.caret) {
                item.caret.textContent = '\u25BE';
            }
            if (item.head) {
                item.head.classList.remove('is-collapsed');
            }
            var expanded_list = HF.state.navigation.fav_expanded || [];
            if (expanded_list.indexOf(item.folder) < 0) {
                expanded_list.push(item.folder);
            }
            HF.request_write(HF.api.bookmark_folder_state,
                { name: item.folder, expanded: '1' }, '', function() {});
        }
    }

    HF.move_bookmark_folder = function move_bookmark_folder(folder, direction) {
        HF.request_write(HF.api.bookmark_folder_move, { name: folder, direction: direction }, '',
            function(data) { HF.apply_bookmarks(data); });
    }

    HF.move_bookmark = function move_bookmark(entry, direction) {
        HF.request_write(HF.api.bookmark_move, { path: entry.path, direction: direction }, '',
            function(data) {
                HF.apply_bookmarks(data);
            });
    }

    HF.toggle_bookmark = function toggle_bookmark() {
        var path = HF.state.current && HF.state.current.kind === 'directory' ? HF.state.current.path : null;
        if (!path) {
            return;
        }
        var index = HF.bookmark_index(path);
        if (index >= 0) {
            HF.delete_bookmark({ path: path });
        }
        else {
            HF.open_bookmark_editor();
        }
    }

    HF.update_bookmark_menu_state = function update_bookmark_menu_state(entry) {
        var up = document.getElementById('fm_menu_bookmark_up');
        var down = document.getElementById('fm_menu_bookmark_down');
        if (!up || !down || !entry) {
            return;
        }
        var index = -1, count = 0;
        if (entry.is_folder) {
            var folders = HF.all_bookmark_folders();
            count = folders.length;
            index = folders.indexOf(entry.folder);
        }
        else {
            var list = HF.state.navigation.bookmarks || [];
            for (var i = 0; i < list.length; i++) {
                if ((list[i].folder || '') !== (entry.folder || '')) {
                    continue;
                }
                if (list[i].path === entry.path) {
                    index = count;
                }
                count++;
            }
        }
        up.disabled = index <= 0;
        down.disabled = index < 0 || index >= count - 1;
    }

    HF.bind_bookmark_menu = function bind_bookmark_menu(node, entry, menu_id) {
        var menu = menu_id || 'fm_bookmark_menu';
        var owner = function() {
            return node.closest ? node.closest('.fm-fav-panel, .fm-tool-dropdown') : null;
        }
        node.addEventListener('contextmenu', function(event) {
            event.preventDefault();
            event.stopPropagation();
            HF.state.bookmark_menu_item = entry;
            HF.update_bookmark_menu_state(entry);
            HF.show_context_menu(menu, event.clientX, event.clientY, owner());
        });
        var timer = null, sx = 0, sy = 0;
        var cancel = function() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        };
        node.addEventListener('touchstart', function(event) {
            if (!event.touches.length) {
                return;
            }
            sx = event.touches[0].clientX;
            sy = event.touches[0].clientY;
            cancel();
            timer = setTimeout(function() {
                timer = null;
                HF.state.suppress_next_click = true;
                HF.state.bookmark_menu_item = entry;
                HF.update_bookmark_menu_state(entry);
                HF.show_context_menu(menu, sx, sy, owner());
            }, 500);
        }, { passive: true });
        node.addEventListener('touchmove', function(event) {
            if (!timer || !event.touches.length) {
                return;
            }
            var dx = event.touches[0].clientX - sx;
            var dy = event.touches[0].clientY - sy;
            if (dx * dx + dy * dy > 64) {
                cancel();
            }
        }, { passive: true });
        node.addEventListener('touchend', cancel, { passive: true });
        node.addEventListener('touchcancel', cancel, { passive: true });
    }

    HF.render_sidebar = function render_sidebar() {
        var sidebar = document.getElementById('fm_sidebar');
        HF.clear_node(sidebar);
        var quick_active = HF.state.current && HF.state.current.kind === 'quick_access';
        var quick_heading = HF.create_sidebar_button(HF.labels.quick_access, 'quick_access', 'fm-nav-heading' + (quick_active ? ' active' : ''), function() {
            HF.show_virtual('quick_access', true);
        });
        sidebar.appendChild(quick_heading);

        HF.state.navigation.quick_access.forEach(function(item) {
            var active = HF.state.current && HF.state.current.kind === 'directory' && HF.state.current.path === item.path;
            var class_name = 'fm-nav-item' + (active ? ' active' : '') + (!item.exists ? ' disabled' : '');
            var button = HF.create_sidebar_button(item.name, item.icon || 'folder', class_name, function() {
                if (item.exists) {
                    HF.open_path(item.path, true);
                } else {
                    HF.set_warning_status(HF.labels.unavailable + ': ' + item.path);
                }
            });
            if (item.exists) {
                HF.bind_drop_target(button, item.path, item.name);
            }
            sidebar.appendChild(button);
        });

        var divider = document.createElement('div');
        divider.className = 'fm-nav-divider';
        sidebar.appendChild(divider);
        var pc_active = HF.state.current && HF.state.current.kind === 'this_pc';
        var pc_heading = HF.create_sidebar_button(HF.labels.this_pc, 'this_pc', 'fm-nav-heading' + (pc_active ? ' active' : ''), function() {
            HF.show_virtual('this_pc', true);
        });
        sidebar.appendChild(pc_heading);

        HF.state.navigation.drives.forEach(function(drive) {
            var active = HF.state.current && HF.state.current.kind === 'directory' && HF.state.current.path === drive.path;
            var name = drive.path === '/' ? HF.labels.system_disk : drive.name;
            var button = HF.create_sidebar_button(name, 'drive', 'fm-nav-item fm-nav-drive' + (active ? ' active' : ''), function() {
                HF.open_path(drive.path, true);
            });
            var image = button.querySelector('.fm-nav-icon');
            var label = button.querySelector('.fm-nav-label');
            var copy = document.createElement('div');
            copy.className = 'fm-nav-drive-copy';
            button.replaceChild(copy, label);
            copy.appendChild(label);
            var meta = document.createElement('div');
            meta.className = 'fm-nav-drive-meta';
            meta.textContent = HF.format_kb(drive.used_kb) + ' / ' + HF.format_kb(drive.total_kb);
            copy.appendChild(meta);
            button.title = drive.path;
            HF.bind_drop_target(button, drive.path, name);
            sidebar.appendChild(button);
        });
    }

    

    HF.apply_detected_type = function apply_detected_type(path, type) {
        HF.state.detected_types[path] = type;
        var rendered = HF.rendered_file_items();
        for (var i = 0; i < rendered.length; i++) {
            var entry = rendered[i];
            if (entry.item.path !== path) {
                continue;
            }
            if (type === 'text') {
                entry.item.preview = 'text';
                entry.item.icon_name = 'text';
            } else {
                entry.item.preview = 'binary';
                entry.item.icon_name = entry.item.icon_name || 'file';
            }
            var img = entry.node.querySelector('.fm-item-icon');
            if (img) {
                img.src = HF.icon_url(entry.item.icon_name);
            }
            break;
        }
    };

    HF.finish_detect = function finish_detect(path, type) {
        HF.state.detected_types[path] = type;
        HF.apply_detected_type(path, type);
        var waiters = HF.state.detect_waiters[path] || [];
        delete HF.state.detect_waiters[path];
        for (var i = 0; i < waiters.length; i++) {
            if (typeof waiters[i] === 'function') {
                waiters[i](type);
            }
        }
    };

    HF.request_detect_type = function request_detect_type(path, on_resolved) {
        if (!path) {
            if (on_resolved) { on_resolved('binary'); }
            return;
        }
        if (HF.state.detected_types[path]) {
            if (on_resolved) { on_resolved(HF.state.detected_types[path]); }
            return;
        }
        if (HF.state.detect_waiters[path]) {
            HF.state.detect_waiters[path].push(on_resolved);
            return;
        }
        HF.state.detect_waiters[path] = on_resolved ? [on_resolved] : [];
        HF.Util.ajax({
            url: HF.api.detect_type,
            type: 'GET',
            data: { path: path },
            dataType: 'json',
            success: function(res) {
                var data = res && res.code === 0 ? res.data : null;
                var type = data ? data.type : null;
                HF.finish_detect(path, type || 'binary');
            },
            error: function() {
                HF.finish_detect(path, 'binary');
            }
        });
    };

    HF.open_link_target = function open_link_target(path) {
        HF.request_json(HF.api.detect_type, { path: path }, function(data) {
            if (data && data.type === 'directory') {
                HF.open_path(path, true);
                return;
            }
            var name = String(path).replace(/.*\//, '') || path;
            HF.open_item({
                name: name,
                path: path,
                type: 'file',
                preview: (data && data.type) || 'none',
                icon_name: 'file',
                size: (data && data.size) || 0,
                mtime: 0
            });
        }, function() {
            HF.open_path(path, true);
        });
    }

    HF.create_item = function create_item(item, kind) {
        var node = document.createElement('div');
        node.className = 'fm-item';
        node.tabIndex = 0;
        node.setAttribute('data-path', item.path || '');
        node._fmItem = item;
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'fm-item-checkbox';
        checkbox.tabIndex = -1;
        checkbox.setAttribute('aria-hidden', 'true');
        checkbox.addEventListener('click', function(event) {
            event.stopPropagation();
        });
        checkbox.addEventListener('change', function(event) {
            event.stopPropagation();
            HF.set_item_checked(item, checkbox.checked);
        });
        HF.sync_item_checkbox(checkbox, HF.is_item_selected(item));
        node.appendChild(checkbox);
        var cached_type = HF.state.detected_types[item.path];
        if (cached_type) {
            item.preview = cached_type === 'text' ? 'text' : 'binary';
            if (cached_type === 'text') {
                item.icon_name = 'text';
            }
        }
        var image = document.createElement('img');
        image.className = 'fm-item-icon';
        var fallback_icon = HF.icon_url(HF.item_icon_name(item, kind));
        image.alt = '';
        image.draggable = false;
        var icon_node = image;
        if (HF.should_use_thumbnail(item, kind)) {
            var frame = document.createElement('span');
            frame.className = 'fm-item-icon fm-item-thumbnail-frame';
            image.className = 'fm-item-thumbnail-image';
            image.onload = function() {
                HF.fit_thumbnail_image(image, frame);
            };
            image.onerror = function() {
                var fallback = document.createElement('img');
                fallback.className = 'fm-item-icon';
                fallback.src = fallback_icon;
                fallback.alt = '';
                fallback.draggable = false;
                if (frame.parentNode) {
                    frame.parentNode.replaceChild(fallback, frame);
                }
            };
            image.src = HF.thumbnail_url(item);
            frame.appendChild(image);
            icon_node = frame;
        } else {
            image.src = fallback_icon;
        }
        var copy = document.createElement('div');
        copy.className = 'fm-item-copy';
        var name = document.createElement('div');
        name.className = 'fm-item-name';
        name.textContent = item.name;
        if (item.is_symlink) {
            var mark = document.createElement('span');
            mark.className = 'fm-symlink-mark';
            mark.textContent = '\u2192';
            mark.title = item.type === 'symlink' ? 'symlink' : 'symlink directory';
            name.appendChild(document.createTextNode('\u00A0'));
            name.appendChild(mark);
        }
        var link_line = null;
        if (item.is_symlink && item.link_target) {
            link_line = document.createElement('button');
            link_line.type = 'button';
            link_line.className = 'fm-symlink-target';
            link_line.title = item.link_target.path;
            link_line.textContent = '\u21B3 ' + item.link_target.path;
            link_line.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                HF.open_link_target(item.link_target.path);
            });
        }
        var meta = document.createElement('div');
        meta.className = 'fm-item-meta';
        meta.textContent = item.meta || item.path;
        var main = document.createElement('div');
        main.className = 'fm-item-main';
        copy.appendChild(name);
        if (link_line) {
            copy.appendChild(link_line);
        }
        copy.appendChild(meta);
        main.appendChild(icon_node);
        main.appendChild(copy);
        node.appendChild(main);
        [['display_size', 'fm-item-size'], ['display_type', 'fm-item-type'], ['display_mtime', 'fm-item-mtime']].forEach(function(column) {
            var value = document.createElement('div');
            value.className = 'fm-item-column ' + column[1];
            value.textContent = item[column[0]] || '-';
            node.appendChild(value);
        });
        node.addEventListener('click', function(event) {
            if (HF.state.selection_mode) {
                HF.toggle_selected_item(item);
                return;
            }
            if (event.ctrlKey || event.metaKey || event.shiftKey) {
                HF.handle_item_click(event, item, node);
                return;
            }
            if (!HF.state.suppress_next_click) {
                var isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
                if (isTouchDevice) {
                    HF.open_item(item);
                }
                HF.set_selected(item, node);
            }
            HF.state.suppress_next_click = false;
        });
        node.addEventListener('dblclick', function() { HF.open_item(item); });
        if (kind === 'file' && item.type !== 'directory') {
            HF.bind_item_hover(node, item);
        }
        node.addEventListener('contextmenu', function(event) {
            if (!HF.event_on_item_content(event)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (!HF.is_item_selected(item)) {
                HF.set_selected(item, node);
            } else {
                HF.apply_selection_classes();
                HF.render_details();
            }
            HF.state.context_item = item;
            var items = HF.context_selection(item);
            var is_multi = items.length > 1;
            var system_reason = HF.get_system_block_reason(item.path);
            var item_write_reason = HF.get_write_block_reason(item.path);
            var current_write_reason = HF.state.current && HF.state.current.kind === 'directory' ?
                HF.get_write_block_reason(HF.state.current.path) : '';
            var modify_reason = HF.first_write_block_reason(items);
            HF.set_button_state('fm_menu_open', is_multi, is_multi ? HF.labels.multiple_items : '');
            HF.set_button_state('fm_menu_open_binary', is_multi || item.type === 'directory', is_multi ? HF.labels.multiple_items : '');
            HF.set_button_state('fm_menu_properties', is_multi, is_multi ? HF.labels.multiple_items : '');
            HF.set_button_state('fm_menu_terminal', is_multi, is_multi ? HF.labels.multiple_items : '');
            HF.set_button_state('fm_menu_download', is_multi || item.type === 'directory', is_multi ? HF.labels.multiple_items : '');
            HF.set_button_state(
                'fm_menu_compress',
                !(HF.state.current && HF.state.current.kind === 'directory' && HF.item_list_can_copy(items)) || !!current_write_reason,
                current_write_reason || ''
            );
            var is_archive = !is_multi && HF.is_archive_item(item);
            document.getElementById('fm_menu_extract').style.display = is_archive ? 'flex' : 'none';
            var extract_label = document.querySelector('#fm_menu_extract span:last-child');
            if (extract_label) {
                extract_label.textContent = HF.labels.extract;
            }
            HF.set_button_state(
                'fm_menu_extract',
                !is_archive || !!current_write_reason,
                is_multi ? HF.labels.multiple_items : (current_write_reason || '')
            );
            HF.set_button_state('fm_menu_copy', !HF.item_list_can_copy(items), '');
            HF.set_button_state('fm_menu_cut', !HF.item_list_can_modify(items), modify_reason || system_reason);
            document.getElementById('fm_menu_paste').style.display = item.type === 'directory' && HF.has_clipboard() ? 'flex' : 'none';
            HF.set_button_state('fm_menu_paste', !HF.can_paste_to_path(item.path), system_reason);
            HF.set_button_state(
                'fm_menu_upload',
                is_multi || HF.state.uploading || item.type !== 'directory' || !HF.can_upload_to_path(item.path),
                is_multi ? HF.labels.multiple_items : item_write_reason
            );
            var can_modify = HF.state.current && HF.state.current.kind === 'directory' && HF.item_list_can_modify(items);
            HF.set_button_state('fm_menu_rename', is_multi || !can_modify || !!current_write_reason, is_multi ? HF.labels.multiple_items : (current_write_reason || system_reason));
            HF.set_button_state(
                'fm_menu_delete',
                !can_modify,
                modify_reason || system_reason
            );
            HF.set_button_state(
                'fm_menu_copy_to',
                !(HF.state.current && HF.state.current.kind === 'directory' && HF.item_list_can_copy(items)),
                ''
            );
            HF.set_button_state('fm_menu_move_to', !can_modify, modify_reason || system_reason);
            if (modify_reason || system_reason) {
                HF.set_write_block_status(modify_reason || system_reason);
            }
            HF.show_context_menu('fm_item_menu', event.clientX, event.clientY);
        });
        node.addEventListener('keydown', function(event) {
            if (event.key === 'Enter') {
                HF.open_item(item);
            }
        });
        if (HF.state.current && HF.state.current.kind === 'directory' && HF.can_modify_item(item)) {
            if (!('ontouchstart' in window)) {
                node.draggable = true;
            } else {
                node.draggable = false;
            }
            node.addEventListener('dragstart', function(event) {
                HF.hide_item_hover_card();
                var items = HF.is_item_selected(item) ? HF.selected_items() : [item];
                HF.state.drag_item = item;
                HF.state.drag_items = items;
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('application/x-harbor-item', JSON.stringify({
                        path: item.path,
                        type: item.type,
                        name: item.name,
                        items: items.map(function(entry) {
                            return { path: entry.path, type: entry.type, name: entry.name };
                        })
                    }));
                }
            });
            node.addEventListener('dragend', function() {
                HF.state.drag_item = null;
                HF.state.drag_items = [];
                HF.clear_drag_state();
            });
        }
        if (item.type === 'directory') {
            HF.bind_drop_target(node, item.path, item.name);
        }
        if ('ontouchstart' in window) {
            var touchTimer = null;
            var longPressTriggered = false;
            var touchStartX = 0, touchStartY = 0;
            var hasMoved = false;
            var dragClone = null;
            var isDragging = false;
            var scrollableParents = [];

            function getScrollableParents(node) {
                var parents = [];
                var parent = node.parentElement;
                while (parent) {
                    var style = window.getComputedStyle(parent);
                    var overflow = style.overflow + style.overflowY + style.overflowX;
                    if (/(auto|scroll)/.test(overflow)) {
                        parents.push(parent);
                    }
                    parent = parent.parentElement;
                }
                return parents;
            }

            function enableDragMode() {
                document.addEventListener('touchmove', preventScroll, { passive: false });
                document.body.style.overflow = 'hidden';
                document.body.style.touchAction = 'none';
                scrollableParents.forEach(function(el) {
                    el.style.overflow = 'hidden';
                    el.style.touchAction = 'none';
                });
            }

            function disableDragMode() {
                document.removeEventListener('touchmove', preventScroll);
                document.body.style.overflow = '';
                document.body.style.touchAction = '';
                scrollableParents.forEach(function(el) {
                    el.style.overflow = '';
                    el.style.touchAction = '';
                });
            }

            function preventScroll(e) {
                if (isDragging) {
                    e.preventDefault();
                }
            }

            node.addEventListener('touchstart', function(e) {
                var touch = e.touches[0];
                if (!HF.is_item_content_at(touch.clientX, touch.clientY)) {
                    return;
                }
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
                hasMoved = false;
                longPressTriggered = false;
                isDragging = false;
                if (dragClone) {
                    dragClone.remove();
                    dragClone = null;
                }
                scrollableParents = getScrollableParents(node);
                touchTimer = setTimeout(function() {
                    longPressTriggered = true;
                    HF.state.suppress_next_click = true;
                    enableDragMode();
                    var menuEvent = new Event('contextmenu', { bubbles: true, cancelable: true });
                    menuEvent.clientX = touchStartX;
                    menuEvent.clientY = touchStartY;
                    menuEvent.fm_content_hit = true;
                    node.dispatchEvent(menuEvent);
                }, 600);

                var onTouchMove = function(ev) {
                    var touch = ev.touches[0];
                    var dx = touch.clientX - touchStartX;
                    var dy = touch.clientY - touchStartY;
                    var distance = Math.sqrt(dx*dx + dy*dy);
                    if (distance > 8) {
                        hasMoved = true;
                        if (!longPressTriggered) {
                            if (touchTimer) {
                                clearTimeout(touchTimer);
                                touchTimer = null;
                            }
                            return;
                        }

                        if (longPressTriggered) {
                            ev.preventDefault();
                            if (!isDragging) {
                                isDragging = true;
                                HF.hide_context_menus();
                                var selected = HF.is_item_selected(item) ? HF.selected_items() : [item];
                                HF.state.drag_item = item;
                                HF.state.drag_items = selected;
                                if (!dragClone) {
                                    dragClone = node.cloneNode(true);
                                    dragClone.style.position = 'fixed';
                                    dragClone.style.pointerEvents = 'none';
                                    dragClone.style.zIndex = 9999;
                                    dragClone.style.opacity = 0.7;
                                    dragClone.style.width = node.offsetWidth + 'px';
                                    dragClone.style.transform = 'scale(1.05)';
                                    dragClone.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
                                    dragClone.classList.remove('selected');

                                    if (selected.length > 1) {
                                        var badge = document.createElement('span');
                                        badge.style.cssText = `
                                            position: absolute;
                                            top: -8px;
                                            right: -8px;
                                            background: #e74c3c;
                                            color: #fff;
                                            border-radius: 50%;
                                            width: 24px;
                                            height: 24px;
                                            font-size: 12px;
                                            font-weight: bold;
                                            display: flex;
                                            align-items: center;
                                            justify-content: center;
                                            box-shadow: 0 2px 6px rgba(0,0,0,0.4);
                                            border: 2px solid #fff;
                                            pointer-events: none;
                                            line-height: 1;
                                            font-family: sans-serif;
                                            z-index: 10000;
                                        `;
                                        badge.textContent = selected.length;
                                        dragClone.appendChild(badge);
                                    }

                                    document.body.appendChild(dragClone);
                                }
                            }

                            if (dragClone) {
                                var rect = dragClone.getBoundingClientRect();
                                dragClone.style.left = (touch.clientX - rect.width / 2) + 'px';
                                dragClone.style.top = (touch.clientY - rect.height / 2) + 'px';
                            }
                        }
                    }
                };

                var onTouchEnd = function(ev) {
                    if (touchTimer) {
                        clearTimeout(touchTimer);
                        touchTimer = null;
                    }
                    if (dragClone) {
                        dragClone.remove();
                        dragClone = null;
                    }
                    if (isDragging) {
                        var touch = ev.changedTouches[0];
                        var target = document.elementFromPoint(touch.clientX, touch.clientY);
                        var dropTarget = target ? target.closest('[data-path]') : null;
                        var targetPath = dropTarget && dropTarget._fmItem && dropTarget._fmItem.type === 'directory' ?
                            dropTarget._fmItem.path : null;
                        if (targetPath && HF.can_move_to_path(targetPath)) {
                            HF.confirm_drag_move(HF.state.drag_items, targetPath);
                        }
                        document.querySelectorAll('.fm-drop-target').forEach(el => el.classList.remove('fm-drop-target'));
                        HF.state.drag_item = null;
                        HF.state.drag_items = [];
                        isDragging = false;
                        longPressTriggered = false;
                        hasMoved = false;
                    }
                    disableDragMode();
                    HF.state.suppress_next_click = false;
                    node.removeEventListener('touchmove', onTouchMove);
                    node.removeEventListener('touchend', onTouchEnd);
                    node.removeEventListener('touchcancel', onTouchEnd);
                };

                node.addEventListener('touchmove', onTouchMove, { passive: false });
                node.addEventListener('touchend', onTouchEnd, { passive: false });
                node.addEventListener('touchcancel', onTouchEnd, { passive: false });
            }, { passive: false });
        }
        return node;
    }

    HF.create_detail_header = function create_detail_header() {
        var header = document.createElement('div');
        header.className = 'fm-detail-header';
        [HF.labels.name, HF.labels.size, HF.labels.type, HF.labels.modified].forEach(function(label) {
            var column = document.createElement('div');
            column.textContent = label;
            header.appendChild(column);
        });
        return header;
    }

    HF.render_group = function render_group(container, title, items, kind) {
        var group = document.createElement('section');
        group.className = 'fm-group';
        var heading = document.createElement('h2');
        heading.className = 'fm-group-title';
        heading.textContent = title;
        var grid = document.createElement('div');
        grid.className = 'fm-grid' + (kind === 'drive' ? ' fm-drive-grid' : ' fm-view-' + HF.state.view_mode);
        items.forEach(function(item, index) {
            var node = HF.create_item(item, kind);
            node.style.animationDelay = Math.min(index * 14, 140) + 'ms';
            if (kind === 'drive') {
                var progress = document.createElement('div');
                progress.className = 'fm-drive-progress';
                var bar = document.createElement('span');
                bar.style.width = Math.max(0, Math.min(100, item.usage_percent || 0)) + '%';
                progress.appendChild(bar);
                node.querySelector('.fm-item-copy').appendChild(progress);
            }
            grid.appendChild(node);
        });
        if (title) {
            group.appendChild(heading);
        }
        if (kind !== 'drive' && HF.state.view_mode === 'details') {
            group.appendChild(HF.create_detail_header());
        }
        group.appendChild(grid);
        container.appendChild(group);
    }

    HF.prepare_folder_item = function prepare_folder_item(item) {
        return {
            name: item.name,
            path: item.path,
            is_symlink: item.is_symlink === true,
            link_target: item.link_target || null,
            type: 'directory',
            preview: 'none',
            icon_name: item.icon || 'folder',
            is_system: HF.is_system_folder(item.path),
            meta: item.path,
            display_type: HF.labels.folder,
            display_size: '-',
            display_mtime: HF.format_time(item.mtime),
            mode: item.mode || '---'
        };
    }

    HF.prepare_drive_item = function prepare_drive_item(item) {
        var name = item.path === '/' ? HF.labels.system_disk : item.name;
        var used_text = HF.format_kb(item.used_kb) + ' / ' + HF.format_kb(item.total_kb);
        return {
            name: name,
            path: item.path,
            type: 'directory',
            preview: 'none',
            icon_name: 'drive',
            meta: used_text,
            usage_percent: item.usage_percent,
            display_type: item.device || HF.labels.system_disk,
            display_size: HF.format_kb(item.total_kb),
            display_mtime: '-',
            mode: item.mode || '---'
        };
    }

    HF.show_virtual = function show_virtual(kind, add_history) {
        HF.state.current = { kind: kind };
        HF.state.current_directory_data = null;
        HF.state.sort_path = '';
        HF.state.sort_field = 'name';
        HF.state.sort_order = 'asc';
        HF.hide_item_hover_card();
        HF.clear_selection();
        HF.state.context_item = null;
        var content = document.getElementById('fm_content');
        HF.clear_node(content);
        var title = document.createElement('h1');
        title.className = 'fm-page-title';
        title.textContent = kind === 'quick_access' ? HF.labels.quick_access : HF.labels.this_pc;
        content.appendChild(title);

        if (kind === 'quick_access') {
            var quick_items = HF.state.navigation.quick_access.filter(function(item) { return item.exists; }).map(HF.prepare_folder_item);
            HF.render_group(content, '', quick_items, 'folder');
        } else {
            HF.render_group(content, HF.labels.drives, HF.state.navigation.drives.map(HF.prepare_drive_item), 'drive');
            HF.render_group(content, HF.labels.folders, HF.state.navigation.folders.map(HF.prepare_folder_item), 'folder');
        }
        if (add_history) {
            HF.push_history(HF.state.current);
        }
        HF.render_sidebar();
        HF.update_toolbar();
    }

    HF.icon_name_of = function icon_name_of(item) {
        if (item.type === 'directory') {
            return 'folder';
        }
        if (item.preview === 'package') {
            return String(item.ext || '').toLowerCase();
        }
        if (HF.is_archive_item(item)) {
            return 'archive';
        }
        return item.preview && item.preview !== 'none' ? item.preview : 'file';
    }

    HF.prepare_file_item = function prepare_file_item(item) {
        var is_directory = item.type === 'directory';
        var link = item.link_target || null;
        var is_package = !is_directory && item.preview === 'package';
        var package_label = is_package ? HF.package_type_label(item.ext) : '';
        return {
            name: item.name,
            path: item.path,
            type: item.type,
            ext: item.ext || '',
            preview: item.preview || 'none',
            thumbnail_available: item.thumbnail_available === true,
            icon_name: HF.icon_name_of(item),
            is_system: is_directory && HF.is_system_folder(item.path),
            size: Number(item.size || 0),
            meta: is_directory ? HF.labels.folder : (is_package ? package_label : HF.format_size(item.size)),
            display_type: is_directory ? HF.labels.folder : (is_package ? package_label : (item.ext ? item.ext.toUpperCase() + ' ' + HF.labels.file : HF.labels.file)),
            display_size: is_directory ? '-' : HF.format_size(item.size),
            display_mtime: HF.format_time(item.mtime),
            mtime: item.mtime || 0,
            mode: item.mode || '---',
            is_symlink: item.is_symlink === true,
            link_target: link
        };
    }

    HF.path_title = function path_title(path) {
        if (path === '/') {
            return HF.labels.system_disk;
        }
        var mount = HF.mount_point_name(path);
        if (mount) {
            return mount;
        }
        for (var i = 0; i < HF.state.navigation.quick_access.length; i++) {
            if (HF.state.navigation.quick_access[i].path === path) {
                return HF.state.navigation.quick_access[i].name;
            }
        }
        var match = String(path || '').match(/[^/]+$/);
        return match ? match[0] : path;
    }

    HF.sort_text_value = function sort_text_value(value) {
        return String(value || '').toLowerCase();
    }

    HF.compare_file_name = function compare_file_name(a, b) {
        var result = HF.sort_text_value(a.name).localeCompare(HF.sort_text_value(b.name));
        if (result !== 0) {
            return result;
        }
        return String(a.path || '').localeCompare(String(b.path || ''));
    }

    HF.compare_sort_field = function compare_sort_field(a, b, field) {
        if (field === 'mtime') {
            return Number(a.mtime || 0) - Number(b.mtime || 0);
        }
        if (field === 'size') {
            return Number(a.size || 0) - Number(b.size || 0);
        }
        if (field === 'type') {
            return HF.sort_text_value(a.display_type).localeCompare(HF.sort_text_value(b.display_type));
        }
        return HF.compare_file_name(a, b);
    }

    HF.sorted_directory_items = function sorted_directory_items(items, path) {
        var output = (items || []).slice();
        if (HF.state.sort_path !== path) {
            return output;
        }
        var field = HF.state.sort_field;
        var order = HF.state.sort_order;
        output.sort(function(a, b) {
            var result;
            if (field !== 'name' && a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            } else if (field !== 'name' && a.type === 'directory' && b.type === 'directory') {
                return HF.compare_file_name(a, b);
            } else {
                result = HF.compare_sort_field(a, b, field);
                if (result === 0) {
                    return HF.compare_file_name(a, b);
                }
            }
            return order === 'desc' ? -result : result;
        });
        return output;
    }

    HF.restore_rendered_selection = function restore_rendered_selection(paths) {
        var selected = [];
        var by_path = {};
        HF.rendered_file_items().forEach(function(entry) {
            by_path[entry.item.path] = entry.item;
        });
        (paths || []).forEach(function(path) {
            if (by_path[path]) {
                selected.push(by_path[path]);
            }
        });
        HF.set_selected_items(selected, selected.length ? selected[selected.length - 1] : null, selected.length ? selected[0] : null);
    }

    HF.rerender_current_directory = function rerender_current_directory() {
        if (!HF.state.current_directory_data || !HF.state.current || HF.state.current.kind !== 'directory') {
            return;
        }
        var selected_paths = HF.state.selected_order.slice();
        HF.render_directory(HF.state.current_directory_data);
        HF.restore_rendered_selection(selected_paths);
    }

    HF.update_sort_menu_state = function update_sort_menu_state() {
        var active_field = HF.state.sort_path === (HF.state.current && HF.state.current.path) ? HF.state.sort_field : 'name';
        var active_order = HF.state.sort_path === (HF.state.current && HF.state.current.path) ? HF.state.sort_order : 'asc';
        var field_buttons = document.querySelectorAll('#fm_sort_menu [data-sort-field]');
        for (var i = 0; i < field_buttons.length; i++) {
            field_buttons[i].classList.toggle('active', field_buttons[i].getAttribute('data-sort-field') === active_field);
        }
        var order_buttons = document.querySelectorAll('#fm_sort_menu [data-sort-order]');
        for (var j = 0; j < order_buttons.length; j++) {
            order_buttons[j].classList.toggle('active', order_buttons[j].getAttribute('data-sort-order') === active_order);
        }
    }

    HF.apply_directory_sort = function apply_directory_sort(field, order) {
        if (!HF.state.current || HF.state.current.kind !== 'directory') {
            return;
        }
        HF.state.sort_path = HF.state.current.path;
        if (field) {
            HF.state.sort_field = field;
        }
        if (order) {
            HF.state.sort_order = order;
        }
        HF.update_sort_menu_state();
        HF.hide_context_menus();
        HF.rerender_current_directory();
    }

    HF.render_directory = function render_directory(data) {
        var content = document.getElementById('fm_content');
        HF.hide_item_hover_card();
        HF.clear_node(content);
        var header = document.createElement('div');
        header.className = 'fm-page-header';
        var title = document.createElement('h1');
        title.className = 'fm-page-title';
        title.textContent = HF.path_title(data.path);
        header.appendChild(title);
        var items = HF.sorted_directory_items((data.items || []).map(HF.prepare_file_item), data.path);
        var image_count = items.filter(function(item) { return item.preview === 'image'; }).length;
        if (HF.state.preferences.enable_thumbnails === 1 && image_count > 0) {
            var actions = document.createElement('div');
            actions.className = 'fm-directory-actions';
            var thumb_button = document.createElement('button');
            thumb_button.type = 'button';
            thumb_button.className = 'fm-directory-action';
            thumb_button.textContent = HF.labels.generate_thumbnails + ' (' + image_count + ')';
            thumb_button.addEventListener('click', function() {
                HF.start_thumbnail_generation(data.path);
            });
            actions.appendChild(thumb_button);
            header.appendChild(actions);
        }
        content.appendChild(header);
        if (!items.length) {
            var empty = document.createElement('div');
            empty.className = 'fm-empty';
            empty.textContent = HF.labels.empty;
            content.appendChild(empty);
            return;
        }
        if (HF.state.view_mode === 'details') {
            content.appendChild(HF.create_detail_header());
        }
        var grid = document.createElement('div');
        grid.className = 'fm-grid fm-view-' + HF.state.view_mode;
        items.forEach(function(item, index) {
            var node = HF.create_item(item, 'file');
            node.style.animationDelay = Math.min(index * 12, 120) + 'ms';
            grid.appendChild(node);
        });
        content.appendChild(grid);
    }

    HF.is_file_drag = function is_file_drag(event) {
        var types = event.dataTransfer && event.dataTransfer.types;
        if (!types) {
            return false;
        }
        if (typeof types.indexOf === 'function') {
            return types.indexOf('Files') >= 0;
        }
        return typeof types.contains === 'function' && types.contains('Files');
    }

    HF.clear_drag_state = function clear_drag_state() {
        var targets = document.querySelectorAll('.fm-drop-target');
        for (var i = 0; i < targets.length; i++) {
            targets[i].classList.remove('fm-drop-target');
        }
        document.getElementById('fm_drag_overlay').classList.remove('show');
        HF.state.drag_target = null;
    }

    HF.show_drag_target = function show_drag_target(node, path, label, mode) {
        var is_move = mode === 'move';
        if (is_move ? !HF.can_move_to_path(path) : !HF.can_upload_to_path(path)) {
            return;
        }
        HF.clear_drag_state();
        if (node) {
            node.classList.add('fm-drop-target');
        }
        HF.state.drag_target = { path: path, label: label, mode: mode || 'upload' };
        var overlay = document.getElementById('fm_drag_overlay');
        overlay.textContent = (is_move ? HF.labels.move_to : HF.labels.upload_to) + ': ' + label;
        overlay.classList.add('show');
    }

    HF.get_internal_drag_items = function get_internal_drag_items(event) {
        var transfer = event.dataTransfer;
        if (!transfer) {
            return HF.state.drag_items && HF.state.drag_items.length ? HF.state.drag_items : (HF.state.drag_item ? [HF.state.drag_item] : []);
        }
        var raw = '';
        try {
            raw = transfer.getData('application/x-harbor-item') || '';
        } catch (error) {
            raw = '';
        }
        if (!raw) {
            return HF.state.drag_items && HF.state.drag_items.length ? HF.state.drag_items : (HF.state.drag_item ? [HF.state.drag_item] : []);
        }
        try {
            var data = JSON.parse(raw);
            return data.items && data.items.length ? data.items : [data];
        } catch (error) {
            return HF.state.drag_items && HF.state.drag_items.length ? HF.state.drag_items : (HF.state.drag_item ? [HF.state.drag_item] : []);
        }
    }

    HF.is_internal_drag = function is_internal_drag(event) {
        return HF.get_internal_drag_items(event).length > 0;
    }

    HF.drop_contains_directory = function drop_contains_directory(data_transfer) {
        if (!data_transfer || !data_transfer.items) {
            return false;
        }
        for (var i = 0; i < data_transfer.items.length; i++) {
            var item = data_transfer.items[i];
            if (item.kind === 'file' && item.webkitGetAsEntry) {
                var entry = item.webkitGetAsEntry();
                if (entry && entry.isDirectory) {
                    return true;
                }
            } else if (item.kind === 'file' && item.getAsFile && !item.getAsFile()) {
                return true;
            }
        }
        return false;
    }

    HF.handle_file_drop = function handle_file_drop(event, target_dir, target_label) {
        event.preventDefault();
        event.stopPropagation();
        HF.clear_drag_state();
        if (!HF.can_upload_to_path(target_dir)) {
            HF.set_write_block_status(HF.get_write_block_reason(target_dir) || HF.labels.system_folder_blocked);
            return;
        }
        if (HF.drop_contains_directory(event.dataTransfer)) {
            HF.set_warning_status(HF.labels.folder_not_supported);
            return;
        }
        var files = Array.prototype.slice.call(event.dataTransfer.files || []);
        HF.begin_upload(files, target_dir, target_label);
    }

    HF.confirm_drag_move = function confirm_drag_move(items, target_dir) {
        items = HF.normalize_item_list(items);
        if (!items.length || !target_dir) {
            return;
        }
        for (var i = 0; i < items.length; i++) {
            if (target_dir === items[i].path || HF.parent_directory(items[i].path) === target_dir) {
                HF.set_warning_status(HF.labels.move_item_same);
                return;
            }
        }
        var confirm_text = (items.length > 1 ? HF.labels.move_selected_confirm : HF.labels.move_item_confirm) +
            '\n' + (items.length > 1 ? HF.format_label(HF.labels.selected_items, items.length) : items[0].name) +
            '\n' + HF.labels.move_to + ': ' + target_dir;
        HF.confirm_window({
            title: HF.labels.move_to,
            message: confirm_text
        }).then(function(ok) {
            if (ok) {
                HF.run_batch_transfer('move', items, target_dir);
            }
        });
    }

    HF.bind_drop_target = function bind_drop_target(node, path, label) {
        node.addEventListener('dragenter', function(event) {
            if (HF.is_internal_drag(event) && HF.can_move_to_path(path)) {
                event.preventDefault();
                event.stopPropagation();
                HF.show_drag_target(node, path, label, 'move');
                return;
            }
            if (!HF.state.uploading && HF.can_upload_to_path(path) && HF.is_file_drag(event)) {
                event.preventDefault();
                event.stopPropagation();
                HF.show_drag_target(node, path, label, 'upload');
            }
        });
        node.addEventListener('dragover', function(event) {
            if (HF.is_internal_drag(event) && HF.can_move_to_path(path)) {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'move';
                return;
            }
            if (!HF.state.uploading && HF.can_upload_to_path(path) && HF.is_file_drag(event)) {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'copy';
            }
        });
        node.addEventListener('dragleave', function(event) {
            if (!event.relatedTarget || !node.contains(event.relatedTarget)) {
                HF.clear_drag_state();
            }
        });
        node.addEventListener('drop', function(event) {
            if (HF.is_internal_drag(event) && HF.can_move_to_path(path)) {
                event.preventDefault();
                event.stopPropagation();
                var items = HF.get_internal_drag_items(event);
                HF.state.drag_item = null;
                HF.state.drag_items = [];
                HF.clear_drag_state();
                HF.confirm_drag_move(items, path);
                return;
            }
            if (!HF.state.uploading && HF.can_upload_to_path(path) && HF.is_file_drag(event)) {
                HF.handle_file_drop(event, path, label);
            }
        });
    }

    HF.upload_window_record = null;
    HF.upload_panel_node = null;

    HF.ensure_upload_window = function ensure_upload_window() {
        var panel = document.getElementById('fm_upload_panel');
        if (!panel && HF.upload_panel_node && !HF.upload_panel_node.isConnected) {
            panel = HF.upload_panel_node;
            var home = document.getElementById('fm_main');
            if (home) {
                home.appendChild(panel);
            }
        }
        HF.upload_panel_node = panel;
        if (!panel) {
            return null;
        }
        if (!HF.upload_window_record || HF.upload_window_record.closed) {
            var record = HF.window_manager.create({
                title: HF.labels.upload || HF.tr('Upload'),
                icon: 'upload',
                className: 'fm-upload-window',
                content: panel,
                width: 480,
                height: 200,
                minWidth: 320,
                minHeight: 150,
                persistSize: false,
                onClose: function() {
                    var main = document.getElementById('fm_main');
                    if (main && panel.parentNode !== main) {
                        main.appendChild(panel);
                    }
                    panel.className = 'fm-upload-panel';
                    HF.upload_window_record = null;
                }
            });
            HF.upload_window_record = record;
        }
        return HF.upload_window_record;
    };

    HF.set_upload_panel = function set_upload_panel(title, detail, percent, class_name, uploaded_bytes, total_bytes) {
        var panel = document.getElementById('fm_upload_panel');
        if (HF.state.upload_panel_timer) {
            clearTimeout(HF.state.upload_panel_timer);
            HF.state.upload_panel_timer = null;
        }
        panel.className = 'fm-upload-panel show' + (class_name ? ' ' + class_name : '');
        document.getElementById('fm_upload_title').textContent = title;
        document.getElementById('fm_upload_detail').textContent = detail || '';
        document.getElementById('fm_upload_percent').textContent = Math.round(percent) + '%';
        document.getElementById('fm_upload_progress').style.width = Math.max(0, Math.min(100, percent)) + '%';
        if (uploaded_bytes !== undefined) {
            HF.state.uploaded_bytes = uploaded_bytes;
        }
        if (total_bytes !== undefined) {
            HF.state.upload_total = total_bytes;
        }
        document.getElementById('fm_upload_bytes').textContent = HF.labels.uploaded + ': ' +
            HF.format_size(HF.state.uploaded_bytes) + ' / ' + HF.format_size(HF.state.upload_total);
        document.getElementById('fm_upload_speed').textContent = HF.labels.upload_speed + ': ' + HF.format_speed(HF.state.upload_speed);
        if (class_name === 'success' || class_name === 'error') {
            HF.state.upload_panel_timer = setTimeout(function() {
                HF.state.upload_panel_timer = null;
                if (HF.upload_window_record && !HF.upload_window_record.closed) {
                    HF.window_manager.close(HF.upload_window_record);
                }
            }, 2200);
        }
    }

    HF.reset_upload_metrics = function reset_upload_metrics() {
        HF.state.upload_speed = 0;
        HF.state.upload_last_loaded = 0;
        HF.state.upload_last_tick = 0;
    }

    HF.update_upload_speed = function update_upload_speed(total_loaded) {
        var loaded = Math.max(0, Number(total_loaded || 0));
        var now = Date.now();
        if (!HF.state.upload_last_tick) {
            HF.state.upload_last_tick = now;
            HF.state.upload_last_loaded = loaded;
            HF.state.upload_speed = 0;
            return 0;
        }
        var elapsed = now - HF.state.upload_last_tick;
        if (elapsed < 180) {
            return HF.state.upload_speed;
        }
        var delta_bytes = loaded - HF.state.upload_last_loaded;
        var instant_speed = elapsed > 0 ? delta_bytes * 1000 / elapsed : 0;
        if (!isFinite(instant_speed) || instant_speed < 0) {
            instant_speed = 0;
        }
        HF.state.upload_speed = HF.state.upload_speed > 0 ?
            (HF.state.upload_speed * 0.65 + instant_speed * 0.35) :
            instant_speed;
        HF.state.upload_last_tick = now;
        HF.state.upload_last_loaded = loaded;
        return HF.state.upload_speed;
    }

    HF.reset_overwrite_actions = function reset_overwrite_actions() {
        var actions = document.querySelector('#fm_overwrite_dialog .fm-dialog-actions');
        if (!actions) {
            return null;
        }
        var dynamic = actions.querySelectorAll('.fm-dynamic-paste-btn');
        for (var i = 0; i < dynamic.length; i++) {
            dynamic[i].remove();
        }
        return actions;
    }

    HF.show_overwrite_dialog = function show_overwrite_dialog(batch, conflicts) {
        var list = document.getElementById('fm_conflict_list');
        HF.clear_node(list);
        conflicts.forEach(function(name) {
            var item = document.createElement('li');
            item.textContent = name;
            list.appendChild(item);
        });
        batch.conflicts = conflicts;
        HF.state.pending_upload = batch;
        HF.reset_overwrite_actions();
        document.getElementById('fm_overwrite_confirm').style.display = '';
        HF.open_modal('fm_overwrite_dialog');
    }

    HF.begin_upload = function begin_upload(files, target_dir, target_label) {
        if (HF.state.uploading) {
            HF.set_warning_status(HF.labels.upload_busy);
            return;
        }
        if (!HF.can_upload_to_path(target_dir)) {
            HF.set_write_block_status(HF.get_write_block_reason(target_dir) || HF.labels.system_folder_blocked);
            return;
        }
        if (!files || !files.length) {
            HF.set_warning_status(HF.labels.no_files);
            return;
        }

        HF.state.uploading = true;
        HF.update_toolbar();

        var total_size = files.reduce(function(total, file) { return total + Number(file.size || 0); }, 0);
        var batch = {
            files: files,
            target_dir: target_dir,
            target_label: target_label,
            total_size: total_size,
            conflicts: []
        };
        HF.state.uploaded_bytes = 0;
        HF.state.upload_total = total_size;
        HF.reset_upload_metrics();
        HF.ensure_upload_window();
        HF.set_upload_panel(HF.labels.uploading, HF.labels.upload_to + ': ' + target_label, 0, '', 0, total_size);

        HF.Util.ajax({
            url: HF.api.upload_check,
            type: 'POST',
            dataType: 'json',
            data: {
                target_dir: target_dir,
                total_size: total_size,
                names: JSON.stringify(files.map(function(file) { return file.name; }))
            },
            success: function(res) {
                if (!res || res.code !== 0) {
                    HF.fail_upload_batch((res && res.message) || HF.labels.upload_failed);
                    return;
                }
                var data = res.data || {};
                if (!data.enough_space) {
                    var space_message = HF.localized_space_message(data.space_message) || HF.labels.space_less_than_50mb;
                    HF.set_write_block_status(space_message);
                    HF.fail_upload_batch(space_message);
                    return;
                }
                if (data.blocked_conflicts && data.blocked_conflicts.length) {
                    HF.fail_upload_batch(HF.labels.blocked_conflict + ': ' + data.blocked_conflicts.join(', '));
                    return;
                }
                if (data.conflicts && data.conflicts.length) {
                    HF.show_overwrite_dialog(batch, data.conflicts);
                    return;
                }
                HF.upload_batch(batch);
            },
            error: function(xhr) {
                HF.fail_upload_batch(HF.upload_error_message(xhr, HF.labels.upload_failed));
            }
        });
    }

    HF.upload_batch = function upload_batch(batch) {
        HF.state.uploading = true;
        HF.state.pending_upload = null;
        HF.reset_upload_metrics();
        HF.update_toolbar();
        var conflict_map = {};
        batch.conflicts.forEach(function(name) { conflict_map[name] = true; });
        HF.upload_next(batch, conflict_map, 0, 0);
    }

    HF.upload_next = function upload_next(batch, conflict_map, index, completed_bytes) {
        if (index >= batch.files.length) {
            HF.state.uploading = false;
            HF.update_toolbar();
            HF.set_upload_panel(HF.labels.upload_complete, batch.files.length + ' ' + HF.labels.file, 100, 'success', batch.total_size, batch.total_size);
            HF.refresh_after_write();
            return;
        }

        var file = batch.files[index];
        var form_data = new FormData();
        form_data.append('file', file, file.name);
        var query = '?target_dir=' + encodeURIComponent(batch.target_dir) +
            '&expected_size=' + encodeURIComponent(file.size) +
            '&overwrite=' + (conflict_map[file.name] ? '1' : '0');
        var xhr = new XMLHttpRequest();
        xhr.open('POST', HF.api.upload + query, true);
        xhr.upload.onprogress = function(event) {
            var loaded = event.lengthComputable && event.total > 0 ? Number(file.size || 0) * event.loaded / event.total : 0;
            var percent = batch.total_size > 0 ? ((completed_bytes + loaded) / batch.total_size) * 100 : 0;
            var detail = HF.labels.file + ' ' + (index + 1) + ' ' + HF.labels.of + ' ' + batch.files.length + ': ' + file.name;
            HF.update_upload_speed(completed_bytes + loaded);
            HF.set_upload_panel(HF.labels.uploading, detail, percent, '', completed_bytes + loaded, batch.total_size);
        };
        xhr.onload = function() {
            var response = null;
            try {
                response = JSON.parse(xhr.responseText || '{}');
            } catch (error) {
                response = null;
            }
            if (xhr.status < 200 || xhr.status >= 300 || !response || response.code !== 0) {
                HF.state.uploading = false;
                HF.update_toolbar();
                HF.fail_upload_batch((response && response.message) || HF.labels.upload_failed);
                return;
            }
            HF.update_upload_speed(completed_bytes + Number(file.size || 0));
            HF.upload_next(batch, conflict_map, index + 1, completed_bytes + Number(file.size || 0));
        };
        xhr.onerror = function() {
            HF.state.uploading = false;
            HF.update_toolbar();
            HF.fail_upload_batch(HF.labels.upload_failed);
        };
        xhr.send(form_data);
    }

    HF.fail_upload_batch = function fail_upload_batch(message) {
        HF.state.uploading = false;
        HF.update_toolbar();
        var percent = HF.state.upload_total > 0 ? HF.state.uploaded_bytes / HF.state.upload_total * 100 : 0;
        HF.reset_upload_metrics();
        HF.set_upload_panel(HF.labels.upload_failed, message, percent, 'error', HF.state.uploaded_bytes, HF.state.upload_total);
    }

    HF.refresh_after_write = function refresh_after_write(select_path) {
        var current = HF.state.current ? { kind: HF.state.current.kind, path: HF.state.current.path } : null;
        HF.refresh_navigation(function() {
            if (current && current.kind === 'directory') {
                HF.open_path(current.path, false, select_path);
            } else {
                HF.show_virtual(current ? current.kind : 'quick_access', false);
            }
        });
    }

    HF.valid_entry_name = function valid_entry_name(name) {
        return !!name && name !== '.' && name !== '..' && !/[\\/\x00-\x1f\x7f]/.test(name);
    }

    HF.open_name_dialog = function open_name_dialog(action, item) {
        HF.state.name_action = { action: action, item: item || null };
        var is_rename = action === 'rename';
        var is_create_file = action === 'create_file';
        var is_bm_folder_rename = action === 'bm_folder_rename';
        document.getElementById('fm_name_title').textContent =
            is_bm_folder_rename ? HF.labels.rename_folder :
            (is_rename ? HF.labels.rename : (is_create_file ? HF.labels.new_file : HF.labels.new_folder));
        document.getElementById('fm_name_label').textContent =
            (is_rename || is_bm_folder_rename || action === 'bm_folder_new') ? HF.labels.folder_name :
            (is_create_file ? HF.labels.file_name : HF.labels.folder_name);
        document.getElementById('fm_name_confirm').textContent = (is_rename || is_bm_folder_rename) ? HF.labels.save : HF.labels.create;
        var input = document.getElementById('fm_name_input');
        input.value = (is_rename && item) ? item.name : (is_bm_folder_rename && item ? item.folder : '');
        HF.open_modal('fm_name_dialog');
        setTimeout(function() {
            input.focus();
            input.select();
        }, 0);
    }

    HF.submit_name_dialog = function submit_name_dialog() {
        var action = HF.state.name_action;
        var name = document.getElementById('fm_name_input').value.trim();
        if (!action || !HF.valid_entry_name(name)) {
            HF.set_warning_status(HF.labels.invalid_name);
            return;
        }
        HF.close_modal();
        if (action.action === 'bm_folder_new') {
            HF.request_write(HF.api.bookmark_folder_add, { name: name }, HF.labels.folder_created,
                function(data) { HF.apply_bookmarks(data); });
            return;
        }
        if (action.action === 'bm_folder_rename') {
            HF.request_write(HF.api.bookmark_folder_rename, { from: action.item.folder, to: name }, HF.labels.rename_complete,
                function(data) { HF.apply_bookmarks(data); });
            return;
        }
        if (action.action === 'rename') {
            HF.request_write(HF.api.rename, { path: action.item.path, new_name: name }, HF.labels.rename_complete, HF.refresh_after_write);
            return;
        }
        if (action.action === 'create_file') {
            HF.request_write(HF.api.create_file, { target_dir: HF.state.current.path, name: name }, HF.labels.file_created, HF.refresh_after_write);
            return;
        }
        HF.request_write(HF.api.create_directory, { target_dir: HF.state.current.path, name: name }, HF.labels.folder_created, HF.refresh_after_write);
    }

    HF.open_delete_dialog = function open_delete_dialog(items) {
        items = HF.normalize_item_list(Array.isArray(items) ? items : [items]);
        if (!items.length) {
            return;
        }
        HF.state.delete_item = items[0];
        HF.state.delete_items = items;
        var copy = document.querySelector('#fm_delete_dialog .fm-delete-copy');
        if (copy && copy.firstChild) {
            copy.firstChild.nodeValue = (items.length > 1 ? HF.labels.delete_selected_items : HF.labels.delete_item_confirm) + ' ';
        }
        var names = items.slice(0, 5).map(function(item) { return item.name; }).join(', ');
        if (items.length > 5) {
            names += ' ...';
        }
        document.getElementById('fm_delete_name').textContent =
            items.length > 1 ? HF.format_label(HF.labels.selected_items, items.length) + ': ' + names : items[0].name;
        HF.open_modal('fm_delete_dialog');
    }

    HF.set_view_mode = function set_view_mode(mode, persist) {
        var modes = ['large', 'medium', 'small', 'list', 'details', 'tile'];
        if (modes.indexOf(mode) < 0) {
            return;
        }
        HF.state.view_mode = mode;
        HF.hide_context_menus();
        HF.refresh_current();
        if (persist !== false) {
            HF.state.preferences.view_mode = HF.view_mode_to_value(mode);
            HF.save_preferences({ section: 'basic', view_mode: HF.state.preferences.view_mode });
        }
    }

    HF.load_target_directory = function load_target_directory(path) {
        HF.request_json(HF.api.list, { path: path }, function(data) {
            HF.state.target_path = data.path;
            HF.state.target_parent = data.parent;
            HF.state.target_has_operation_space = data.has_operation_space !== false;
            document.getElementById('fm_target_path').textContent = data.path;
            document.getElementById('fm_target_up').disabled = data.path === '/';
            var target_reason = HF.get_system_block_reason(data.path) ||
                (HF.state.target_has_operation_space ? '' : HF.labels.space_less_than_50mb);
            HF.set_button_state('fm_target_confirm', !!target_reason, target_reason);
            var list = document.getElementById('fm_target_list');
            HF.clear_node(list);
            (data.items || []).filter(function(item) {
                return item.type === 'directory';
            }).forEach(function(item) {
                var button = document.createElement('button');
                button.type = 'button';
                button.className = 'fm-target-item';
                var image = document.createElement('img');
                image.src = HF.icon_url('folder');
                image.alt = '';
                var name = document.createElement('span');
                name.textContent = item.name;
                button.appendChild(image);
                button.appendChild(name);
                HF.set_button_state(button, !HF.can_modify_system_path(item.path), HF.get_system_block_reason(item.path));
                button.addEventListener('click', function() {
                    if (HF.can_modify_system_path(item.path)) {
                        HF.load_target_directory(item.path);
                    }
                });
                list.appendChild(button);
            });
        });
    }

    HF.batch_error_message = function batch_error_message(xhr, fallback) {
        var res = HF.response_json(xhr);
        var data = res.data || {};
        if (data.failed_path) {
            return HF.format_label(HF.labels.batch_stopped_at, data.failed_path) + (res.message ? ': ' + res.message : '');
        }
        return res.message || fallback;
    }

    HF.report_batch_transfer = function report_batch_transfer(res, success_message) {
        var data = (res && res.data) || {};
        var results = data.results || [];
        var skipped = 0;
        var bad = [];
        results.forEach(function (r) {
            if (!r) {
                return;
            }
            if (r.error === 'skipped') {
                skipped++;
            } else if (!r.ok) {
                bad.push(r);
            }
        });
        var done = results.length - bad.length - skipped;
        if (bad.length) {
            HF.set_error_status(bad.slice(0, 3).map(function (b) {
                return (b.error || HF.labels.operation_failed) + '：' + (b.failed_item || b.path || '');
            }).join('；') + (bad.length > 3 ? ' …' : ''));
        }
        else if (skipped && !done) {
            HF.set_warning_status(HF.labels.skip + ': ' + skipped + ' ' + HF.labels.files);
        }
        else if (skipped) {
            HF.set_status(success_message + ' (' + done + '/' + results.length + ', ' +
                HF.labels.skip + ' ' + skipped + ')', 'success');
        }
        else {
            HF.set_status(success_message, 'success');
        }
        return { done: done, failed: bad.length, skipped: skipped, total: results.length, all_ok: !bad.length };
    }

    HF.run_batch_transfer = function run_batch_transfer(action, items, target_path) {
        items = HF.normalize_item_list(items);
        if (!items.length || !target_path) {
            HF.set_warning_status(HF.labels.no_files);
            return;
        }
        HF.confirm_paste_transfer(action, items, target_path);
    }

    HF.open_transfer_dialog = function open_transfer_dialog(action, items) {
        items = HF.normalize_item_list(Array.isArray(items) ? items : [items]);
        if (!items.length || !HF.state.current || HF.state.current.kind !== 'directory') {
            return;
        }
        HF.state.transfer_action = { action: action, items: items };
        document.getElementById('fm_target_title').textContent = action === 'copy' ? HF.labels.copy_to : HF.labels.move_to;
        document.getElementById('fm_target_source').textContent =
            items.length > 1 ? HF.format_label(HF.labels.selected_items, items.length) : items[0].path;
        document.getElementById('fm_target_confirm').textContent = action === 'copy' ? HF.labels.copy_to : HF.labels.move_to;
        HF.open_modal('fm_target_dialog');
        HF.load_target_directory(HF.state.current.path);
    }

    HF.confirm_transfer = function confirm_transfer() {
        var transfer = HF.state.transfer_action;
        var target_path = HF.state.target_path;
        if (!transfer || !target_path) {
            return;
        }
        if (!HF.can_modify_system_path(target_path)) {
            HF.set_warning_status(HF.labels.system_folder_blocked);
            return;
        }
        if (HF.state.target_has_operation_space === false) {
            HF.set_write_block_status(HF.labels.space_less_than_50mb);
            return;
        }
        HF.close_modal();
        HF.run_batch_transfer(transfer.action, transfer.items, target_path);
    }

    HF.trigger_upload = function trigger_upload(target_dir, target_label) {
        if (HF.state.uploading || !target_dir) {
            HF.set_warning_status(HF.labels.upload_busy);
            return;
        }
        if (!HF.can_upload_to_path(target_dir)) {
            HF.set_write_block_status(HF.get_write_block_reason(target_dir) || HF.labels.system_folder_blocked);
            return;
        }
        HF.state.upload_target = { path: target_dir, label: target_label };
        document.getElementById('fm_upload_input').click();
    }

    HF.trigger_download = function trigger_download(item) {
        if (!item || item.type === 'directory') {
            HF.set_error_status(HF.labels.download_failed);
            return;
        }
        HarborIO.download(item.path, item.name || 'download');
    }

    HF.set_clipboard = function set_clipboard(mode, items) {
        items = HF.normalize_item_list(Array.isArray(items) ? items : [items]).filter(function(item) {
            return item && item.path && item.path !== '/';
        });
        if (!items.length) {
            return;
        }
        HF.state.clipboard = {
            mode: mode,
            items: items.map(function(item) {
                return {
                    path: item.path,
                    name: item.name,
                    type: item.type
                };
            })
        };
        HF.set_status(mode === 'cut' ? HF.labels.cut_to_clipboard : HF.labels.copied_to_clipboard, 'success');
    }

    HF.executePaste = function executePaste(action, items, target_path, conflict_action, rename_map) {
        var success_message = action === 'copy' ? HF.labels.copy_complete : HF.labels.move_complete;
        var url = action === 'copy' ? HF.api.batch_copy : HF.api.batch_move;
        var data = {
            sources: JSON.stringify(items.map(function(item) { return item.path; })),
            target_dir: target_path
        };
        if (conflict_action) {
            data.conflict_action = conflict_action;
        }
        if (rename_map) {
            data.rename_map = JSON.stringify(rename_map);
        }
        HF.Util.ajax({
            url: url,
            type: 'POST',
            data: data,
            dataType: 'json',
            success: function(res) {
                if (res.code !== 0) {
                    HF.set_error_status(res.message || HF.labels.operation_failed);
                    return;
                }
                var summary = HF.report_batch_transfer(res, success_message);
                if (action === 'move' && summary.done > 0 && summary.all_ok) {
                    HF.state.clipboard = null;
                }
                HF.refresh_after_write();
            },
            error: function(xhr) {
                HF.set_error_status(HF.batch_error_message(xhr, HF.labels.operation_failed));
            }
        });
    }

    HF.run_paste = function run_paste(target_path) {
        if (!HF.has_clipboard()) {
            HF.set_warning_status(HF.labels.clipboard_empty);
            return;
        }
        if (!HF.can_paste_to_path(target_path)) {
            HF.set_warning_status(HF.labels.system_folder_blocked);
            return;
        }
        var clipboard = HF.state.clipboard;
        var items = clipboard.items;
        var action = clipboard.mode === 'cut' ? 'move' : 'copy';

        HF.confirm_paste_transfer(action, items, target_path);
    }

    HF.confirm_paste_transfer = function confirm_paste_transfer(action, items, target_path) {
        HF.Util.ajax({
            url: HF.api.batch_check,
            type: 'POST',
            data: {
                action: action,
                sources: JSON.stringify(items.map(function(item) { return item.path; })),
                target_dir: target_path
            },
            dataType: 'json',
            success: function(res) {
                if (res.code !== 0) {
                    HF.set_error_status(res.message || HF.labels.request_failed);
                    return;
                }
                var conflicts = (res.data && res.data.conflicts) || [];
                if (conflicts.length === 0) {
                    HF.executePaste(action, items, target_path);
                } else {
                    HF.showPasteConflictDialog(conflicts, action, items, target_path);
                }
            },
            error: function(xhr) {
                HF.set_error_status(HF.upload_error_message(xhr, HF.labels.request_failed));
            }
        });
    }

    HF.showPasteConflictDialog = function showPasteConflictDialog(conflicts, action, items, target_path) {
        var list = document.getElementById('fm_conflict_list');
        HF.clear_node(list);
        conflicts.forEach(function(item) {
            var li = document.createElement('li');
            li.textContent = item.name;
            list.appendChild(li);
        });

        document.getElementById('fm_overwrite_title').textContent = HF.labels.file_conflict;
        document.querySelector('#fm_overwrite_dialog .fm-overwrite-copy').textContent =
            conflicts.length + ' ' + HF.labels.files + ' ' + HF.labels.already_exist + '，' + HF.labels.please_select_operation;

        var confirmBtn = document.getElementById('fm_overwrite_confirm');
        confirmBtn.style.display = 'none';
        var actions = HF.reset_overwrite_actions();

        var replaceBtn = document.createElement('button');
        replaceBtn.className = 'fm-dialog-action primary fm-dynamic-paste-btn';
        replaceBtn.textContent = HF.labels.overwrite;
        replaceBtn.onclick = function() {
            HF.close_modal();
            HF.executePaste(action, items, target_path, 'overwrite');
        };
        actions.appendChild(replaceBtn);

        var renameBtn = document.createElement('button');
        renameBtn.className = 'fm-dialog-action fm-dynamic-paste-btn';
        renameBtn.textContent = HF.labels.rename;
        renameBtn.onclick = function() {
            HF.close_modal();
            HF.executePaste(action, items, target_path, 'rename');
        };
        actions.appendChild(renameBtn);

        var skipBtn = document.createElement('button');
        skipBtn.className = 'fm-dialog-action fm-dynamic-paste-btn';
        skipBtn.textContent = HF.labels.skip;
        skipBtn.onclick = function() {
            HF.close_modal();
            HF.executePaste(action, items, target_path, 'skip');
        };
        actions.appendChild(skipBtn);

        HF.open_modal('fm_overwrite_dialog');
    }

    HF.hide_context_menus = function hide_context_menus(keep_anchor) {
        HF.hide_item_hover_card();
        var menus = document.querySelectorAll('.fm-context-menu');
        for (var i = 0; i < menus.length; i++) {
            menus[i].style.display = 'none';
        }
        var anchors = document.querySelectorAll('.fm-tool-dropdown[data-anchor-menu], .fm-fav-panel[data-anchor-menu]');
        for (var j = 0; j < anchors.length; j++) {
            if (anchors[j] !== keep_anchor) {
                HF.hide_anchor_menu(anchors[j]);
            }
        }
    }

    HF.position_context_menu = function position_context_menu(menu, x, y) {
        menu.style.display = 'block';
        var rect = menu.getBoundingClientRect();
        var left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
        var top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }

    HF.show_context_menu = function show_context_menu(id, x, y, keep_anchor) {
        HF.hide_context_menus(keep_anchor);
        HF.position_context_menu(document.getElementById(id), x, y);
    }

    HF.show_sort_menu = function show_sort_menu() {
        var button = document.getElementById('fm_menu_sort');
        if (button.disabled || !HF.state.current || HF.state.current.kind !== 'directory') {
            return;
        }
        HF.update_sort_menu_state();
        var rect = button.getBoundingClientRect();
        var menu = document.getElementById('fm_sort_menu');
        var x = rect.right + 2;
        var y = rect.top;
        menu.style.display = 'block';
        var menu_rect = menu.getBoundingClientRect();
        if (x + menu_rect.width > window.innerWidth - 8) {
            x = rect.left - menu_rect.width - 2;
        }
        if (y + menu_rect.height > window.innerHeight - 8) {
            y = window.innerHeight - menu_rect.height - 8;
        }
        menu.style.left = Math.max(8, x) + 'px';
        menu.style.top = Math.max(8, y) + 'px';
    }

    HF.stop_install_poll = function stop_install_poll() {
        if (HF.state.install_poll_timer) {
            clearTimeout(HF.state.install_poll_timer);
            HF.state.install_poll_timer = null;
        }
    }

    HF.update_package_install_view = function update_package_install_view(data) {
        var task = data || {};
        HF.state.install_task = task;
        document.getElementById('fm_package_install_title').textContent = task.done ?
            (HF.task_unconfirmed(task) ? HF.labels.task_status_unknown :
                (task.success ? HF.labels.install_success : HF.labels.install_failed)) :
            HF.labels.installing_package;
        document.getElementById('fm_package_install_status').textContent = task.message || HF.labels.install_running;
        document.getElementById('fm_package_install_name').textContent =
            HF.state.install_item ? HF.state.install_item.name : (task.package_name || (task.path || '-').split('/').pop());
        document.getElementById('fm_package_install_path').textContent = task.path || task.package_name || '-';
        document.getElementById('fm_package_install_type').textContent = HF.package_type_label(task.package_type);
        document.getElementById('fm_package_install_installer').textContent = task.installer || '-';
        document.getElementById('fm_package_install_exit').textContent =
            task.exit_code === undefined || task.exit_code === null ? '-' : String(task.exit_code);
        document.getElementById('fm_package_install_log').textContent = task.log || HF.labels.no_log_yet;
        document.getElementById('fm_package_install_close').disabled = !task.done;
        document.getElementById('fm_package_install_done').disabled = !task.done;
    }

    HF.poll_package_install = function poll_package_install(task_id) {
        HF.stop_install_poll();
        HF.Util.ajax({
            url: HF.api.package_install_status,
            type: 'GET',
            data: { task_id: task_id },
            dataType: 'json',
            success: function(res) {
                if (!res || res.code !== 0) {
                    HF.report_task_poll_error('install_task', HF.update_package_install_view, res, null, function() {
                        HF.poll_package_install(task_id);
                    });
                    return;
                }
                HF.update_package_install_view(res.data || {});
                if (HF.state.install_task && !HF.state.install_task.done) {
                    HF.state.install_poll_timer = setTimeout(function() {
                        HF.poll_package_install(task_id);
                    }, 1000);
                    return;
                }
                if (HF.state.install_task && HF.state.install_task.done) {
                }
            },
            error: function(xhr) {
                HF.report_task_poll_error('install_task', HF.update_package_install_view, null, xhr, function() {
                    HF.poll_package_install(task_id);
                });
            }
        });
    }

    HF.start_package_install = function start_package_install(item) {
        HF.request_write(HF.api.package_install_start, { path: item.path }, '', function(data) {
            HF.close_modal();
            HF.state.install_item = item;
            HF.update_package_install_view(data || {});
            HF.open_modal('fm_package_install_dialog');
            HF.poll_package_install(data.task_id);
        });
    }

    HF.open_package_confirm = function open_package_confirm(item) {
        HF.state.install_item = item;
        document.getElementById('fm_package_confirm_name').textContent = item.name;
        document.getElementById('fm_package_confirm_path').textContent = item.path;
        document.getElementById('fm_package_confirm_type').textContent = HF.package_type_label(item.ext, item.path);
        document.getElementById('fm_package_confirm_installer').textContent = HF.package_installer_name(item.ext, item.path);
        HF.open_modal('fm_package_confirm_dialog');
    }

    HF.stop_thumbnail_poll = function stop_thumbnail_poll() {
        if (HF.state.thumbnail_poll_timer) {
            clearTimeout(HF.state.thumbnail_poll_timer);
            HF.state.thumbnail_poll_timer = null;
        }
    }

    HF.update_thumbnail_view = function update_thumbnail_view(data) {
        var task = data || {};
        HF.state.thumbnail_task = task;
        var total = Number(task.total || 0);
        var processed = Number(task.processed || 0);
        var percent = total > 0 ? Math.max(0, Math.min(100, Math.round(processed * 100 / total))) : 0;
        var tool_missing = task.missing_tool === 'gm' || task.dependency_missing === true;
        document.getElementById('fm_thumbnail_title').textContent = tool_missing ?
            HF.labels.thumbnail_tool_required :
            (task.done ? (task.success ? HF.labels.thumbnail_success : HF.labels.thumbnail_failed) : HF.labels.generating_thumbnails);
        document.getElementById('fm_thumbnail_status').textContent = task.message || HF.labels.generating_thumbnails;
        document.getElementById('fm_thumbnail_progress_bar').style.width = percent + '%';
        document.getElementById('fm_thumbnail_path').textContent = task.path || '-';
        document.getElementById('fm_thumbnail_current').textContent = task.current_file || '-';
        document.getElementById('fm_thumbnail_progress_text').textContent = processed + ' / ' + total + ' (' + percent + '%)';
        document.getElementById('fm_thumbnail_success').textContent = String(task.success_count || 0);
        document.getElementById('fm_thumbnail_cached').textContent = String(task.cached_count || 0);
        document.getElementById('fm_thumbnail_failed').textContent = String(task.failed_count || 0);
        document.getElementById('fm_thumbnail_log').textContent = task.log || HF.labels.no_log_yet;
        document.getElementById('fm_thumbnail_install_tool').style.display = tool_missing ? '' : 'none';
        document.getElementById('fm_thumbnail_close').disabled = !task.done && !tool_missing;
        document.getElementById('fm_thumbnail_done').disabled = !task.done && !tool_missing;
    }

    HF.poll_thumbnail_generation = function poll_thumbnail_generation(task_id) {
        HF.stop_thumbnail_poll();
        HF.Util.ajax({
            url: HF.api.thumbnail_generate_status,
            type: 'GET',
            data: { task_id: task_id },
            dataType: 'json',
            success: function(res) {
                if (!res || res.code !== 0) {
                    HF.report_task_poll_error('thumbnail_task', HF.update_thumbnail_view, res, null, function() {
                        HF.poll_thumbnail_generation(task_id);
                    });
                    return;
                }
                HF.update_thumbnail_view(res.data || {});
                if (HF.state.thumbnail_task && !HF.state.thumbnail_task.done) {
                    HF.state.thumbnail_poll_timer = setTimeout(function() {
                        HF.poll_thumbnail_generation(task_id);
                    }, 1000);
                    return;
                }
                if (HF.state.thumbnail_task && HF.state.thumbnail_task.done) {
                    if (HF.state.current && HF.state.current.kind === 'directory' && HF.state.current.path === HF.state.thumbnail_task.path) {
                        HF.refresh_current();
                    }
                }
            },
            error: function(xhr) {
                HF.report_task_poll_error('thumbnail_task', HF.update_thumbnail_view, null, xhr, function() {
                    HF.poll_thumbnail_generation(task_id);
                });
            }
        });
    }

    HF.start_thumbnail_generation = function start_thumbnail_generation(path) {
        HF.Util.ajax({
            url: HF.api.thumbnail_generate_start,
            type: 'POST',
            data: { path: path },
            dataType: 'json',
            success: function(res) {
                if (!res || res.code !== 0) {
                    HF.set_error_status((res && res.message) || HF.labels.thumbnail_failed);
                    return;
                }
                var data = res.data || {};
                HF.state.thumbnail_path = path;
                HF.update_thumbnail_view(data);
                HF.open_modal('fm_thumbnail_dialog');
                HF.poll_thumbnail_generation(data.task_id);
            },
            error: function(xhr) {
                var res = HF.response_json(xhr);
                var data = res.data || {};
                if (res.code === 2 && data.missing_tool === 'gm') {
                    HF.state.thumbnail_path = path;
                    HF.update_thumbnail_view({
                        done: true,
                        success: false,
                        dependency_missing: true,
                        missing_tool: 'gm',
                        package_name: data.package_name || 'graphicsmagick',
                        installer: data.installer || '',
                        path: path,
                        message: res.message || HF.labels.thumbnail_command_missing,
                        log: HF.labels.thumbnail_tool_required
                    });
                    HF.open_modal('fm_thumbnail_dialog');
                    return;
                }
                HF.set_error_status(HF.upload_error_message(xhr, HF.labels.thumbnail_failed));
            }
        });
    }

    HF.start_thumbnail_tool_install = function start_thumbnail_tool_install() {
        HF.request_write(HF.api.thumbnail_tool_install_start, {}, '', function(data) {
            HF.close_modal();
            HF.state.install_item = {
                name: data.package_name || 'graphicsmagick',
                path: data.package_name || 'graphicsmagick',
                ext: 'repository'
            };
            HF.update_package_install_view(data || {});
            HF.open_modal('fm_package_install_dialog');
            if (data.task_id && !data.done) {
                HF.poll_package_install(data.task_id);
            }
        });
    }

    HF.start_terminal_tool_install = function start_terminal_tool_install() {
        HF.close_modal();
        HF.state.install_item = {
            name: 'ttyd',
            path: 'ttyd',
            ext: 'repository'
        };
        HF.update_package_install_view({
            state: 'running',
            done: false,
            success: false,
            message: HF.labels.install_running,
            package_type: 'repository',
            package_name: 'ttyd',
            path: 'ttyd',
            log: HF.labels.no_log_yet
        });
        HF.open_modal('fm_package_install_dialog');
        HF.request_write(HF.api.terminal_tool_install_start, {}, '', function(data) {
            HF.state.install_item = {
                name: data.package_name || 'ttyd',
                path: data.package_name || 'ttyd',
                ext: 'repository'
            };
            HF.update_package_install_view(data || {});
            HF.open_modal('fm_package_install_dialog');
            if (data.task_id && !data.done) {
                HF.poll_package_install(data.task_id);
            }
        }, function(message) {
            HF.update_package_install_view({
                state: 'failed',
                done: true,
                success: false,
                message: message || HF.labels.install_failed,
                package_type: 'repository',
                package_name: 'ttyd',
                path: 'ttyd',
                exit_code: -1,
                log: message || HF.labels.install_failed
            });
        });
    }

    HF.remember_open_type = function remember_open_type(item, open_type) {
        if (!item || !item.path) return;
        if (!HF.state.open_type_map) {
            HF.state.open_type_map = {};
        }
        HF.state.open_type_map[item.path] = open_type;
        if (HF.api.save_preferences && HF.Util && HF.Util.ajax) {
            HF.Util.ajax({
                url: HF.api.save_preferences,
                type: 'POST',
                data: { open_type_map: JSON.stringify(HF.state.open_type_map) },
                dataType: 'json'
            });
        }
    };

    HF.open_item = function open_item(item, force_preview) {
        HF.hide_context_menus();
        if (!item) return;

        if (item.type === 'directory') {
            HF.open_path(item.path, true);
            return;
        }

        if (force_preview) {
            if (force_preview === 'text') { HF.open_text(item); return; }
            if (force_preview === 'image') { HF.open_image(item); return; }
            if (force_preview === 'pdf') { HF.open_pdf(item); return; }
            if (force_preview === 'video') { HF.open_video(item); return; }
            if (force_preview === 'hex') { HF.open_binary(item); return; }
        }

        var saved_type = HF.state.open_type_map && HF.state.open_type_map[item.path];
        if (saved_type) {
            if (saved_type === 'text') { HF.open_text(item); return; }
            if (saved_type === 'image') { HF.open_image(item); return; }
            if (saved_type === 'pdf') { HF.open_pdf(item); return; }
            if (saved_type === 'video') { HF.open_video(item); return; }
            if (saved_type === 'hex') { HF.open_binary(item); return; }
        }

        if (item.preview === 'text') { HF.open_text(item); return; }
        if (item.preview === 'image') { HF.open_image(item); return; }
        if (item.preview === 'pdf') { HF.open_pdf(item); return; }
        if (item.preview === 'video') { HF.open_video(item); return; }
        if (item.preview === 'package') { HF.open_package_confirm(item); return; }

        if (item.preview === 'none') {
            HF.open_openwith_dialog(item);
            return;
        }
        HF.open_binary(item);
    }

    HF.open_openwith_dialog = function open_openwith_dialog(item) {
        if (!item || item.type === 'directory') {
            return;
        }
        HF.state.openwith_item = item;
        var name = document.querySelector('#fm_openwith_dialog .fm-openwith-name');
        if (name) {
            name.textContent = item.name || item.path;
        }
        HF.open_modal('fm_openwith_dialog');
    }

    HF.open_with_text = function open_with_text(item) {
        item = item || HF.state.openwith_item;
        if (!item) {
            return;
        }
        HF.request_detect_type(item.path, function(type) {
            if (type !== 'text') {
                HF.set_warning_status(HF.labels.not_text_opened_hex);
                HF.open_binary(item);
                return;
            }
            HF.open_text(item);
        });
    }

    HF.open_with_hex = function open_with_hex(item) {
        item = item || HF.state.openwith_item;
        if (!item) {
            return;
        }
        HF.open_binary(item);
    }

    HF.refresh_current = function refresh_current() {
        if (HF.state.current && HF.state.current.kind === 'directory') {
            HF.refresh_navigation(function() {
                HF.open_path(HF.state.current.path, false);
            });
            return;
        }
        HF.refresh_navigation(function() {
            HF.show_virtual(HF.state.current ? HF.state.current.kind : 'quick_access', false);
        });
    }

    HF.save_last_directory = function save_last_directory(path) {
        path = String(path || '');
        if (!path || path.charAt(0) !== '/' || path === HF.state.last_directory_sent) {
            return;
        }
        if (HF.state.last_directory_timer) {
            clearTimeout(HF.state.last_directory_timer);
        }
        HF.state.last_directory_timer = setTimeout(function() {
            HF.state.last_directory_timer = null;
            HF.state.last_directory_sent = path;
            HF.Util.ajax({
                url: HF.api.save_last_directory,
                type: 'POST',
                data: { path: path },
                dataType: 'json'
            });
        }, 800);
    }

    HF.save_show_line_numbers = function save_show_line_numbers(value) {
        var next = value === 1 ? 1 : 0;
        HF.state.preferences.show_line_numbers = next;
        HF.Util.ajax({
            url: HF.api.save_show_line_numbers,
            type: 'POST',
            data: { value: next },
            dataType: 'json'
        });
    };

    HF.open_path = function open_path(path, add_history, select_path) {
        HF.request_json(HF.api.list, { path: path }, function(data) {
            if (HF.state.sort_path && HF.state.sort_path !== data.path) {
                HF.state.sort_path = '';
                HF.state.sort_field = 'name';
                HF.state.sort_order = 'asc';
            }
            HF.state.current = {
                kind: 'directory',
                path: data.path,
                parent: data.parent,
                available_bytes: Number(data.available_bytes || 0),
                operation_space_margin: Number(data.operation_space_margin || 0),
                has_operation_space: data.has_operation_space !== false
            };
            HF.state.current_directory_data = data;
            HF.save_last_directory(data.path);
            HF.clear_selection();
            HF.state.context_item = null;
            HF.render_directory(data);
            if (select_path) {
                HF.select_rendered_item_by_path(select_path);
            }
            if (add_history) {
                HF.push_history(HF.state.current);
            }
            HF.render_sidebar();
            HF.update_toolbar();
        });
    }

    
    HF.mount_point_name = function mount_point_name(path) {
        var drives = (HF.state.navigation && HF.state.navigation.drives) || [];
        for (var i = 0; i < drives.length; i++) {
            if (drives[i].path === path && drives[i].name) {
                return drives[i].path === '/' ? HF.labels.system_disk : drives[i].name;
            }
        }
        return null;
    }

    HF.path_segments = function path_segments() {
        if (!HF.state.current) {
            return [];
        }
        if (HF.state.current.kind === 'quick_access') {
            return [{ label: HF.labels.quick_access, kind: 'quick_access' }];
        }
        var crumbs = [{ label: HF.labels.this_pc, kind: 'this_pc' }];
        if (HF.state.current.kind !== 'directory') {
            return crumbs;
        }
        if (HF.state.current.path === '/') {
            crumbs.push({ label: HF.labels.system_disk, path: '/', kind: 'directory' });
            return crumbs;
        }
        var current_path = '';
        HF.state.current.path.split('/').filter(function(part) { return part !== ''; }).forEach(function(part) {
            current_path += '/' + part;
            crumbs.push({ label: part, path: current_path, kind: 'directory' });
        });
        return crumbs;
    }

    HF.open_crumb = function open_crumb(crumb) {
        HF.close_anchor_menus();
        if (crumb.kind === 'this_pc') {
            HF.show_virtual('this_pc', true);
        } else if (crumb.path) {
            HF.open_path(crumb.path, true);
        }
    }

    HF.create_crumb = function create_crumb(crumb) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'fm-crumb';
        button.textContent = crumb.label;
        button.addEventListener('click', function() { HF.open_crumb(crumb); });
        return button;
    }

    HF.current_page_title = function current_page_title() {
        if (!HF.state.current) {
            return '';
        }
        if (HF.state.current.kind === 'quick_access') {
            return HF.labels.quick_access;
        }
        return HF.labels.this_pc;
    }

    HF.render_breadcrumb = function render_breadcrumb() {
        var body = document.getElementById('fm_address_body');
        HF.clear_node(body);

        var crumbs = document.createElement('span');
        crumbs.className = 'fm-breadcrumb-container';
        HF.path_segments().forEach(function(crumb, index) {
            if (index) {
                var separator = document.createElement('span');
                separator.className = 'fm-crumb-separator';
                separator.textContent = '\u203A';
                crumbs.appendChild(separator);
            }
            crumbs.appendChild(HF.create_crumb(crumb));
        });
        body.appendChild(crumbs);

        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'fm_address_input';
        input.className = 'fm-address-input';
        input.value = HF.state.current && HF.state.current.path ? HF.state.current.path : HF.current_page_title();
        input.readOnly = !(HF.state.current && HF.state.current.kind === 'directory');
        input.style.display = 'none';
        body.appendChild(input);

        crumbs.scrollLeft = crumbs.scrollWidth;
        input.addEventListener('focus', HF.enter_address_edit);
        input.addEventListener('blur', function() {
            setTimeout(HF.exit_address_edit, 100);
        });
        input.addEventListener('keydown', function(event) {
            if (event.key === 'Enter') {
                var path = this.value.trim();
                if (path && path.charAt(0) === '/') {
                    HF.open_path(path, true);
                    HF.exit_address_edit();
                } else if (path) {
                    HF.set_warning_status(HF.tr('Please enter an absolute path starting with /'));
                }
            } else if (event.key === 'Escape') {
                HF.exit_address_edit();
                this.blur();
            }
        });

        HF.update_star();
    }

    HF.enter_address_edit = function enter_address_edit() {
        if (HF.state.address_editing) {
            return;
        }
        var input = document.getElementById('fm_address_input');
        var crumbs = document.querySelector('.fm-breadcrumb-container');
        if (!input || !crumbs || input.readOnly) {
            return;
        }
        HF.state.address_editing = true;
        crumbs.style.display = 'none';
        input.style.display = 'inline-block';
        input.value = HF.state.current && HF.state.current.path ? HF.state.current.path : '';
        input.focus();
        input.select();
    }

    HF.exit_address_edit = function exit_address_edit() {
        if (!HF.state.address_editing) {
            return;
        }
        var input = document.getElementById('fm_address_input');
        var crumbs = document.querySelector('.fm-breadcrumb-container');
        HF.state.address_editing = false;
        if (input) {
            input.style.display = 'none';
            input.value = HF.state.current && HF.state.current.path ? HF.state.current.path : HF.current_page_title();
        }
        if (crumbs) {
            crumbs.style.display = 'inline-flex';
            crumbs.scrollLeft = crumbs.scrollWidth;
        }
    }

    document.addEventListener('click', function(event) {
        if (!event.target.closest) {
            return;
        }
        if (event.target.closest('#fm_address .fm-crumb, #fm_address .fm-address-star, #fm_address .fm-address-input, #fm_address #fm_refresh')) {
            return;
        }
        if (event.target.closest('#fm_address')) {
            HF.enter_address_edit();
        }
    });

    HF.refresh_navigation = function refresh_navigation(on_done) {
        HF.request_json(HF.api.navigation, {}, function(data) {
            HF.state.navigation.quick_access = data.quick_access || [];
            HF.state.navigation.folders = data.folders || [];
            HF.state.navigation.drives = data.drives || [];
            HF.state.navigation.bookmarks = data.bookmarks || [];
            HF.state.navigation.bookmark_folders = data.bookmark_folders || [];
            HF.state.navigation.fav_expanded = data.fav_expanded || [];
            if (data.home_dir) {
                HF.state.preferences.home_dir = data.home_dir;
            }
            HF.render_sidebar();
            if (on_done) {
                on_done();
            }
        });
    }
    HF.FileOperations = {
        navigate: HF.navigate,
        open_item: HF.open_item,
        open_path: HF.open_path,
        refresh_current: HF.refresh_current,
        refresh_navigation: HF.refresh_navigation,
        refresh_after_write: HF.refresh_after_write,
        render_directory: HF.render_directory,
        show_virtual: HF.show_virtual,
        set_view_mode: HF.set_view_mode,
        set_clipboard: HF.set_clipboard,
        executePaste: HF.executePaste,
        trigger_upload: HF.trigger_upload,
        trigger_download: HF.trigger_download,
        begin_upload: HF.begin_upload,
        load_preferences: HF.load_preferences,
        save_preferences: HF.save_preferences,
        apply_preferences: HF.apply_preferences,
        open_archive_dialog: HF.open_archive_dialog,
        open_transfer_dialog: HF.open_transfer_dialog,
        open_name_dialog: HF.open_name_dialog,
        open_delete_dialog: HF.open_delete_dialog,
        open_package_confirm: HF.open_package_confirm,
        load_target_directory: HF.load_target_directory,
        run_paste: HF.run_paste,
        update_toolbar: HF.update_toolbar
    };
})(window.HarborFile = window.HarborFile || {});
