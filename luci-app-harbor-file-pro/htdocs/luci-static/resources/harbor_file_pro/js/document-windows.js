
(function (HF) {
    HF.select_rendered_item_by_path = function select_rendered_item_by_path(path) {
        if (!path) {
            return false;
        }
        var nodes = document.querySelectorAll('.fm-item[data-path]');
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].getAttribute('data-path') === path) {
                HF.set_selected(nodes[i]._fmItem || null, nodes[i]);
                return true;
            }
        }
        return false;
    }

    HF.wm_window_action = function wm_window_action(label, primary) {
        var button = HF.Util.createElement('button', 'fm-window-action' + (primary ? ' primary' : ''), label);
        button.type = 'button';
        return button;
    }

    HF.wm_document_column = function wm_document_column() {
        return HF.Util.createElement('div', 'fm-window-document-column');
    }

    HF.wm_set_tip = function wm_set_tip(node, message, type) {
        node.className = 'fm-window-doc-tip' + (type ? ' is-' + type : '');
        node.textContent = message || '';
        node.style.display = message ? 'block' : 'none';
    }

    HF.wm_indent_profiles = {
        c:      { quotes: '"\'`', line: '//', block: true, open: /[{([]\s*$/, cont: /[,&|+]\s*$|\\\s*$/, close: /^[})\]]/ },
        shell:  { quotes: '"\'', line: '#', block: false, open: /[{([]\s*$|(^|\s)(then|do|else)\s*$|\bin\s*$/, cont: /\\\s*$|&&\s*$|\|\|\s*$|&\s*$/, close: /^(fi|done|esac|else|elif)\b|^\}|^\)/ },
        lua:    { quotes: '"\'', line: '--', block: false, open: /[{([]\s*$|(^|\s)(then|do|else|repeat|function)\s*$/, cont: false, close: /^(end|until|else|elseif)\b|^\}|^\)/ },
        python: { quotes: '"\'', line: '#', block: false, open: /:\s*$/, cont: /\\\s*$/, close: false },
        yaml:   { quotes: '"\'', line: '#', block: false, open: /:\s*$/, cont: false, close: false },
        ini:    { quotes: '', line: '#', block: false, open: false, cont: false, close: false },
        html:   { quotes: '"\'', line: false, block: false, open: /<[^/!?][^>]*[^/]>\s*$|[{([]\s*$/, cont: false, close: /^<\/|^-->|^[})\]]/ }
    };

    HF.wm_indent_profile_for = function wm_indent_profile_for(path, first_line) {
        var p = String(path || ''), name = p.split('/').pop();
        var ext = name.indexOf('.') >= 0 ? name.split('.').pop().toLowerCase() : '';
        var shebang = (String(first_line || '').match(/^#!\S*/) || [''])[0];
        if (/ucode$/.test(shebang)) return HF.wm_indent_profiles.c;
        if (/lua$/.test(shebang)) return HF.wm_indent_profiles.lua;
        if (/python/.test(shebang)) return HF.wm_indent_profiles.python;
        if (/(ba|a|z|da)?sh$/.test(shebang) || p.indexOf('/etc/init.d/') === 0) return HF.wm_indent_profiles.shell;
        if (['.bashrc', '.profile', '.bash_profile', '.zshrc'].indexOf(name) >= 0) return HF.wm_indent_profiles.shell;
        if (p.indexOf('/etc/config/') === 0) return HF.wm_indent_profiles.ini;
        var map = {
            uc: 'c', js: 'c', mjs: 'c', ts: 'c', json: 'c', css: 'c', scss: 'c',
            c: 'c', h: 'c', cpp: 'c', cc: 'c', hpp: 'c', java: 'c', go: 'c', rs: 'c', php: 'c',
            ut: 'html', htm: 'html', html: 'html', xml: 'html',
            sh: 'shell', bash: 'shell', zsh: 'shell', awk: 'shell',
            lua: 'lua', py: 'python', yaml: 'yaml', yml: 'yaml',
            conf: 'ini', ini: 'ini', cfg: 'ini', toml: 'ini'
        };
        return map[ext] ? HF.wm_indent_profiles[map[ext]] : null;
    }

    HF.wm_indent_unit = function wm_indent_unit(text) {
        var lines = String(text || '').split('\n'), tabs = 0, counts = {};
        for (var i = 0; i < lines.length && i < 400; i++) {
            var m = lines[i].match(/^(\t+| +)/);
            if (!m) continue;
            if (m[1][0] === '\t') tabs++;
            else counts[m[1].length] = (counts[m[1].length] || 0) + 1;
        }
        var spaced = 0, best = 0, w;
        for (w in counts) if (counts[w] > spaced) { spaced = counts[w]; best = +w; }
        if (!tabs && !spaced) return '    ';
        if (tabs >= spaced) return '\t';
        return new Array(Math.min(8, Math.max(2, best)) + 1).join(' ');
    }

    HF.wm_mask_line = function wm_mask_line(line, profile) {
        var out = '', q = null, i = 0, n = line.length;
        var lc = profile.line;
        while (i < n) {
            var c = line[i];
            if (q) {
                if (c === '\\') { out += '  '; i += 2; continue; }
                if (c === q) { q = null; out += c; }
                else out += ' ';
                i++;
                continue;
            }
            if (profile.quotes.indexOf(c) >= 0) { q = c; out += c; i++; continue; }
            if (lc && (lc.length === 1 ? c === lc[0] : c === lc[0] && line[i + 1] === lc[1])) {
                if (c === '#' && out.length && !/\s/.test(out.slice(-1))) { out += c; i++; continue; }
                break;
            }
            if (profile.block && c === '/' && line[i + 1] === '*') {
                var end = line.indexOf('*/', i + 2);
                if (end < 0) break;
                for (var k = 0; k <= end + 1 - i; k++) out += ' ';
                i = end + 2;
                continue;
            }
            out += c;
            i++;
        }
        return out;
    }

    HF.wm_line_delta = function wm_line_delta(masked) {
        var opens = (masked.match(/[{([]/g) || []).length;
        var closes = (masked.match(/[})\]]/g) || []).length;
        return opens - closes;
    }

    HF.wm_add_history_buttons = function wm_add_history_buttons(record, on_undo, on_redo) {
        var header = record.element.querySelector('.fm-window-titlebar');
        var controls = header && header.querySelector('.fm-window-controls');
        var undo = HF.Util.createElement('button', 'fm-window-title-history');
        var redo = HF.Util.createElement('button', 'fm-window-title-history');
        undo.type = 'button';
        redo.type = 'button';
        undo.textContent = '↶';
        redo.textContent = '↷';
        undo.title = HF.labels.undo;
        redo.title = HF.labels.redo;
        undo.setAttribute('aria-label', HF.labels.undo);
        redo.setAttribute('aria-label', HF.labels.redo);
        undo.addEventListener('click', on_undo);
        redo.addEventListener('click', on_redo);
        if (header) {
            header.insertBefore(undo, controls || null);
            header.insertBefore(redo, controls || null);
        }
        return {
            refresh: function (canUndo, canRedo) {
                undo.disabled = !canUndo;
                redo.disabled = !canRedo;
            }
        };
    }

    HF.wm_create_recover_banner = function wm_create_recover_banner(content, on_recover, on_discard) {
        var banner = HF.Util.createElement('div', 'fm-editor-recover');
        var copy = HF.Util.createElement('span', 'fm-editor-recover-copy', HF.labels.recover_unsaved);
        var actions = HF.Util.createElement('div', 'fm-editor-recover-actions');
        var recover_btn = HF.Util.createElement('button', 'fm-window-action primary', HF.labels.recover);
        var discard_btn = HF.Util.createElement('button', 'fm-window-action', HF.labels.discard_changes);
        recover_btn.type = 'button';
        discard_btn.type = 'button';
        recover_btn.addEventListener('click', function () {
            banner.remove();
            on_recover();
        });
        discard_btn.addEventListener('click', function () {
            banner.remove();
            on_discard();
        });
        actions.appendChild(recover_btn);
        actions.appendChild(discard_btn);
        banner.appendChild(copy);
        banner.appendChild(actions);
        content.appendChild(banner);
        return banner;
    }

    HF.wm_open_text_window = function wm_open_text_window(item, initial_data) {
        return HF.wm_open_memory_text_window(item);
    }

    HF.wm_open_image_window = function wm_open_image_window(item) {
        var stage = HF.Util.createElement('div', 'fm-window-media-stage');
        var error = HF.Util.createElement('div', 'fm-window-media-error', HF.labels.request_failed);
        var image = HF.Util.createElement('img', '');
        image.alt = item.name || '';
        stage.appendChild(error);
        stage.appendChild(image);
        var record = HF.window_manager.create({
            title: item.name || HF.tr('Image'),
            icon: item.icon_name || 'image',
            className: 'fm-window-media',
            content: stage,
            width: 900,
            height: 650,
            minWidth: 330,
            minHeight: 240,
            onClose: function() {
                image.onload = null;
                image.onerror = null;
                image.removeAttribute('src');
            }
        });
        image.onload = function() {
            error.style.display = 'none';
            image.style.display = 'block';
        };
        image.onerror = function() {
            image.style.display = 'none';
            error.textContent = HF.labels.request_failed;
            error.style.display = 'block';
        };
        image.src = HarborIO.inlineURL(item.path) + '&v=' + encodeURIComponent(item.mtime || 0);
        return record;
    }

    HF.wm_open_pdf_window = function wm_open_pdf_window(item) {
        var content = HF.wm_document_column();
        var stage = HF.Util.createElement('div', 'fm-window-pdf-stage');
        var error = HF.Util.createElement('div', 'fm-window-media-error', HF.labels.pdf_not_supported);
        var frame = HF.Util.createElement('iframe', '');
        frame.setAttribute('title', item.name || HF.labels.pdf_not_supported);
        stage.appendChild(error);
        stage.appendChild(frame);
        var meta = HF.Util.createElement('div', 'fm-window-media-meta');
        meta.appendChild(HF.Util.createElement('span', 'fm-window-media-path', item.path || '-'));
        meta.appendChild(HF.Util.createElement('span', '', item.display_size || HF.format_size(item.size || 0)));
        content.appendChild(stage);
        content.appendChild(meta);
        var record = HF.window_manager.create({
            title: item.name || HF.tr('PDF'),
            icon: item.icon_name || 'pdf',
            className: 'fm-window-pdf',
            content: content,
            width: 960,
            height: 700,
            minWidth: 360,
            minHeight: 300,
            onClose: function() {
                frame.onload = null;
                frame.onerror = null;
                frame.src = 'about:blank';
            }
        });
        frame.onload = function() {
            error.style.display = 'none';
        };
        frame.onerror = function() {
            error.style.display = 'block';
        };
        frame.src = HarborIO.inlineURL(item.path, 'application/pdf') + '&v=' + encodeURIComponent(item.mtime || 0);
        return record;
    }

    HF.wm_open_video_window = function wm_open_video_window(item) {
        var content = HF.wm_document_column();
        var stage = HF.Util.createElement('div', 'fm-window-video-stage');
        var error = HF.Util.createElement('div', 'fm-window-media-error', HF.labels.video_format_error);
        var video = HF.Util.createElement('video', '');
        video.controls = true;
        video.playsInline = true;
        video.preload = 'auto';
        stage.appendChild(error);
        stage.appendChild(video);
        var meta = HF.Util.createElement('div', 'fm-window-media-meta');
        var path = HF.Util.createElement('span', 'fm-window-media-path', item.path || '-');
        var buffer = HF.Util.createElement('span', '', HF.labels.buffered + ': 0%');
        var size = HF.Util.createElement('span', '', item.display_size || HF.format_size(item.size || 0));
        meta.appendChild(path);
        meta.appendChild(buffer);
        meta.appendChild(size);
        var hint = HF.Util.createElement('div', 'fm-window-video-hint', HF.labels.video_no_range);
        content.appendChild(stage);
        content.appendChild(meta);
        content.appendChild(hint);

        function update_buffer(waiting) {
            var duration = Number(video.duration || 0);
            var buffered_end = 0;
            if (video.buffered && video.buffered.length) {
                buffered_end = video.buffered.end(video.buffered.length - 1);
            }
            var percent = duration > 0 && isFinite(duration) ? Math.min(100, buffered_end / duration * 100) : 0;
            buffer.textContent = (waiting ? HF.labels.buffering : HF.labels.buffered) + ': ' + Math.round(percent) + '%';
        }

        var record = HF.window_manager.create({
            title: item.name || HF.tr('Video'),
            icon: item.icon_name || 'video',
            className: 'fm-window-video',
            content: content,
            width: 960,
            height: 650,
            minWidth: 360,
            minHeight: 280,
            onClose: function() {
                video.pause();
                video.onerror = null;
                video.onprogress = null;
                video.onloadedmetadata = null;
                video.onwaiting = null;
                video.removeAttribute('src');
                video.load();
            }
        });
        video.onerror = function() {
            var media_error = video.error;
            error.textContent = HF.labels.video_format_error + (media_error ? ' [code=' + media_error.code + ']' : '');
            error.style.display = 'block';
        };
        video.onprogress = function() { update_buffer(false); };
        video.onloadedmetadata = function() { update_buffer(false); };
        video.onloadeddata = function() { error.style.display = 'none'; };
        video.oncanplay = function() { update_buffer(false); };
        video.onwaiting = function() { update_buffer(true); };
        function start_playback() {
            if (record.closed) {
                return;
            }
            video.src = HarborIO.inlineURL(item.path) + '&v=' +
                encodeURIComponent(item.mtime || 0);
            video.load();
        }
        start_playback();
        return record;
    }

    HF.wm_open_binary_window = function wm_open_binary_window(item) {
        return HF.wm_open_memory_hex_window(item);
    }

    
    HF.wm_decode_utf8 = function wm_decode_utf8(bytes) {
        if (window.TextDecoder) {
            return new TextDecoder('utf-8').decode(bytes);
        }
        var binary = '';
        for (var index = 0; index < bytes.length; index++) {
            binary += String.fromCharCode(bytes[index]);
        }
        try { return decodeURIComponent(escape(binary)); } catch (error) { return binary; }
    }

    HF.wm_encode_utf8 = function wm_encode_utf8(text) {
        var value = String(text || '');
        if (window.TextEncoder) {
            return new TextEncoder().encode(value);
        }
        var encoded = unescape(encodeURIComponent(value));
        var bytes = new Uint8Array(encoded.length);
        for (var index = 0; index < encoded.length; index++) {
            bytes[index] = encoded.charCodeAt(index);
        }
        return bytes;
    }

    HF.wm_hex_offset = function wm_hex_offset(value) {
        return '0x' + ('00000000' + Math.max(0, Number(value || 0)).toString(16).toUpperCase()).slice(-8);
    }

    HF.wm_escape_regex = function wm_escape_regex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    HF.wm_animate_scroll = function wm_animate_scroll(element, left, top, duration) {
        var start_left = element.scrollLeft, start_top = element.scrollTop;
        var end_left = left === undefined ? start_left : Math.max(0, left);
        var end_top = top === undefined ? start_top : Math.max(0, top);
        if (Math.abs(start_left - end_left) < 1 && Math.abs(start_top - end_top) < 1) {
            return Promise.resolve();
        }
        return new Promise(function(resolve) {
            var started = null;
            function frame(now) {
                if (started === null) started = now;
                var progress = Math.min(1, (now - started) / (duration || 180));
                var eased = 1 - Math.pow(1 - progress, 3);
                element.scrollLeft = start_left + (end_left - start_left) * eased;
                element.scrollTop = start_top + (end_top - start_top) * eased;
                if (progress < 1) window.requestAnimationFrame(frame); else resolve();
            }
            window.requestAnimationFrame(frame);
        });
    }

    HF.wm_parse_hex_bytes = function wm_parse_hex_bytes(value) {
        var compact = String(value || '').replace(/\s+/g, '');
        if (!compact || compact.length % 2 || !/^[0-9a-f]+$/i.test(compact)) return null;
        var bytes = new Uint8Array(compact.length / 2);
        for (var index = 0; index < compact.length; index += 2) bytes[index / 2] = parseInt(compact.substr(index, 2), 16);
        return bytes;
    }

    HF.wm_reset_search_state = function wm_reset_search_state(model) {
        model.matches = [];
        model.current = -1;
        model.query = '';
        model.match_total = 0;
        model.match_base = 0;
    }

    HF.wm_first_intersecting_match = function wm_first_intersecting_match(matches, start_index) {
        var low = 0;
        var high = matches.length - 1;
        while (low <= high) {
            var middle = Math.floor((low + high) / 2);
            var match = matches[middle];
            if (match.index + match.length <= start_index) {
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return low;
    }

    HF.wm_match_at = function wm_match_at(matches, index) {
        var match_index = HF.wm_first_intersecting_match(matches, index);
        var match = matches[match_index];
        return match && index >= match.index && index < match.index + match.length ? match : null;
    }

    HF.wm_commit_search = function wm_commit_search(model, query, matches, direction) {
        var previous_query = model.query;
        var previous_current = model.current;
        model.matches = matches || [];
        model.query = query || '';
        if (!model.matches.length) {
            model.current = -1;
            return -1;
        }
        if (!direction) {
            model.current = -1;
            return -1;
        }
        model.current = previous_query === model.query && previous_current >= 0 ?
            (previous_current + (Number(direction) < 0 ? -1 : 1) + model.matches.length) % model.matches.length :
            (Number(direction) < 0 ? model.matches.length - 1 : 0);
        return model.current;
    }

    HF.wm_refresh_search_counter = function wm_refresh_search_counter(search, model) {
        var absolute = model.current < 0 ? -1 : (model.match_base || 0) + model.current;
        search.setStatus(absolute, model.match_total || model.matches.length);
    }

    HF.wm_read_editor_file = function wm_read_editor_file(item) {
        return HarborIO.readAll(item.path).then(function(buffer) {
            return {
                bytes: new Uint8Array(buffer),
                size: buffer.byteLength,
                mtime: Number(item.mtime || 0)
            };
        });
    }

    HF.wm_upload_editor_blob = function wm_upload_editor_blob(item, blob, progress) {
        return new Promise(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            var form = new FormData();
            form.append('content', blob, item.name || 'content.bin');
            xhr.open('POST', HF.api.save_editor_upload + '?path=' + encodeURIComponent(item.path), true);
            xhr.upload.onprogress = function(event) {
                if (event.lengthComputable && progress) {
                    progress(event.loaded, event.total);
                }
            };
            xhr.onload = function() {
                var response = null;
                try { response = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
                if (xhr.status >= 200 && xhr.status < 300 && response && response.code === 0) {
                    resolve(response.data || {});
                } else {
                    reject((response && response.message) || HF.labels.save_failed);
                }
            };
            xhr.onerror = function() { reject(HF.labels.save_failed); };
            xhr.send(form);
        });
    }

    HF.wm_create_upload_progress = function wm_create_upload_progress() {
        var node = HF.Util.createElement('div', 'fm-editor-upload-progress');
        var bar = HF.Util.createElement('span', '');
        node.appendChild(bar);
        return {
            node: node,
            set: function(loaded, total) {
                node.classList.add('show');
                bar.style.width = total > 0 ? Math.min(100, loaded * 100 / total) + '%' : '0%';
            },
            hide: function() {
                node.classList.remove('show');
                bar.style.width = '0';
            }
        };
    }

    HF.wm_create_memory_footer = function wm_create_memory_footer(session, on_save, on_close, on_cursor_click) {
        var footer = HF.Util.createElement('div', 'fm-window-doc-footer');
        var status = HF.Util.createElement('div', 'fm-paged-editor-status');
        var size = HF.Util.createElement('span', '', '-');
        var state_node = HF.Util.createElement('span', '', '-');
        var cursor_node = HF.Util.createElement('span', 'fm-window-doc-cursor', '');
        cursor_node.style.display = 'none';
        if (typeof on_cursor_click === 'function') {
            cursor_node.classList.add('is-clickable');
            cursor_node.title = HF.labels.line_numbers;
            cursor_node.addEventListener('click', on_cursor_click);
            cursor_node.style.display = '';
        }
        status.appendChild(size);
        status.appendChild(state_node);
        status.appendChild(cursor_node);
        var actions = HF.Util.createElement('div', 'fm-window-doc-actions');
        var close = HF.wm_window_action(HF.tr('Close'), false);
        var save = HF.wm_window_action(HF.tr('Save'), true);
        actions.appendChild(close);
        actions.appendChild(save);
        footer.appendChild(status);
        footer.appendChild(actions);
        close.addEventListener('click', on_close);
        save.addEventListener('click', on_save);
        return {
            element: footer,
            refresh: function() {
                size.textContent = HF.labels.text_size + ': ' + HF.format_size(session.size());
                state_node.textContent = session.saving ? HF.tr('Saving…') : (session.dirty ? HF.tr('Unsaved') : (session.readonly ? HF.tr('Read only') : HF.tr('Saved')));
                save.disabled = session.readonly || session.saving || !session.dirty;
                close.disabled = session.saving;
            },
            setCursor: function(line, column) {
                if (line === null || line === undefined || column === null || column === undefined) {
                    return; 
                }
                cursor_node.textContent = HF.labels.text_line + line + '/' + HF.labels.text_column + column;
                cursor_node.style.display = '';
            }
        };
    }

    HF.wm_create_search = function wm_create_search(record, content, options) {
        var shell = HF.Util.createElement('div', 'fm-editor-search-shell');
        var row = HF.Util.createElement('div', 'fm-editor-search-row');
        var input = HF.Util.createElement('input', 'fm-editor-search-input');
        input.type = 'search';
        input.placeholder = options.placeholder || HF.tr('Search');
        var count = HF.Util.createElement('span', 'fm-editor-search-count', '0/0');
        var previous = HF.Util.createElement('button', 'fm-editor-search-nav', '↑');
        var next = HF.Util.createElement('button', 'fm-editor-search-nav', '↓');
        var case_label = HF.Util.createElement('label', 'fm-editor-search-option');
        var case_box = HF.Util.createElement('input', '');
        case_box.type = 'checkbox';
        case_label.appendChild(case_box);
        case_label.appendChild(document.createTextNode(HF.tr('Match case')));
        [previous, next].forEach(function(button) { button.type = 'button'; });
        row.appendChild(input); row.appendChild(count); row.appendChild(previous); row.appendChild(next); row.appendChild(case_label);
        shell.appendChild(row);

        var replace_row = HF.Util.createElement('div', 'fm-editor-replace-row');
        var replacement = HF.Util.createElement('input', 'fm-editor-replace-input');
        replacement.type = 'text';
        replacement.placeholder = options.replacePlaceholder || HF.tr('Replace with');
        var replace_button = HF.Util.createElement('button', 'fm-editor-replace-action', HF.tr('Replace'));
        var replace_all_button = HF.Util.createElement('button', 'fm-editor-replace-action', HF.tr('Replace all'));
        replace_button.type = 'button';
        replace_all_button.type = 'button';
        var regex_box = null;
        replace_row.appendChild(replacement);
        replace_row.appendChild(replace_button);
        replace_row.appendChild(replace_all_button);
        var regex_label = HF.Util.createElement('label', 'fm-editor-search-option');
        regex_box = HF.Util.createElement('input', '');
        regex_box.type = 'checkbox';
        regex_label.appendChild(regex_box);
        regex_label.appendChild(document.createTextNode(HF.tr('Regular expression')));
        replace_row.appendChild(regex_label);
        if (options.offsetJump) {
            var jump_label = HF.Util.createElement('label', 'fm-editor-search-option');
            var jump_box = HF.Util.createElement('input', '');
            jump_box.type = 'checkbox';
            jump_label.appendChild(jump_box);
            jump_label.appendChild(document.createTextNode(HF.tr('Offset')));
            replace_row.appendChild(jump_label);
            regex_box.addEventListener('change', function () {
                if (regex_box.checked && jump_box.checked) jump_box.checked = false;
            });
            jump_box.addEventListener('change', function () {
                if (jump_box.checked && regex_box.checked) regex_box.checked = false;
                input.placeholder = jump_box.checked
                    ? (HF.tr('Offset, e.g. 0x1A2B or 6699'))
                    : (options.placeholder || HF.tr('Search'));
            });
            var jump_exec = function () {
                if (!jump_box.checked) return false;
                var v = String(input.value || '').trim();
                if (!v) return true;
                var n = (/^0x/i).test(v) ? parseInt(v, 16)
                    : (/^[0-9a-fA-F]+$/).test(v) ? parseInt(v, 16)
                    : parseInt(v, 10);
                if (n !== n) { HF.set_warning_status(HF.tr('Invalid offset')); return true; }
                options.offsetJump(n);
                return true;
            };
            jump_exec_guard = jump_exec;
            input.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' && jump_exec()) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
            (function () {
                var orig_next = null;
                [previous, next].forEach(function (b) {
                    var orig = b.onclick;
                });
            })();
            var prev_handler = function (e) { if (jump_exec()) { e.preventDefault(); e.stopPropagation(); } };
            // wrap the arrows: offset mode intercepts
            var orig_prev_click = previous.onclick;
            previous.addEventListener('click', prev_handler, true);
            next.addEventListener('click', prev_handler, true);
        }
        shell.appendChild(replace_row);
        content.insertBefore(shell, content.firstChild);

        var header = record.element.querySelector('.fm-window-titlebar');
        var controls = header && header.querySelector('.fm-window-controls');
        var search_button = HF.Util.createElement('button', 'fm-window-title-search');
        search_button.type = 'button';
        search_button.title = HF.tr('Search');
        if (header) header.insertBefore(search_button, controls || null);

        var timer = null;
        var jump_exec_guard = null;
        function execute(direction) {
            if (timer) clearTimeout(timer);
            timer = null;
            options.search(input.value, !!(regex_box && regex_box.checked), case_box.checked, direction || 0);
        }
        function replace_step(all) {
            if (!options.replaceStep) {
                return;
            }
            options.replaceStep(replacement.value, all, 1);
        }
        function schedule() {
            if (timer) clearTimeout(timer);
            timer = setTimeout(function() { execute(0); }, 160);
        }
        input.addEventListener('input', schedule);
        case_box.addEventListener('change', schedule);
        if (regex_box) regex_box.addEventListener('change', schedule);
        input.addEventListener('keydown', function(event) { if (event.key === 'Enter') { event.preventDefault(); if (!(options.offsetJump && jump_exec_guard && jump_exec_guard())) execute(1); } });
        previous.addEventListener('click', function() { execute(-1); });
        next.addEventListener('click', function() { execute(1); });
        replace_button.addEventListener('click', function() { replace_step(false); });
        replace_all_button.addEventListener('click', function() { replace_step(true); });
        function close_search() {
            if (timer) clearTimeout(timer);
            input.value = '';
            replacement.value = '';
            shell.classList.remove('show');
            search_button.classList.remove('is-open');
            options.clear();
        }
        search_button.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            var opening = !search_button.classList.contains('is-open');
            search_button.classList.toggle('is-open', opening);
            shell.classList.toggle('show', opening);
            if (opening) {
                setTimeout(function() { input.focus(); input.select(); }, 0);
            }
            else {
                close_search();
            }
        });
        return {
            setStatus: function(current, total) {
                count.textContent = total ? (current + 1) + '/' + total : '0/0';
                previous.disabled = !total;
                next.disabled = !total;
                replace_button.disabled = !total;
                replace_all_button.disabled = !total;
            }
        };
    }

    var GUTTER_MEASURE_BUDGET = 20000;

    function wm_is_wide_code(code) {
        return (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) ||
            (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
            (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) ||
            (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1f64f) ||
            (code >= 0x20000 && code <= 0x3fffd);
    }

    HF.wm_line_cells = function wm_line_cells(line, tab) {
        var col = 0;
        for (var i = 0; i < line.length; i++) {
            var code = line.charCodeAt(i);
            if (code === 9) {
                col += tab - (col % tab);
            } else if (code !== 10 && code !== 13) {
                col += wm_is_wide_code(code) ? 2 : 1;
            }
        }
        return col;
    }

    HF.wm_gutter_rows = function wm_gutter_rows(lines, capacity, cells_of, measure, budget) {
        var rows = new Array(lines.length);
        var i;
        var cells;
        var pending = [];
        if (!(budget > 0)) {
            budget = GUTTER_MEASURE_BUDGET;
        }
        for (i = 0; i < lines.length; i++) {
            rows[i] = 1;
        }
        if (capacity > 0) {
            for (i = 0; i < lines.length; i++) {
                cells = cells_of(lines[i]);
                if (cells <= capacity) {
                    continue;
                }
                if (pending.length < budget) {
                    pending.push(i);
                } else {
                    rows[i] = Math.max(1, Math.ceil(cells / capacity));
                }
            }
            if (pending.length) {
                measure(pending, rows);
            }
        }
        return rows;
    }

    HF.wm_open_memory_text_window = function wm_open_memory_text_window(item) {
        var session = {
            item: item,
            original: '',
            text: '',
            dirty: false,
            readonly: !HF.can_modify_system_path(item.path),
            saving: false,
            matches: [],
            current: -1,
            query: '',
            caseSensitive: false,
            eol: '\n',
            wrap: HF.state.preferences.editor_auto_wrap === 1,
            renderTimer: null
        };
        var history = HF.Util.createHistory(100);
        var content = HF.wm_document_column();
        var tip = HF.Util.createElement('div', 'fm-window-doc-tip');
        var text_shell = HF.Util.createElement('div', 'fm-memory-text-shell');
        if (HF.state.preferences.show_line_numbers === 1) {
            text_shell.classList.add('is-line-numbers-visible');
        }
        var gutter = HF.Util.createElement('pre', 'fm-memory-text-gutter');
        var editor = HF.Util.createElement('pre', 'fm-memory-contenteditable');
        editor.contentEditable = session.readonly ? 'false' : 'true';
        editor.spellcheck = false;
        if (session.readonly) {
            HF.set_warning_status(HF.labels.system_folder_blocked);
        }
        text_shell.appendChild(gutter);
        text_shell.appendChild(editor);
        if (session.wrap) {
            editor.classList.add('is-wrap');
        }
        var progress = HF.wm_create_upload_progress();
        content.appendChild(tip);
        content.appendChild(text_shell);
        content.appendChild(progress.node);

        function tip_text(message, type) {
            HF.wm_set_tip(tip, message || '', type || '');
        }

        function editor_text() {
            return (editor.innerText || '').replace(/\r/g, '');
        }

        function selection_offset() {
            var selection = window.getSelection && window.getSelection();
            if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) {
                return null;
            }
            var range = selection.getRangeAt(0).cloneRange();
            var before = document.createRange();
            before.selectNodeContents(editor);
            before.setEnd(range.startContainer, range.startOffset);
            return before.toString().length;
        }

        function restore_selection(offset) {
            if (offset === null || offset === undefined || document.activeElement !== editor) {
                return;
            }
            var walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
            var remaining = Math.max(0, offset);
            var node;
            while ((node = walker.nextNode())) {
                if (remaining <= node.nodeValue.length) {
                    var range = document.createRange();
                    range.setStart(node, remaining);
                    range.collapse(true);
                    var selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    return;
                }
                remaining -= node.nodeValue.length;
            }
        }

        var gutter_rows = [];
        var gutter_offsets = [];
        var gutter_total = 0;
        var gutter_line_h = 21;
        var gutter_pad_top = 0;
        var gutter_pad_bottom = 0;
        var gutter_mirror = null;
        var gutter_rendered_range = null;
        var gutter_tab_size = 4;
        var gutter_layout_waits = 0;

        function gutter_line_height() {
            var cs = window.getComputedStyle(editor);
            gutter_line_h = parseFloat(cs.lineHeight) || 21;
            gutter_pad_top = parseFloat(cs.paddingTop) || 0;
            gutter_pad_bottom = parseFloat(cs.paddingBottom) || 0;
            return gutter_line_h;
        }

        function gutter_capacity() {
            var cs = window.getComputedStyle(editor);
            var width = editor.clientWidth;
            var inner = width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
            if (!(width > 0) || !(inner > 0)) {
                return 0;
            }
            if (!gutter_mirror) {
                gutter_mirror = document.createElement('div');
                gutter_mirror.className = 'fm-memory-contenteditable is-wrap fm-memory-gutter-mirror';
                gutter_mirror.style.position = 'fixed';
                gutter_mirror.style.left = '-99999px';
                gutter_mirror.style.top = '0';
                gutter_mirror.style.visibility = 'hidden';
                gutter_mirror.style.pointerEvents = 'none';
                document.body.appendChild(gutter_mirror);
            }
            gutter_mirror.style.fontFamily = cs.fontFamily;
            gutter_mirror.style.fontSize = cs.fontSize;
            gutter_mirror.style.lineHeight = cs.lineHeight;
            gutter_mirror.style.tabSize = cs.tabSize;
            gutter_mirror.style.paddingLeft = cs.paddingLeft;
            gutter_mirror.style.paddingRight = cs.paddingRight;
            gutter_mirror.style.boxSizing = 'border-box';
            gutter_mirror.style.width = width + 'px';
            gutter_mirror.textContent = '';
            var probe = document.createElement('div');
            probe.textContent = '0000000000000000';
            gutter_mirror.appendChild(probe);
            var cell = probe.getBoundingClientRect().width / 16;
            var tab = parseFloat(cs.tabSize) || 4;
            if (!(cell > 0)) {
                gutter_mirror.textContent = '';
                return 0;
            }
            gutter_tab_size = tab;
            gutter_mirror.textContent = '';
            return Math.max(1, Math.floor((inner - 1) / cell));
        }

        function measure_rows(lines, pending, rows) {
            var mirror = gutter_mirror;
            for (var b = 0; b < pending.length; b += 512) {
                var last = Math.min(pending.length, b + 512);
                var frag = document.createDocumentFragment();
                var cells = [];
                var k;
                for (k = b; k < last; k++) {
                    var cell_node = document.createElement('div');
                    cell_node.textContent = lines[pending[k]] || ' ';
                    cells.push(cell_node);
                    frag.appendChild(cell_node);
                }
                mirror.appendChild(frag);
                for (k = 0; k < cells.length; k++) {
                    rows[pending[b + k]] = Math.max(1,
                        Math.round(cells[k].getBoundingClientRect().height / gutter_line_h));
                }
                mirror.textContent = '';
            }
        }

        function compute_gutter(text) {
            gutter_line_height();
            var lines = text.split('\n');
            var n = lines.length;
            var measuring = session.wrap && text_shell.classList.contains('is-line-numbers-visible');
            var capacity = 0;
            if (measuring) {
                capacity = gutter_capacity();
                if (capacity) {
                    gutter_layout_waits = 0;
                } else if (gutter_layout_waits < 20) {
                    gutter_layout_waits++;
                    schedule_gutter();
                }
            }
            var tab = gutter_tab_size;
            var rows = HF.wm_gutter_rows(lines, capacity, function (line) {
                return HF.wm_line_cells(line, tab);
            }, function (pending, out) {
                measure_rows(lines, pending, out);
            });
            gutter_rows = rows;
            var offsets = new Array(n);
            var acc = gutter_pad_top;
            for (var o = 0; o < n; o++) {
                offsets[o] = acc;
                acc += rows[o] * gutter_line_h;
            }
            gutter_offsets = offsets;
            gutter_total = acc + gutter_pad_bottom;
            gutter_rendered_range = null;
        }

        function render_gutter() {
            if (!gutter_offsets.length) { return; }
            var n = gutter_rows.length;
            var top = editor.scrollTop;
            var view_h = gutter.clientHeight || editor.clientHeight || 0;
            var lo = 0, hi = n - 1;
            while (lo <= hi) {
                var mid = (lo + hi) >> 1;
                if (gutter_offsets[mid] + gutter_rows[mid] * gutter_line_h <= top) {
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
            var first = Math.max(0, lo - 2);
            var end = first;
            while (end < n && gutter_offsets[end] < top + view_h) { end++; }
            end = Math.min(n, end + 2);
            var inner = gutter.firstChild;
            if (!inner || inner.className !== 'fm-memory-gutter-inner') {
                inner = document.createElement('div');
                inner.className = 'fm-memory-gutter-inner';
                gutter.appendChild(inner);
            }
            inner.style.transform = 'translateY(' + (-top) + 'px)';
            if (gutter_rendered_range && gutter_rendered_range[0] === first && gutter_rendered_range[1] === end) {
                return;
            }
            gutter_rendered_range = [first, end];
            inner.textContent = '';
            var frag = document.createDocumentFragment();
            var top_spacer = document.createElement('div');
            top_spacer.className = 'fm-memory-gutter-spacer';
            top_spacer.style.height = gutter_offsets[first] + 'px';
            frag.appendChild(top_spacer);
            for (var i = first; i < end; i++) {
                var line_div = document.createElement('div');
                line_div.className = 'fm-memory-gutter-line';
                var num = document.createElement('div');
                num.className = 'fm-memory-gutter-number';
                num.textContent = String(i + 1);
                line_div.appendChild(num);
                for (var r = 1; r < gutter_rows[i]; r++) {
                    var mark = document.createElement('div');
                    mark.className = 'fm-memory-gutter-wrap';
                    mark.textContent = '↲';
                    line_div.appendChild(mark);
                }
                frag.appendChild(line_div);
            }
            inner.appendChild(frag);
            var bottom_spacer = document.createElement('div');
            bottom_spacer.className = 'fm-memory-gutter-spacer';
            bottom_spacer.style.height = Math.max(0, gutter_total - (end < n ? gutter_offsets[end] : gutter_total)) + 'px';
            inner.appendChild(bottom_spacer);
        }

        function clear() {
            HF.wm_reset_search_state(session);
            HF.wm_refresh_search_counter(search, session);
            render_dom();
        }

        function find(query, case_sensitive) {
            if (!query) {
                return [];
            }
            var regexp = new RegExp(HF.wm_escape_regex(query), 'g' + (case_sensitive ? '' : 'i'));
            var matches = [];
            var match;
            while ((match = regexp.exec(session.text))) {
                matches.push({ index: match.index, length: match[0].length });
                if (!match[0].length) {
                    regexp.lastIndex++;
                }
            }
            return matches;
        }

        function render_dom(preserve_cursor) {
            var cursor = preserve_cursor ? selection_offset() : null;
            while (editor.firstChild) {
                editor.removeChild(editor.firstChild);
            }
            var text = session.text;
            compute_gutter(text);
            render_gutter();
            var position = 0;
            var match_index = 0;
            while (match_index < session.matches.length) {
                var match = session.matches[match_index];
                if (match.index > position) {
                    editor.appendChild(document.createTextNode(text.slice(position, match.index)));
                }
                var end = match.index + match.length;
                if (end > match.index) {
                    var mark = HF.Util.createElement('span', 'fm-memory-text-match' + (match_index === session.current ? ' is-current' : ''));
                    mark.setAttribute('data-match-index', String(match_index));
                    mark.textContent = text.slice(match.index, end);
                    editor.appendChild(mark);
                }
                position = Math.max(position, end);
                match_index++;
            }
            if (position < text.length) {
                editor.appendChild(document.createTextNode(text.slice(position)));
            }
            if (!editor.firstChild) {
                editor.textContent = '\u200b';
            }
            restore_selection(cursor);
        }

        function navigate(index) {
            if (!session.matches.length) {
                clear();
                return;
            }
            session.current = (index + session.matches.length) % session.matches.length;
            HF.wm_refresh_search_counter(search, session);
            render_dom(false);
            var mark = editor.querySelector('[data-match-index="' + session.current + '"]');
            if (mark) {
                var editor_rect = editor.getBoundingClientRect();
                var mark_rect = mark.getBoundingClientRect();
                var top = Math.max(0, editor.scrollTop + mark_rect.top - editor_rect.top - editor.clientHeight * 0.4);
                var left = Math.max(0, editor.scrollLeft + mark_rect.left - editor_rect.left - editor.clientWidth * 0.35);
                HF.wm_animate_scroll(editor, left, top, 210);
            }
        }

        function search_text(query, regex, case_sensitive, direction) {
            session.caseSensitive = !!case_sensitive;
            var current = HF.wm_commit_search(session, query, find(query, session.caseSensitive), direction);
            if (current >= 0) {
                navigate(current);
            } else {
                HF.wm_refresh_search_counter(search, session);
                render_dom(document.activeElement === editor);
            }
        }

        function save() {
            if (session.readonly || session.saving || !session.dirty) {
                return;
            }
            session.saving = true;
            footer.refresh();
            var value = session.eol === '\r\n' ? session.text.replace(/\n/g, '\r\n') : session.text;
            var bytes = HF.wm_encode_utf8(value);
            HF.wm_upload_editor_blob(item, new Blob([bytes], { type: 'application/octet-stream' }), function(loaded, total) {
                progress.set(loaded, total);
            }).then(function(data) {
                session.saving = false;
                session.original = session.text;
                session.dirty = false;
                HF.Recovery.clearBuffer(item.path);
                history_buttons.refresh(history.canUndo(), history.canRedo());
                progress.hide();
                item.size = Number(data.size || bytes.length);
                item.mtime = Number(data.mtime || item.mtime || 0);
                item.display_size = HF.format_size(item.size);
                item.display_mtime = HF.format_time(item.mtime);
                tip_text('');
                footer.refresh();
            }).catch(function(error) {
                session.saving = false;
                progress.hide();
                footer.refresh();
                tip_text(error || HF.labels.save_failed, 'error');
            });
        }

        var record = HF.window_manager.create({
            title: item.path || item.name,
            icon: item.icon_name || 'text',
            className: 'fm-window-text-document',
            content: content,
            width: 820,
            height: 590,
            minWidth: 390,
            minHeight: 270,
            applyWrap: function(on) {
                session.wrap = !!on;
                editor.classList.toggle('is-wrap', session.wrap);
                compute_gutter(session.text);
                render_gutter();
            },
            beforeClose: function() {
                if (session.saving) { return false; }
                if (!session.dirty) { return true; }
                return HF.confirm_window({
                    title: HF.tr('Close'),
                    message: HF.labels.discard_text_changes
                });
            },
            onClose: function() { HF.Recovery.clearBuffer(item.path); window.removeEventListener('resize', on_window_resize); document.removeEventListener('selectionchange', update_cursor); }
        });
        var footer = HF.wm_create_memory_footer({
            size: function() { return HF.wm_encode_utf8(session.text).length; },
            get saving() { return session.saving; },
            get dirty() { return session.dirty; },
            get readonly() { return session.readonly; }
        }, save, function() { HF.window_manager.close(record); }, function() {
            var show = text_shell.classList.toggle('is-line-numbers-visible');
            if (show) {
                compute_gutter(session.text);
                render_gutter();
            }
            HF.save_show_line_numbers(show ? 1 : 0);
        });
        content.appendChild(footer.element);

        var history_buttons = HF.wm_add_history_buttons(record, undo_edit, redo_edit);
        var last_cursor = null;

        function cursor_position() {
            var offset = selection_offset();
            if (offset === null) {
                return null;
            }
            var text = session.text;
            var line = 1;
            for (var ci = 0; ci < offset; ci++) {
                if (text.charCodeAt(ci) === 10) {
                    line++;
                }
            }
            var line_start = offset;
            while (line_start > 0 && text.charCodeAt(line_start - 1) !== 10) {
                line_start--;
            }
            return { line: line, column: offset - line_start + 1 };
        }

        function update_cursor() {
            var pos = cursor_position();
            if (pos) {
                footer.setCursor(pos.line, pos.column);
            }
            var off = selection_offset();
            if (off !== null) {
                last_cursor = off;
            }
        }

        function recovery_save() {
            if (session.dirty) {
                HF.Recovery.saveBuffer('text', item.path, {
                    text: session.text,
                    cursor: selection_offset(),
                    scrollTop: editor.scrollTop,
                    scrollLeft: editor.scrollLeft
                });
            } else {
                HF.Recovery.clearBuffer(item.path);
            }
        }

        function edit_state() {
            return {
                text: session.text,
                cursor: selection_offset(),
                scrollTop: editor.scrollTop,
                scrollLeft: editor.scrollLeft
            };
        }

        function apply_edit_state(state) {
            session.text = state.text;
            session.dirty = state.text !== session.original;
            if (session.query) {
                search_text(session.query, false, session.caseSensitive, 0);
            } else {
                render_dom(false);
            }
            editor.scrollTop = Number(state.scrollTop) || 0;
            editor.scrollLeft = Number(state.scrollLeft) || 0;
            if (typeof state.cursor === 'number') {
                editor.focus();
                restore_selection(state.cursor);
                update_cursor();
            }
            footer.refresh();
            history_buttons.refresh(history.canUndo(), history.canRedo());
            recovery_save();
        }

        function undo_edit() {
            var prev = history.undo(edit_state());
            if (prev === null) {
                return;
            }
            apply_edit_state(prev);
        }

        function redo_edit() {
            var next = history.redo(edit_state());
            if (next === null) {
                return;
            }
            apply_edit_state(next);
        }

        history_buttons.refresh(history.canUndo(), history.canRedo());

        var search = HF.wm_create_search(record, content, {
            placeholder: HF.tr('Search text'),
            replacePlaceholder: HF.tr('Replace with'),
            hex: false,
            clear: clear,
            search: search_text,
            replaceStep: function(value, all, direction) {
                if (!session.matches.length) {
                    return;
                }
                var current = session.current >= 0 ? session.current : (direction < 0 ? session.matches.length - 1 : 0);
                var list = all ? session.matches.slice() : [session.matches[current]];
                list.sort(function(a, b) { return a.index - b.index; });
                var text = session.text;
                var shift = 0;
                history.capture(edit_state());
                list.forEach(function(match) {
                    var index = match.index + shift;
                    text = text.slice(0, index) + value + text.slice(index + match.length);
                    shift += value.length - match.length;
                });
                session.text = text;
                session.dirty = true;
                HF.wm_commit_search(session, session.query, find(session.query, session.caseSensitive), 0);
                if (session.matches.length) {
                    session.current = all ? 0 : (direction < 0 ? (current - 1 + session.matches.length) % session.matches.length : current % session.matches.length);
                    navigate(session.current);
                } else {
                    HF.wm_refresh_search_counter(search, session);
                    render_dom(false);
                }
                footer.refresh();
                history_buttons.refresh(history.canUndo(), history.canRedo());
                recovery_save();
            }
        });
        document.addEventListener('selectionchange', update_cursor);
        editor.addEventListener('click', update_cursor);
        editor.addEventListener('keydown', function() {
            var off = selection_offset();
            if (off !== null) { last_cursor = off; }
        });
        editor.addEventListener('keyup', update_cursor);
        editor.addEventListener('blur', update_cursor);

        var gutter_raf = null;
        editor.addEventListener('scroll', function() {
            if (gutter_raf) { return; }
            var raf = window.requestAnimationFrame || function(fn) { setTimeout(fn, 16); };
            gutter_raf = raf(function() {
                gutter_raf = null;
                render_gutter();
            });
        });
        var on_window_resize = function() { schedule_gutter(); };
        window.addEventListener('resize', on_window_resize);

        var gutter_timer = null;
        function schedule_gutter() {
            if (gutter_timer) {
                clearTimeout(gutter_timer);
            }
            gutter_timer = setTimeout(function() {
                gutter_timer = null;
                compute_gutter(session.text);
                render_gutter();
            }, 160);
        }

        editor.addEventListener('input', function() {
            var next = editor_text();
            if (next === session.text) {
                return;
            }
            history.capture({
                text: session.text,
                cursor: last_cursor,
                scrollTop: editor.scrollTop,
                scrollLeft: editor.scrollLeft
            });
            session.text = next;
            session.dirty = next !== session.original;
            if (session.query) {
                search_text(session.query, false, session.caseSensitive, 0);
            }
            schedule_gutter();
            footer.refresh();
            history_buttons.refresh(history.canUndo(), history.canRedo());
            recovery_save();
        });

        var profile = HF.state.preferences.editor_auto_indent === 1 ?
            HF.wm_indent_profile_for(item.path, session.text) : null;
        var unit = profile ? HF.wm_indent_unit(session.text) : '    ';
        editor.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && !event.shiftKey && profile && !session.readonly) {
                event.preventDefault();
                var offset = selection_offset();
                var before = offset === null ? session.text : session.text.slice(0, offset);
                var line_start = before.lastIndexOf('\n') + 1;
                var current_line = before.slice(line_start);
                var indent = (current_line.match(/^[ \t]*/) || [''])[0];
                var masked = HF.wm_mask_line(current_line, profile);
                var step = 0;
                if (profile.open && profile.open.test(masked)) step = 1;
                else if (HF.wm_line_delta(masked) > 0) step = 1;
                else if (profile.cont && profile.cont.test(masked)) step = 1;
                document.execCommand('insertText', false, '\n' + indent + (step ? unit : ''));
            }
            else if (profile && profile.close && !session.readonly &&
                    (event.key === '}' || event.key === ')' || event.key === ']')) {
                var pos = selection_offset();
                if (pos !== null) {
                    var b = session.text.slice(0, pos);
                    var seg = b.slice(b.lastIndexOf('\n') + 1);
                    if (/^[ \t]+$/.test(seg) && seg.length >= unit.length &&
                            seg.slice(-unit.length) === unit) {
                        event.preventDefault();
                        for (var d = 0; d < unit.length; d++) document.execCommand('delete');
                        document.execCommand('insertText', false, event.key);
                    }
                }
            }
        });

        content.addEventListener('keydown', function(event) {
            var mod = event.ctrlKey || event.metaKey;
            if (!mod) {
                return;
            }
            var key = (event.key || '').toLowerCase();
            if (key === 'z') {
                event.preventDefault();
                if (event.shiftKey) {
                    redo_edit();
                } else {
                    undo_edit();
                }
            } else if (key === 'y') {
                event.preventDefault();
                redo_edit();
            }
        });

        function start_load() {
            tip_text(HF.tr('Reading full file…'));
            HF.wm_read_editor_file(item).then(function(data) {
                var raw = HF.wm_decode_utf8(data.bytes);
                session.eol = raw.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
                session.original = raw.replace(/\r\n/g, '\n');
                session.text = session.original;
                last_cursor = 0;
                render_dom(false);
                footer.refresh();
                footer.setCursor(1, 1);
                history_buttons.refresh(history.canUndo(), history.canRedo());
                tip_text('');
            }).catch(function(error) { tip_text(error || HF.labels.request_failed, 'error'); });
        }

        if (HF.Recovery.hasBuffer(item.path) === 'text') {
            HF.wm_create_recover_banner(content, function() {
                var rec = HF.Recovery.getBuffer(item.path);
                var recovered = rec && rec.payload && typeof rec.payload.text === 'string' ? rec.payload.text : '';
                HF.wm_read_editor_file(item).then(function(data) {
                    var raw = HF.wm_decode_utf8(data.bytes);
                    session.eol = raw.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
                    session.original = raw.replace(/\r\n/g, '\n');
                    session.text = recovered;
                    session.dirty = session.text !== session.original;
                    render_dom(false);
                    var payload = rec && rec.payload || {};
                    if (typeof payload.cursor === 'number') {
                        editor.focus();
                        restore_selection(payload.cursor);
                        update_cursor();
                    }
                    editor.scrollTop = Number(payload.scrollTop) || 0;
                    editor.scrollLeft = Number(payload.scrollLeft) || 0;
                    footer.refresh();
                    history_buttons.refresh(history.canUndo(), history.canRedo());
                    recovery_save();
                    tip_text('');
                }).catch(function() {
                    session.text = recovered;
                    session.original = '';
                    session.dirty = true;
                    render_dom(false);
                    var payload = rec && rec.payload || {};
                    if (typeof payload.cursor === 'number') {
                        editor.focus();
                        restore_selection(payload.cursor);
                        update_cursor();
                    }
                    editor.scrollTop = Number(payload.scrollTop) || 0;
                    editor.scrollLeft = Number(payload.scrollLeft) || 0;
                    footer.refresh();
                    history_buttons.refresh(history.canUndo(), history.canRedo());
                    recovery_save();
                    tip_text('');
                });
            }, function() {
                HF.Recovery.clearBuffer(item.path);
                start_load();
            });
        } else {
            start_load();
        }
        return record;
    }

    HF.wm_open_memory_hex_window = function wm_open_memory_hex_window(item) {
        var session = { item: item, source: new HarborByteSource(item.path, Math.max(0, Number(item.size || 0))), stage: null, dirty: false, readonly: !HF.can_modify_system_path(item.path), saving: false, matches: [], current: -1, query: '', caseSensitive: false, selected: -1, nibble: false, pane: 'hex', rowHeight: 26, renderTimer: null };
        function total() { return session.source.total; }
        function current_src() { return session.stage ?? item.path; }
        function stage_of() { return item.path + '.harbor-stage'; }
        function refresh_history() {
            history_buttons.refresh(
                (session.server_undo && session.server_undo.length) || history.canUndo(),
                (session.server_redo && session.server_redo.length) || history.canRedo()
            );
        }
        function bget(offset) { var v = session.source.get(offset, 1); return v.length ? v[0] : 0; }
        function bset(offset, value) { session.source.setByte(offset, value & 0xFF); }
        var history = HF.Util.createHistory(100, 0); 
        var content = HF.wm_document_column();
        var tip = HF.Util.createElement('div', 'fm-window-binary-tip');
        if (session.readonly) {
            HF.set_warning_status(HF.labels.system_folder_blocked);
        }
        var scroll = HF.Util.createElement('div', 'fm-memory-hex-scroll');
        var table = document.createElement('table');
        table.className = 'fm-memory-hex-table';
        var colgroup = document.createElement('colgroup');
        var offset_col = document.createElement('col'); offset_col.className = 'fm-memory-hex-col-offset'; colgroup.appendChild(offset_col);
        for (var col_index = 0; col_index < 16; col_index++) { var col = document.createElement('col'); col.className = 'fm-memory-hex-col-byte'; colgroup.appendChild(col); }
        var gap_col = document.createElement('col'); gap_col.className = 'fm-memory-hex-col-gap'; colgroup.appendChild(gap_col);
        var ascii_col = document.createElement('col'); ascii_col.className = 'fm-memory-hex-col-ascii'; colgroup.appendChild(ascii_col);
        table.appendChild(colgroup);
        var thead = document.createElement('thead');
        var header_row = document.createElement('tr');
        var offset_head = document.createElement('th'); offset_head.textContent = 'Offset (hex)'; header_row.appendChild(offset_head);
        for (var header_index = 0; header_index < 16; header_index++) { var head = document.createElement('th'); head.textContent = ('0' + header_index.toString(16)).slice(-2).toUpperCase(); header_row.appendChild(head); }
        var gap_head = document.createElement('th'); gap_head.className = 'fm-memory-hex-table-gap'; header_row.appendChild(gap_head);
        var ascii_head = document.createElement('th'); ascii_head.textContent = HF.tr('ASCII'); header_row.appendChild(ascii_head);
        thead.appendChild(header_row); table.appendChild(thead);
        var tbody = document.createElement('tbody'); table.appendChild(tbody);
        scroll.appendChild(table);
        var progress = HF.wm_create_upload_progress();
        content.appendChild(tip); content.appendChild(scroll); content.appendChild(progress.node);

        var ime_input = HF.Util.createElement('input', 'fm-hex-ime-input');
        ime_input.type = 'text';
        ime_input.tabIndex = -1;
        ime_input.setAttribute('inputmode', 'text');
        ime_input.setAttribute('autocomplete', 'off');
        ime_input.setAttribute('autocapitalize', 'off');
        ime_input.setAttribute('autocorrect', 'off');
        ime_input.setAttribute('spellcheck', 'false');
        ime_input.setAttribute('aria-hidden', 'true');
        content.appendChild(ime_input);

        function ime_prepare() {
            ime_input.value = ' ';
            if (ime_input.setSelectionRange) {
                try { ime_input.setSelectionRange(1, 1); } catch (error) {}
            }
        }
        function ime_focus(event) {
            ime_input.style.left = (event && event.clientX != null ? event.clientX : 0) + 'px';
            ime_input.style.top = (event && event.clientY != null ? event.clientY : 0) + 'px';
            ime_prepare();
            ime_input.focus();
        }
        ime_input.addEventListener('input', function() {
            if (session.readonly) { ime_prepare(); return; }
            var value = ime_input.value;
            var offset = session.selected;
            if (offset < 0 || offset >= total()) { ime_prepare(); return; }
            var pane = session.pane || 'hex';
            if (value.length > 1) {
                var ch = value.charAt(value.length - 1);
                if (pane === 'hex') {
                    if (/^[0-9a-fA-F]$/.test(ch)) {
                        var digit = parseInt(ch, 16);
                        if (!session.nibble) {
                            capture_change();
                            bset(offset, digit << 4);
                            session.nibble = true;
                        } else {
                            bset(offset, (bget(offset) & 0xF0) | digit);
                            session.nibble = false;
                        }
                        refresh_dirty();
                        sync_pair(offset);
                        refresh();
                        history_buttons.refresh(history.canUndo(), history.canRedo());
                        recovery_save();
                        if (!session.nibble) { move_selection(1); }
                    }
                } else {
                    capture_change();
                    bset(offset, ch.charCodeAt(0) & 255);
                    refresh_dirty();
                    sync_pair(offset);
                    refresh();
                    history_buttons.refresh(history.canUndo(), history.canRedo());
                    recovery_save();
                    move_selection(1);
                }
            } else if (value.length === 0) {
                capture_change();
                bset(offset, 0);
                session.nibble = false;
                refresh_dirty();
                sync_pair(offset);
                refresh();
                history_buttons.refresh(history.canUndo(), history.canRedo());
                recovery_save();
                move_selection(-1);
            }
            ime_prepare();
        });

        function tip_text(message) { tip.textContent = message || ''; tip.style.display = message ? 'block' : 'none'; }
        function range_at(offset) { return HF.wm_match_at(session.matches, offset); }
        function refresh() { footer.refresh(); }
        function refresh_dirty() {
            session.dirty = session.source.dirtyCount() > 0 || !!session.stage;
        }
        var recovery_timer = null;
        function recovery_save() {
            if (recovery_timer) {
                clearTimeout(recovery_timer);
            }
            recovery_timer = setTimeout(function () {
                recovery_timer = null;
                if (session.dirty && total() > 0 && total() <= 4 * 1024 * 1024) {
                    HF.Recovery.saveBuffer('hex', item.path, {
                        bytes: HF.Recovery.bytesToBase64(session.source.get(0, total())),
                        selected: session.selected,
                        scrollTop: scroll.scrollTop,
                        scrollLeft: scroll.scrollLeft
                    });
                } else if (!session.dirty) {
                    HF.Recovery.clearBuffer(item.path);
                }
            }, 600);
        }

        function edit_state() {
            return {
                overlay: new Map(session.source.overlay),
                selected: session.selected,
                scrollTop: scroll.scrollTop,
                scrollLeft: scroll.scrollLeft
            };
        }
        function apply_edit_state(state) {
            session.source.overlay = new Map(state.overlay ?? []);
            if (typeof state.selected === 'number') {
                session.selected = state.selected;
                session.nibble = false;
            }
            refresh_dirty();
            paint();
            scroll.scrollTop = Number(state.scrollTop) || 0;
            scroll.scrollLeft = Number(state.scrollLeft) || 0;
            refresh();
            history_buttons.refresh(history.canUndo(), history.canRedo());
            recovery_save();
        }
        function capture_change() {
            history.capture(edit_state());
        }
        // every local edit re-syncs the combined history availability
        var raw_refresh_history = null;
        function update_cursor_hex() {
            if (session.selected < 0) {
                footer.setCursor(null, null);
                return;
            }
            var line = Math.floor(session.selected / 16) + 1;
            var column = (session.selected % 16) + 1;
            footer.setCursor(line, column);
        }
        function select(index) {
            session.selected = index;
            session.nibble = false;
            update_cursor_hex();
            var fields = tbody.querySelectorAll('[data-offset]');
            for (var field_index = 0; field_index < fields.length; field_index++) {
                var field_offset = Number(fields[field_index].getAttribute('data-offset'));
                fields[field_index].classList.toggle('is-selected', field_offset === index);
                fields[field_index].classList.toggle('is-search-current', field_offset !== index && !!range_at(field_offset));
            }
        }
        function sync_pair(offset) {
            var fields = tbody.querySelectorAll('[data-offset="' + offset + '"]');
            for (var field_index = 0; field_index < fields.length; field_index++) {
                if (fields[field_index].classList.contains('fm-memory-hex-cell')) fields[field_index].textContent = hex_char(offset);
                else if (fields[field_index].classList.contains('fm-memory-ascii-cell')) fields[field_index].textContent = ascii_char(offset);
            }
        }
        function ascii_char(offset) {
            var code = bget(offset);
            return code >= 32 && code <= 126 ? String.fromCharCode(code) : '·';
        }
        function hex_char(offset) {
            return ('0' + bget(offset).toString(16)).slice(-2).toUpperCase();
        }
        function focus_cell(index) {
            var cls = session.pane === 'ascii' ? '.fm-memory-ascii-cell' : '.fm-memory-hex-cell';
            var cell = scroll.querySelector(cls + '[data-offset="' + index + '"]');
            if (cell) { cell.focus(); }
        }
        function reveal_offset(index) {
            var row = Math.floor(index / 16);
            var top = 28 + row * session.rowHeight;
            var bottom = top + session.rowHeight;
            if (top < scroll.scrollTop || bottom > scroll.scrollTop + scroll.clientHeight) {
                var target = top < scroll.scrollTop ? top : bottom - scroll.clientHeight;
                HF.wm_animate_scroll(scroll, scroll.scrollLeft, Math.max(0, target), 120).then(function() {
                    paint();
                    if (!('ontouchstart' in window)) { focus_cell(session.selected); }
                });
            }
        }
        function jump_to(offset) {
            if (!(offset >= 0) || offset >= total()) {
                HF.set_warning_status(HF.tr('Invalid offset'));
                return;
            }
            if (HF.state.notice_record && !HF.state.notice_record.closed) HF.window_manager.close(HF.state.notice_record);
            select(offset);
            reveal_offset(offset);
            session.source.ensure(offset, 256).then(function () { paint(); });
            if (!('ontouchstart' in window)) { focus_cell(offset); }
        }

        function move_selection(delta) {
            var next = session.selected + delta;
            if (next < 0 || next >= total()) return;
            select(next);
            reveal_offset(next);
            if (!('ontouchstart' in window)) { focus_cell(next); }
        }
        function handle_ascii_key(event) {
            if (session.readonly) return;
            var key = event.key;
            var offset = session.selected;
            if (offset < 0 || offset >= total()) return;
            if (key && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                capture_change();
                bset(offset, key.charCodeAt(0) & 255);
                refresh_dirty();
                sync_pair(offset);
                refresh();
                history_buttons.refresh(history.canUndo(), history.canRedo());
                recovery_save();
                move_selection(1);
            } else if (key === 'Backspace') {
                event.preventDefault();
                capture_change();
                bset(offset, 0);
                refresh_dirty();
                sync_pair(offset);
                refresh();
                history_buttons.refresh(history.canUndo(), history.canRedo());
                recovery_save();
                move_selection(-1);
            } else if (key === 'Delete') {
                event.preventDefault();
                capture_change();
                bset(offset, 0);
                refresh_dirty();
                sync_pair(offset);
                refresh();
                history_buttons.refresh(history.canUndo(), history.canRedo());
                recovery_save();
            } else if (key === 'ArrowLeft') {
                event.preventDefault();
                move_selection(-1);
            } else if (key === 'ArrowRight') {
                event.preventDefault();
                move_selection(1);
            } else if (key === 'ArrowUp') {
                event.preventDefault();
                var up = offset - 16;
                if (up >= 0) { select(up); reveal_offset(up); if (!('ontouchstart' in window)) focus_cell(up); }
            } else if (key === 'ArrowDown') {
                event.preventDefault();
                var down = offset + 16;
                if (down < total()) { select(down); reveal_offset(down); if (!('ontouchstart' in window)) focus_cell(down); }
            }
        }
        function handle_hex_key(event) {
            if (session.readonly) return;
            var key = event.key;
            var offset = session.selected;
            if (offset < 0 || offset >= total()) return;
            if (/^[0-9a-fA-F]$/.test(key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                var digit = parseInt(key, 16);
                if (!session.nibble) {
                    capture_change();
                    bset(offset, digit << 4);
                    session.nibble = true;
                } else {
                    bset(offset, (bget(offset) & 0xF0) | digit);
                    session.nibble = false;
                }
                refresh_dirty();
                sync_pair(offset);
                refresh();
                history_buttons.refresh(history.canUndo(), history.canRedo());
                recovery_save();
                if (!session.nibble) { move_selection(1); }
            } else if (key === 'Backspace') {
                event.preventDefault();
                capture_change();
                bset(offset, 0);
                session.nibble = false;
                refresh_dirty();
                sync_pair(offset);
                refresh();
                history_buttons.refresh(history.canUndo(), history.canRedo());
                recovery_save();
                move_selection(-1);
            } else if (key === 'Delete') {
                event.preventDefault();
                capture_change();
                bset(offset, 0);
                session.nibble = false;
                refresh_dirty();
                sync_pair(offset);
                refresh();
                history_buttons.refresh(history.canUndo(), history.canRedo());
                recovery_save();
            } else if (key === 'ArrowLeft') {
                event.preventDefault();
                move_selection(-1);
            } else if (key === 'ArrowRight') {
                event.preventDefault();
                move_selection(1);
            } else if (key === 'ArrowUp') {
                event.preventDefault();
                var up = offset - 16;
                if (up >= 0) { select(up); reveal_offset(up); if (!('ontouchstart' in window)) focus_cell(up); }
            } else if (key === 'ArrowDown') {
                event.preventDefault();
                var down = offset + 16;
                if (down < total()) { select(down); reveal_offset(down); if (!('ontouchstart' in window)) focus_cell(down); }
            }
        }
        scroll.addEventListener('keydown', function(event) {
            var target = event.target;
            if (target && target.closest) {
                if (target.closest('.fm-memory-hex-cell')) {
                    handle_hex_key(event);
                } else if (target.closest('.fm-memory-ascii-cell')) {
                    handle_ascii_key(event);
                }
            }
        });
        function spacer(height) {
            var row = document.createElement('tr'); row.className = 'fm-memory-hex-table-spacer';
            var cell = document.createElement('td'); cell.colSpan = 19; cell.style.height = Math.max(0, height) + 'px'; row.appendChild(cell); return row;
        }
        function paint() {
            var rows = Math.ceil(total() / 16);
            var header_height = 28;
            var start = Math.max(0, Math.floor(Math.max(0, scroll.scrollTop - header_height) / session.rowHeight) - 3);
            var visible = Math.max(20, Math.ceil(scroll.clientHeight / session.rowHeight) + 6);
            var end = Math.min(rows, start + visible);
            while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
            tbody.appendChild(spacer(start * session.rowHeight));
            for (var row_index = start; row_index < end; row_index++) {
                var row = document.createElement('tr');
                var base = row_index * 16;
                var offset = document.createElement('td'); offset.className = 'fm-memory-hex-table-offset'; offset.textContent = HF.wm_hex_offset(base); row.appendChild(offset);
                for (var column = 0; column < 16; column++) {
                    (function(byte_offset) {
                        var td = document.createElement('td');
                        var hex_cell = HF.Util.createElement('span', 'fm-memory-hex-cell');
                        hex_cell.setAttribute('data-offset', String(byte_offset));
                        hex_cell.tabIndex = 0;
                        if (byte_offset >= total()) {
                            hex_cell.classList.add('is-disabled');
                            hex_cell.textContent = '';
                        } else {
                            hex_cell.textContent = hex_char(byte_offset);
                            if (byte_offset === session.selected) hex_cell.classList.add('is-selected'); else if (range_at(byte_offset)) hex_cell.classList.add('is-search-current');
                            hex_cell.addEventListener('click', function(event) {
                                select(byte_offset);
                                if ('ontouchstart' in window) {
                                    session.pane = 'hex';
                                    ime_focus(event);
                                } else {
                                    hex_cell.focus();
                                }
                            });
                        }
                        td.appendChild(hex_cell); row.appendChild(td);
                    })(base + column);
                }
                var gap = document.createElement('td'); gap.className = 'fm-memory-hex-table-gap'; row.appendChild(gap);
                var ascii_cell = document.createElement('td');
                var ascii = HF.Util.createElement('div', 'fm-memory-ascii-grid');
                for (var ascii_index = 0; ascii_index < 16; ascii_index++) {
                    (function(byte_offset) {
                        var cell = HF.Util.createElement('span', 'fm-memory-ascii-cell');
                        cell.setAttribute('data-offset', String(byte_offset));
                        cell.tabIndex = 0;
                        if (byte_offset >= total()) {
                            cell.classList.add('is-disabled');
                            cell.textContent = '';
                        } else {
                            cell.textContent = ascii_char(byte_offset);
                            if (byte_offset === session.selected) cell.classList.add('is-selected'); else if (range_at(byte_offset)) cell.classList.add('is-search-current');
                            cell.addEventListener('click', function(event) {
                                select(byte_offset);
                                if ('ontouchstart' in window) {
                                    session.pane = 'ascii';
                                    ime_focus(event);
                                } else {
                                    cell.focus();
                                }
                            });
                        }
                        ascii.appendChild(cell);
                    })(base + ascii_index);
                }
                ascii_cell.appendChild(ascii); row.appendChild(ascii_cell); tbody.appendChild(row);
            }
            tbody.appendChild(spacer((rows - end) * session.rowHeight + 40));
            if (pages_missing(start * 16, Math.max(1, (end - start) * 16))) {
                session.source.ensure(start * 16, Math.max(1, (end - start) * 16)).then(function() { paint(); });
            }
        }
        function pages_missing(from, length) {
            var end = Math.min(from + length, total());
            if (from >= end) { return false; }
            for (var page = Math.floor(from / 65536); page <= Math.floor((end - 1) / 65536); page++) {
                if (!session.source.pages.get(page)) { return true; }
            }
            return false;
        }
        function schedulePaint() { if (!session.renderTimer) session.renderTimer = setTimeout(function() { session.renderTimer = null; paint(); }, 16); }
        function clear() { HF.wm_reset_search_state(session); HF.wm_refresh_search_counter(search, session); paint(); if (HF.state.notice_record && !HF.state.notice_record.closed) HF.window_manager.close(HF.state.notice_record); }
        var search_next_cursor = null;
        function navigate(index) {
            if (!session.matches.length) return clear();
            var at_end = index >= session.matches.length;
            if (at_end && search_next_cursor) {
                var page_needle = session.useRegex ? String(session.query || '') : session.query.replace(/\s+/g, '');
                var page_opts = session.useRegex
                    ? { encoding: 'text', ignoreCase: !session.caseSensitive, limit: 1000, start: search_next_cursor }
                    : { encoding: 'hex', ignoreCase: !session.caseSensitive, limit: 1000, start: search_next_cursor };
                var page_len = session.useRegex
                    ? (session.matches.length ? session.matches[0].length : HF.wm_encode_utf8(page_needle).length)
                    : Math.max(1, session.query.replace(/\s+/g, '').length / 2);
                session.source.search(page_needle, page_opts).then(function (r) {
                    var fresh = (r.matches || []).map(function(off) { return { index: off, length: page_len }; });
                    if (fresh.length) {
                        session.matches = session.matches.concat(fresh);
                        session.match_total = r.total || session.match_total;
                        search_next_cursor = r.next || null;
                        navigate(index);
                    } else {
                        search_next_cursor = null;
                        navigate(index % session.matches.length);
                    }
                });
                return;
            }
            session.current = (index + session.matches.length) % session.matches.length;
            var match = session.matches[session.current];
            session.selected = match.index;
            HF.wm_refresh_search_counter(search, session);
            HF.wm_animate_scroll(scroll, scroll.scrollLeft, Math.max(0, 28 + Math.floor(match.index / 16) * session.rowHeight - scroll.clientHeight * 0.4), 210).then(paint);
        }
        function search_hex(query, regex, case_sensitive, direction) {
            session.caseSensitive = !!case_sensitive;
            session.useRegex = !!regex;
            if (regex) {
                var text_query = String(query || '');
                if (!text_query) { clear(); return; }
                var same_query = session.query === query && session.matches.length;
                if (same_query && direction && session.current >= 0) {
                    var local_target = session.current + (direction > 0 ? 1 : -1);
                    if (local_target >= 0 && local_target < session.matches.length) {
                        navigate(local_target);
                        return;
                    }
                }
                var match_len = HF.wm_encode_utf8(text_query).length;
                session.source.search(text_query, { encoding: 'text', ignoreCase: !case_sensitive, limit: 1000 }).then(function(r) {
                    var matches = (r.matches || []).map(function(off) { return { index: off, length: match_len }; });
                    session.match_total = r.total || matches.length;
                    session.match_base = 0;
                    search_next_cursor = r.next || null;
                    var current = HF.wm_commit_search(session, query, matches, direction);
                    if (current >= 0) navigate(current); else { HF.wm_refresh_search_counter(search, session); paint(); }
                }).catch(function(error) {
                    HF.set_error_status(error || HF.labels.request_failed);
                });
                return;
            }
            var compact = String(query || '').replace(/\s+/g, '').toUpperCase();
            if (!compact || compact.length % 2) { clear(); return; }
            var same_query = session.query === query && session.matches.length;

            // Interior stepping is purely local -- no server round trip per
            // arrow click. Only batch boundaries fall through to the window
            // logic below.
            if (same_query && direction && session.current >= 0) {
                var local_target = session.current + (direction > 0 ? 1 : -1);
                if (local_target >= 0 && local_target < session.matches.length) {
                    navigate(local_target);
                    return;
                }
            }

            function adopt_window(r, wrap_to_front) {
                var nlen = Math.max(1, compact.length / 2);
                var win = (r.matches || []).map(function(off) { return { index: off, length: nlen }; });
                session.match_total = r.total || session.match_total;
                if (wrap_to_front && !win.length) {
                    // already at the very beginning: wrap to the END window
                    session.source.search(compact, { encoding: 'hex', ignoreCase: !case_sensitive, regex: regex ? 1 : 0, limit: 1000, last: 1 }).then(adopt_window_end);
                    return;
                }
                session.matches = win;
                session.match_base = r.below || 0;
                search_next_cursor = null;
                session.current = win.length ? win.length - 1 : -1;
                navigate(session.current);
            }
            function adopt_window_end(r) {
                var nlen = Math.max(1, compact.length / 2);
                var win = (r.matches || []).map(function(off) { return { index: off, length: nlen }; });
                session.match_total = r.total || session.match_total;
                session.matches = win;
                session.match_base = r.below || 0;
                search_next_cursor = null;
                session.current = win.length ? win.length - 1 : -1;
                navigate(session.current);
            }

            // forward past the loaded tail
            if (direction > 0 && same_query && session.current === session.matches.length - 1) {
                var start_at = search_next_cursor || (session.matches.length ? session.matches[session.matches.length - 1].index + 1 : 0);
                session.source.search(compact, {
                    encoding: 'hex', ignoreCase: !case_sensitive, regex: regex ? 1 : 0, limit: 1000, start: start_at
                }).then(function(r) {
                    var nlen = Math.max(1, compact.length / 2);
                    var fresh = (r.matches || []).map(function(off) { return { index: off, length: nlen }; });
                    if (fresh.length) {
                        if (r.below !== undefined && r.below !== null && r.first !== undefined && r.first !== null) {
                            // window response: replace
                            session.matches = fresh;
                            session.match_base = r.below || 0;
                        } else {
                            session.matches = session.matches.concat(fresh);
                        }
                        session.match_total = r.total || session.match_total;
                        search_next_cursor = r.next || null;
                        session.current = session.matches.length - fresh.length;
                        navigate(session.current);
                    } else if (session.match_base > 0) {
                        // window tail reached: wrap to the first batch
                        session.source.search(compact, { encoding: 'hex', ignoreCase: !case_sensitive, regex: regex ? 1 : 0, limit: 1000, start: 0 }).then(function(r2) {
                            var nlen2 = Math.max(1, compact.length / 2);
                            session.matches = (r2.matches || []).map(function(off) { return { index: off, length: nlen2 }; });
                            session.match_base = 0;
                            search_next_cursor = r2.next || null;
                            session.current = 0;
                            navigate(0);
                        });
                    } else {
                        search_next_cursor = null;
                    }
                }).catch(function(error) {
                    HF.set_error_status(error || HF.labels.request_failed);
                });
                return;
            }

            // backward from the loaded head: jump to the END window, or the
            // previous window when already inside one
            if (direction < 0 && same_query && session.current <= 0) {
                if (session.match_base > 0) {
                    session.source.search(compact, {
                        encoding: 'hex', ignoreCase: !case_sensitive, regex: session.useRegex ? 1 : 0, limit: 1000,
                        before: session.matches.length ? session.matches[0].index : -1
                    }).then(function(r) { adopt_window(r, true); });
                } else {
                    session.source.search(compact, { encoding: 'hex', ignoreCase: !case_sensitive, regex: regex ? 1 : 0, limit: 1000, last: 1 }).then(adopt_window_end);
                }
                return;
            }

            session.source.search(compact, { encoding: 'hex', ignoreCase: !case_sensitive, regex: regex ? 1 : 0, limit: 1000 }).then(function(r) {
                var nlen = compact.length / 2;
                var matches = (r.matches || []).map(function(off) { return { index: off, length: nlen }; });
                session.match_total = r.total || matches.length;
                session.match_base = 0;
                search_next_cursor = r.next || null;
                var current = HF.wm_commit_search(session, query, matches, direction);
                if (current >= 0) navigate(current); else { HF.wm_refresh_search_counter(search, session); paint(); }
            }).catch(function(error) {
                HF.set_error_status(error || HF.labels.request_failed);
            });
        }
        function save() {
            if (session.readonly || session.saving || !session.dirty) return; session.saving = true; refresh();
            session.source.save(function (done_runs, total_runs, written) {
                tip_text(HF.tr('Saving…') + ' ' + done_runs + '/' + total_runs);
            }).then(function() {
                if (session.stage) {
                    return HarborIO.stageCommit(item.path).then(function () {
                        session.stage = null;
                        session.server_undo = [];
        session.server_redo = [];
                        session.server_redo = [];
                        session.source.setPath(item.path);
                        refresh_history();
                    });
                }
            }).then(function() {
                session.saving = false; session.dirty = false; HF.Recovery.clearBuffer(item.path);
                history_buttons.refresh(history.canUndo(), history.canRedo());
                item.size = total(); item.display_size = HF.format_size(item.size);
                tip_text(''); refresh(); paint();
            }).catch(function(error) { session.saving = false; refresh(); tip_text(error || HF.labels.save_failed); });
        }

        function undo_edit() {
            if (session.server_undo && session.server_undo.length) {
                var entry = session.server_undo.pop();
                session.server_redo.push(entry);
                if (entry.first || !session.server_undo.length) {
                    // back before the first staged replace: discard the stage
                    HarborIO.stageDiscard(item.path).then(function () {
                        session.stage = null;
                        session.source.setPath(item.path);
                        refresh_dirty();
                        refresh();
                        refresh_history();
                        paint();
                        search_hex(session.query, false, session.caseSensitive, 0);
                    });
                    return;
                }
                HF.run_replace_all(item, entry.r, entry.q, { encoding: 'hex', stageSrc: session.stage || item.path }, function () {
                    session.source.invalidate();
                    refresh_dirty();
                    refresh();
                    refresh_history();
                    paint();
                    search_hex(session.query, false, session.caseSensitive, 0);
                }, tip);
                return;
            }
            var prev = history.undo(edit_state());
            if (prev === null) { return; }
            apply_edit_state(prev);
        }

        function redo_edit() {
            if (session.server_redo && session.server_redo.length) {
                var entry = session.server_redo.pop();
                session.server_undo.push(entry);
                HF.run_replace_all(item, entry.q, entry.r, { encoding: 'hex', stageSrc: session.stage || item.path }, function (data) {
                    if (!session.stage && data && data.staged) {
                        session.stage = data.staged;
                        session.source.setPath(session.stage);
                    }
                    refresh_dirty();
                    refresh();
                    refresh_history();
                    paint();
                    search_hex(session.query, false, session.caseSensitive, 0);
                }, tip);
                return;
            }
            var next = history.redo(edit_state());
            if (next === null) { return; }
            apply_edit_state(next);
        }

        var record = HF.window_manager.create({ title: item.path || item.name, icon: item.icon_name || 'binary', className: 'fm-window-binary', content: content, width: 840, height: 590, minWidth: 390, minHeight: 270, beforeClose: function() { if (session.saving) { return false; } if (!session.dirty) { return true; } return HF.confirm_window({ title: HF.tr('Close'), message: HF.labels.discard_text_changes }); }, onClose: function() { HF.Recovery.clearBuffer(item.path); if (session.stage) { HarborIO.stageDiscard(item.path); session.stage = null; } } });
        var footer = HF.wm_create_memory_footer({ size: function() { return total(); }, get saving() { return session.saving; }, get dirty() { return session.dirty; }, get readonly() { return session.readonly; } }, save, function() { HF.window_manager.close(record); });
        content.appendChild(footer.element);
        var history_buttons = HF.wm_add_history_buttons(record, undo_edit, redo_edit);
        history_buttons.refresh(history.canUndo(), history.canRedo());

        content.addEventListener('keydown', function(event) {
            var mod = event.ctrlKey || event.metaKey;
            if (!mod) { return; }
            var key = (event.key || '').toLowerCase();
            if (key === 'z') {
                event.preventDefault();
                if (event.shiftKey) { redo_edit(); } else { undo_edit(); }
            } else if (key === 'y') {
                event.preventDefault();
                redo_edit();
            }
        });

        session.server_undo = [];
        session.server_redo = [];
        var search = HF.wm_create_search(record, content, { placeholder: HF.tr('Enter hex bytes, e.g. DE AD BE EF'), replacePlaceholder: HF.tr('Replace hex value'), hex: true, clear: clear, search: search_hex, offsetJump: function (n) { jump_to(n); }, replaceStep: function(value, all, direction) {
            var replacement = HF.wm_parse_hex_bytes(value); if (!replacement || !session.matches.length) return;
            var current = session.current >= 0 ? session.current : (direction < 0 ? session.matches.length - 1 : 0);
            var list = all ? session.matches.slice() : [session.matches[current]];
            if (!list.every(function(match) { return match.length === replacement.length; })) return tip_text(HF.tr('Hex replacement must match the match length'));

            // Bulk equal-length replace-all writes a STAGE copy: the editor
            // shows the replaced result, the real file is untouched until the
            // user clicks Save (atomic commit). Undo discards the stage.
            if (all) {
                var needle_hex = session.query.replace(/\s+/g, '').toUpperCase();
                var repl_hex = Array.prototype.map.call(replacement, function (b) { return ('0' + b.toString(16)).slice(-2).toUpperCase(); }).join('');
                if (session.source.dirtyCount() > 0 && !session.stage) {
                    // unsaved single edits present: flush them first so the
                    // stage is built from what the user currently sees
                    session.source.save(function () {});
                }
                session.server_undo.push({ q: needle_hex, r: repl_hex, first: !session.stage });
                HF.run_replace_all(item, needle_hex, repl_hex, { encoding: 'hex', stageSrc: session.stage || item.path }, function (data) {
                    session.stage = (data && data.staged) || stage_of();
                    session.source.setPath(session.stage);
                    refresh_dirty();
                    refresh();
                    refresh_history();
                    paint();
                    search_hex(session.query, false, session.caseSensitive, 0);
                }, tip);
                return;
            }

            history.capture(edit_state());
            list.sort(function(a, b) { return a.index - b.index; });
            list.forEach(function(match) {
                for (var ri = 0; ri < replacement.length; ri++) bset(match.index + ri, replacement[ri]);
            });
            refresh_dirty(); refresh();
            history_buttons.refresh(history.canUndo(), history.canRedo());
            recovery_save();
            search_hex(session.query, false, session.caseSensitive, 0);
        } });
        scroll.addEventListener('scroll', schedulePaint, { passive: true });

        function start_load() {
            tip_text(HF.tr('Reading full file…'));
            session.source.ensure(0, Math.min(total(), 131072)).then(function() {
                refresh_dirty();
                paint();
                if (session.selected < 0 && total()) {
                    session.selected = 0;
                }
                update_cursor_hex();
                footer.refresh();
                history_buttons.refresh(history.canUndo(), history.canRedo());
                tip_text('');
                if (session.readonly) {
                    tip.textContent = HF.labels.system_folder_blocked;
                    tip.style.display = 'block';
                }
            }).catch(function(error) { tip_text(error || HF.labels.request_failed); });
        }

        if (HF.Recovery.hasBuffer(item.path) === 'hex' && total() <= 4 * 1024 * 1024) {
            HF.wm_create_recover_banner(content, function() {
                var rec = HF.Recovery.getBuffer(item.path);
                var recovered = (rec && rec.payload && rec.payload.bytes) ? HF.Recovery.base64ToBytes(rec.payload.bytes) : null;
                session.source.ensure(0, Math.min(total(), 131072)).then(function() {
                    if (recovered && recovered.length && recovered.length <= total()) {
                        session.source.ensure(0, recovered.length).then(function() {
                            for (var ri = 0; ri < recovered.length; ri++) {
                                if (bget(ri) !== recovered[ri]) bset(ri, recovered[ri]);
                            }
                            finish_recovery(rec);
                        });
                    } else {
                        finish_recovery(rec);
                    }
                }).catch(function() { tip_text(HF.labels.request_failed); });
                function finish_recovery(rec) {
                    if (rec && rec.payload && typeof rec.payload.selected === 'number') {
                        session.selected = rec.payload.selected;
                    }
                    refresh_dirty();
                    paint();
                    update_cursor_hex();
                    var payload = (rec && rec.payload) || {};
                    scroll.scrollTop = Number(payload.scrollTop) || 0;
                    scroll.scrollLeft = Number(payload.scrollLeft) || 0;
                    footer.refresh();
                    history_buttons.refresh(history.canUndo(), history.canRedo());
                    recovery_save();
                    tip_text('');
                }
            }, function() {
                HF.Recovery.clearBuffer(item.path);
                start_load();
            });
        } else {
            start_load();
        }
        return record;
    }

    HF.WINDOWED_TEXT_THRESHOLD = 2 * 1024 * 1024;

    HF.run_replace_all = function run_replace_all(item, q, r, opts, on_done, tip_node) {
        opts = opts || {};
        var tip = tip_node || document.querySelector('.fm-chunk-window .fm-window-doc-tip, .fm-window-binary .fm-window-binary-tip');
        var show_tip = tip ? function (text) {
            tip.textContent = text;
            tip.style.display = text ? 'block' : 'none';
        } : function () {};

        show_tip(HF.labels.replacing + ' 0%');
        var poll = setInterval(function () {
            HarborIO.replaceProgress(item.path).then(function (p) {
                if (p.total > 0) {
                    show_tip(HF.labels.replacing + ' ' + Math.floor(p.done * 100 / p.total) + '% (' + p.done + '/' + p.total + ')');
                }
            }).catch(function () {});
        }, 250);

        HarborIO.replaceAll(item.path, q, r, { encoding: opts.encoding, ignoreCase: opts.ignoreCase, stageSrc: opts.stageSrc }).then(function (data) {
            clearInterval(poll);
            show_tip(HF.labels.replacing + ' 100%');
            setTimeout(function () { show_tip(''); }, 400);
            if (on_done) {
                on_done(data);
            }
        }).catch(function (error) {
            clearInterval(poll);
            show_tip('');
            HF.set_error_status(error || HF.labels.save_failed);
        });
    };

    HF.CHUNK_SIZE = 64 * 1024;

    HF.wm_open_chunked_text_window = function wm_open_chunked_text_window(item, initial_offset) {
        var decoder = new TextDecoder('utf-8');
        var encoder = new TextEncoder();
        var session = {
            total: Math.max(0, Number(item.size || 0)),
            ws: 0,
            we: 0,
            dirty: false,
            saving: false,
            readonly: !HF.can_modify_system_path(item.path)
        };

        var content = HF.wm_document_column();
        var tip = HF.Util.createElement('div', 'fm-window-doc-tip');
        if (session.readonly) {
            HF.set_warning_status(HF.labels.system_folder_blocked);
        }
        var area = document.createElement('textarea');
        area.className = 'fm-chunk-text';
        area.spellcheck = false;
        area.readOnly = session.readonly;
        area.wrap = 'soft';
        if (HF.state.preferences.editor_auto_wrap === 1) {
            area.classList.add('is-wrap');
        }
        content.appendChild(tip);
        content.appendChild(area);

        var range_node, status_node;

        function load(offset) {
            offset = Math.max(0, Math.min(session.total - 1, Number(offset) || 0));
            tip.textContent = HF.tr('Reading full file…');
            tip.style.display = 'block';
            var fetch_len = HF.CHUNK_SIZE + 4096;
            HarborIO.slice(item.path, offset, fetch_len).then(function (result) {
                var bytes = new Uint8Array(result.buffer);
                var text = decoder.decode(bytes);
                var start_skip = 0;
                if (offset > 0) {
                    var first_nl = text.indexOf('\n');
                    if (first_nl >= 0 && first_nl + 1 < text.length) {
                        start_skip = first_nl + 1;
                    }
                }
                var body = text.slice(start_skip);
                var last_nl = body.lastIndexOf('\n');
                var eof = (offset + bytes.length) >= session.total;
                var used;
                if (last_nl >= 0) {
                    body = body.slice(0, last_nl + 1);
                    used = body.length;
                } else if (eof) {
                    used = body.length;
                } else {
                    used = body.length;
                }
                var consumed = text.slice(0, start_skip).length + used;
                session.ws = offset + (start_skip ? (new TextEncoder().encode(text.slice(0, start_skip))).length : 0);
                var body_bytes = encoder.encode(body);
                session.we = session.ws + body_bytes.length;
                session.raw_ws = session.ws;
                session.raw_we = session.we;
                area.value = body;
                area.dataset.original = body;
                session.dirty = false;
                tip.style.display = 'none';
                refresh_status();
            }).catch(function (error) {
                tip.textContent = error || HF.labels.request_failed;
                tip.classList.add('is-error');
            });
        }

        function refresh_status() {
            if (range_node) {
                range_node.textContent = session.ws + ' - ' + session.we + ' / ' + session.total + ' B';
            }
            if (status_node) {
                status_node.textContent = session.dirty ? HF.tr('Unsaved') : HF.tr('Saved');
            }
        }

        function do_save() {
            if (session.readonly || session.saving || !session.dirty) {
                return;
            }
            session.saving = true;
            refresh_status();
            var bytes = encoder.encode(area.value);
            HarborIO.splice(item.path, session.ws, session.we, bytes, session.total).then(function (data) {
                session.saving = false;
                session.total = Number(data.size || session.total);
                session.we = session.ws + bytes.length;
                area.dataset.original = area.value;
                session.dirty = false;
                HF.set_status(HF.labels.saved, 'success');
                refresh_status();
            }).catch(function (error) {
                session.saving = false;
                HF.set_error_status(error || HF.labels.save_failed);
                refresh_status();
            });
        }

        area.addEventListener('input', function () {
            session.dirty = area.value !== area.dataset.original;
            refresh_status();
        });

        // Ctrl+A in a windowed editor means the WHOLE file: a subsequent
        // paste/delete replaces the entire content via splice(0, total).
        var select_all = false;
        area.addEventListener('keydown', function (event) {
            var mod = event.ctrlKey || event.metaKey;
            if (mod && (event.key === 'a' || event.key === 'A')) {
                select_all = true;
                return;
            }
            if (select_all && !mod) {
                select_all = false;
            }
        });
        area.addEventListener('click', function () { select_all = false; });
        area.addEventListener('select', function () {
            var whole_window = area.selectionStart === 0 &&
                area.selectionEnd === area.value.length &&
                area.value.length > 0;
            if (!whole_window) {
                select_all = false;
            }
        });
        area.addEventListener('paste', function (event) {
            if (!select_all) {
                return;
            }
            select_all = false;
            event.preventDefault();
            var text = (event.clipboardData || window.clipboardData).getData('text');
            replace_whole_file(text);
        });
        area.addEventListener('cut', function (event) {
            if (!select_all) {
                return;
            }
            select_all = false;
            event.preventDefault();
            event.clipboardData.setData('text', area.value);
            replace_whole_file('');
        });
        function replace_whole_file(text) {
            var bytes = encoder.encode(text);
            var undo = { ws: session.ws, we: session.we, text: area.value, total: session.total };
            tip.textContent = HF.labels.replacing;
            tip.style.display = 'block';
            HarborIO.splice(item.path, 0, session.total, bytes, session.total).then(function (data) {
                tip.style.display = 'none';
                session.total = Number(data.size || bytes.length);
                session.ws = 0;
                session.we = bytes.length;
                area.value = text;
                area.dataset.original = text;
                session.dirty = false;
                whole_undo = undo;
                refresh_status();
                HF.set_status(HF.labels.saved, 'success');
            }).catch(function (error) {
                tip.style.display = 'none';
                HF.set_error_status(error || HF.labels.save_failed);
            });
        }
        var whole_undo = null;

        var record = HF.window_manager.create({
            title: item.path || item.name,
            icon: item.icon_name || 'text',
            className: 'fm-window-text fm-chunk-window',
            content: content,
            width: 820,
            height: 600,
            minWidth: 380,
            minHeight: 220,
            applyWrap: function(on) {
                area.classList.toggle('is-wrap', !!on);
            }
        });

        var footer = HF.wm_create_memory_footer({
            get size() { return session.total; },
            get saving() { return session.saving; },
            get dirty() { return session.dirty; },
            get readonly() { return session.readonly; }
        }, do_save, function () { HF.window_manager.close(record); });

        var search = HF.wm_create_search(record, content, {
            placeholder: HF.tr('Search'),
            replacePlaceholder: HF.tr('Replace with'),
            hex: false,
            clear: function () {},
            search: function (q, regex, case_sensitive, direction) {
                HarborIO.search(item.path, q, { ignoreCase: !case_sensitive }).then(function (r) {
                    var total = r.matches ? r.matches.length : 0;
                    if (!total) {
                        HF.set_warning_status(HF.labels.not_found);
                        search.setStatus(-1, 0);
                        return;
                    }
                    var idx = 0;
                    for (var i = 0; i < r.matches.length; i++) {
                        if (r.matches[i] >= session.ws) { idx = i; break; }
                    }
                    search.setStatus(idx, total);
                    load(Math.max(0, r.matches[idx] - 64));
                }).catch(function (error) {
                    HF.set_error_status(error || HF.labels.request_failed);
                });
            },
            replaceStep: function (value, all) {
                var q = document.querySelector('.fm-chunk-window .fm-editor-search-input').value;
                if (!q) {
                    return;
                }
                HF.run_replace_all(item, q, value, { ignoreCase: false }, function (data) {
                    HF.set_status((data.replaced || 0) + ' ' + HF.labels.replaced_count, 'success');
                    session.total = Number(data.size || session.total);
                    load(session.ws);
                }, tip);
            }
        });

        area.addEventListener('keydown', function (event) {
            if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z') && whole_undo) {
                event.preventDefault();
                var u = whole_undo;
                whole_undo = null;
                var bytes = encoder.encode(u.text);
                HarborIO.splice(item.path, 0, session.total, bytes, session.total).then(function () {
                    session.total = u.total;
                    load(u.ws);
                }).catch(function (error) {
                    HF.set_error_status(error || HF.labels.save_failed);
                });
            }
        });

        var nav = HF.Util.createElement('div', 'fm-chunk-nav');
        var prev = HF.Util.createElement('button', 'fm-window-action', HF.labels.prev_window);
        prev.type = 'button';
        prev.addEventListener('click', function () { load(Math.max(0, session.ws - HF.CHUNK_SIZE)); });
        var next = HF.Util.createElement('button', 'fm-window-action', HF.labels.next_window);
        next.type = 'button';
        next.addEventListener('click', function () { load(session.we); });
        var jump_input = document.createElement('input');
        jump_input.type = 'text';
        jump_input.className = 'fm-whex-jump';
        jump_input.placeholder = HF.labels.jump_offset;
        var jump_btn = HF.Util.createElement('button', 'fm-window-action', HF.labels.go);
        jump_btn.type = 'button';
        jump_btn.addEventListener('click', function () {
            var v = jump_input.value.trim();
            load(parseInt(v, 10) || 0);
        });
        range_node = HF.Util.createElement('span', 'fm-whex-status');
        status_node = HF.Util.createElement('span', 'fm-whex-status');
        nav.appendChild(prev);
        nav.appendChild(next);
        nav.appendChild(jump_input);
        nav.appendChild(jump_btn);
        nav.appendChild(range_node);
        nav.appendChild(status_node);
        footer.element.insertBefore(nav, footer.element.firstChild);
        content.appendChild(footer.element);

        load(initial_offset || 0);
        return record;
    };

    HF.open_text = function(item, data) {
        var size = Number(item.size || 0);
        if (!data && size > HF.WINDOWED_TEXT_THRESHOLD) {
            return HF.wm_open_chunked_text_window(item);
        }
        return HF.wm_open_text_window(item, data);
    };
    HF.open_image = function(item) {
        return HF.wm_open_image_window(item);
    };
    HF.open_pdf = function(item) {
        return HF.wm_open_pdf_window(item);
    };
    HF.open_video = function(item) {
        return HF.wm_open_video_window(item);
    };
    HF.open_binary = function(item) {
        return HF.wm_open_memory_hex_window(item);
    };

    HF.DocumentWindows = {
        open_text: HF.open_text,
        open_binary: HF.open_binary,
        open_image: HF.open_image,
        open_pdf: HF.open_pdf,
        open_video: HF.open_video,
        open_memory_text: HF.wm_open_memory_text_window,
        open_memory_hex: HF.wm_open_memory_hex_window
    };
})(window.HarborFile = window.HarborFile || {});
