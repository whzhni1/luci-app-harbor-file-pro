
(function (HF) {
    HF.window_manager = (function() {
        var create_element = HF.Util.createElement;

        function clamp(value, minimum, maximum) {
            return Math.max(minimum, Math.min(maximum, value));
        }

        function point_from_event(event) {
            var touch = event.touches && event.touches.length ? event.touches[0] :
                (event.changedTouches && event.changedTouches.length ? event.changedTouches[0] : event);
            return { x: Number(touch.clientX || 0), y: Number(touch.clientY || 0) };
        }

        function is_primary_event(event) {
            return !event || event.button === undefined || event.button === 0;
        }

        function DesktopWindowManager() {
            this.records = [];
            this.next_id = 1;
            this.next_z_index = 4000;
            this.active = null;
            this.supports_pointer = !!window.PointerEvent;
            this.window_size_save_timer = null;
            this.taskbar_hide_timer = null;
            this.taskbar_interacting = false;
            this.keyboard_scroll_suppressed_until = 0;
            this.scroll_positions = [];
            this.modal_overlay = null;
            this.modal_record = null;
            this.taskbar = create_element('nav', 'fm-window-taskbar is-empty');
            this.taskbar.id = 'fm_window_taskbar';
            this.taskbar.setAttribute('aria-label', HF.tr('Open windows'));
            this.taskbar_list = create_element('div', 'fm-window-taskbar-list');
            this.taskbar.appendChild(this.taskbar_list);
            document.body.appendChild(this.taskbar);
            this.taskbar_pill = create_element('button', 'fm-taskbar-pill');
            this.taskbar_pill.type = 'button';
            this.taskbar_pill.setAttribute('aria-label', this.caption('open_windows', 'Open windows'));
            var manager = this;
            this.taskbar_pill.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                manager.set_taskbar_revealed(true);
            });
            document.body.appendChild(this.taskbar_pill);
            var pill_touch_y = null;
            this.taskbar_pill.addEventListener('touchstart', function(event) {
                if (event.touches.length) {
                    pill_touch_y = event.touches[0].clientY;
                }
            }, { passive: true });
            this.taskbar_pill.addEventListener('touchend', function(event) {
                var start = pill_touch_y;
                pill_touch_y = null;
                if (start == null || !event.changedTouches.length) {
                    return;
                }
                var dy = event.changedTouches[0].clientY - start;
                if (dy <= 40) {
                    manager.set_taskbar_revealed(true);
                }
            }, { passive: true });
            this.taskbar_list.addEventListener('wheel', function(event) {
                if (this.scrollWidth <= this.clientWidth) {
                    return;
                }
                var delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
                if (!delta) {
                    return;
                }
                event.preventDefault();
                this.scrollLeft += delta;
            }, { passive: false });
            this.bind_taskbar_reveal();
            this.bind_viewport_events();
        }

        DesktopWindowManager.prototype.caption = function(key, fallback) {
            return (typeof HF.labels !== 'undefined' && HF.labels[key]) ? HF.labels[key] : fallback;
        };

        DesktopWindowManager.prototype.is_compact = function() {
            if (!window.matchMedia) {
                return window.innerWidth <= 760;
            }
            return window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
        };

        DesktopWindowManager.prototype.schedule_taskbar_hide = function(delay) {
            var manager = this;
            if (this.taskbar_hide_timer) {
                clearTimeout(this.taskbar_hide_timer);
                this.taskbar_hide_timer = null;
            }
            if (this.taskbar_interacting || !this.taskbar || this.taskbar.classList.contains('is-empty')) {
                return;
            }
            this.taskbar_hide_timer = setTimeout(function() {
                if (!manager.taskbar_interacting) {
                    manager.set_taskbar_revealed(false);
                }
                manager.taskbar_hide_timer = null;
            }, typeof delay === 'number' ? delay : 3000);
        };

        DesktopWindowManager.prototype.set_taskbar_revealed = function(revealed) {
            if (!this.taskbar || this.taskbar.classList.contains('is-empty')) {
                return;
            }
            if (this.taskbar_hide_timer) {
                clearTimeout(this.taskbar_hide_timer);
                this.taskbar_hide_timer = null;
            }
            this.taskbar.classList.toggle('is-revealed', !!revealed);
            this.refresh_taskbar_pill();
            if (revealed) {
                this.schedule_taskbar_hide(3000);
            }
        };

        DesktopWindowManager.prototype.scroll_position_changed = function(target) {
            var x = target === window ? (window.pageXOffset || window.scrollX || 0) : Number(target.scrollLeft || 0);
            var y = target === window ? (window.pageYOffset || window.scrollY || 0) : Number(target.scrollTop || 0);
            var entry = null;
            for (var index = 0; index < this.scroll_positions.length; index++) {
                if (this.scroll_positions[index].target === target) {
                    entry = this.scroll_positions[index];
                    break;
                }
            }
            if (!entry) {
                this.scroll_positions.push({ target: target, x: x, y: y });
                return false;
            }
            var changed = entry.x !== x || entry.y !== y;
            entry.x = x;
            entry.y = y;
            return changed;
        };

        DesktopWindowManager.prototype.is_valid_page_scroll_target = function(target) {
            if (target === window || target === document || target === document.documentElement || target === document.body) {
                return true;
            }
            return !!(target && target.id === 'fm_content');
        };

        DesktopWindowManager.prototype.is_page_scrollable = function() {
            var root_height = Math.max(
                document.documentElement ? document.documentElement.scrollHeight : 0,
                document.body ? document.body.scrollHeight : 0
            );
            if (root_height > window.innerHeight + 2) {
                return true;
            }
            var file_content = document.getElementById('fm_content');
            return !!(file_content && file_content.scrollHeight > file_content.clientHeight + 2);
        };

        DesktopWindowManager.prototype.reveal_for_page_operation = function() {
            if (!this.is_page_scrollable() &&
                    !document.body.classList.contains('fm-window-dragging') &&
                    !document.body.classList.contains('fm-window-resizing')) {
                this.set_taskbar_revealed(true);
            }
        };

        DesktopWindowManager.prototype.reveal_for_page_scroll = function(target) {
            if (!this.is_valid_page_scroll_target(target) ||
                    document.body.classList.contains('fm-window-dragging') ||
                    document.body.classList.contains('fm-window-resizing') ||
                    (HF.state && HF.state.selection_dragging) ||
                    Date.now() < this.keyboard_scroll_suppressed_until) {
                return;
            }
            if (this.scroll_position_changed(target)) {
                this.set_taskbar_revealed(true);
            }
        };

        DesktopWindowManager.prototype.bind_taskbar_reveal = function() {
            var manager = this;
            document.addEventListener('scroll', function(event) {
                manager.reveal_for_page_scroll(event.target);
            }, true);
            window.addEventListener('scroll', function() {
                manager.reveal_for_page_scroll(window);
            }, { passive: true });
            this.scroll_position_changed(window);
            var file_content = document.getElementById('fm_content');
            if (file_content) {
                this.scroll_position_changed(file_content);
            }
            var operation_handler = function() {
                manager.reveal_for_page_operation();
            };
            document.addEventListener('click', operation_handler, { passive: true, capture: true });
            var touch_start = null;
            var touch_moved = false;
            document.addEventListener('touchstart', function(event) {
                if (event.touches && event.touches.length) {
                    touch_start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
                    touch_moved = false;
                }
            }, { passive: true, capture: true });
            document.addEventListener('touchmove', function(event) {
                if (!touch_start || !event.touches || !event.touches.length) {
                    return;
                }
                var dx = event.touches[0].clientX - touch_start.x;
                var dy = event.touches[0].clientY - touch_start.y;
                if (dx * dx + dy * dy > 64) {
                    touch_moved = true;
                }
            }, { passive: true, capture: true });
            document.addEventListener('touchend', function() {
                if (!touch_moved) {
                    operation_handler();
                }
                touch_start = null;
                touch_moved = false;
            }, { passive: true, capture: true });
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', function() {
                    manager.keyboard_scroll_suppressed_until = Date.now() + 700;
                }, { passive: true });
            }
            this.taskbar.addEventListener('mouseenter', function() {
                manager.taskbar_interacting = true;
                manager.set_taskbar_revealed(true);
            });
            this.taskbar.addEventListener('mouseleave', function() {
                manager.taskbar_interacting = false;
                manager.schedule_taskbar_hide(400);
            });
            this.taskbar.addEventListener('touchstart', function() {
                manager.taskbar_interacting = true;
                if (manager.taskbar_hide_timer) {
                    clearTimeout(manager.taskbar_hide_timer);
                    manager.taskbar_hide_timer = null;
                }
            }, { passive: true });
            this.taskbar.addEventListener('touchend', function() {
                manager.taskbar_interacting = false;
                manager.schedule_taskbar_hide(900);
            }, { passive: true });
        };

        DesktopWindowManager.prototype.refresh_taskbar_pill = function() {
            if (!this.taskbar_pill) {
                return;
            }
            var show = !this.taskbar.classList.contains('is-empty') &&
                !this.taskbar.classList.contains('is-revealed');
            this.taskbar_pill.style.display = show ? 'block' : 'none';
        };

        DesktopWindowManager.prototype.work_area = function() {
            return {
                width: Math.max(1, Number(window.innerWidth || document.documentElement.clientWidth || 1)),
                height: Math.max(1, Number(window.innerHeight || document.documentElement.clientHeight || 1))
            };
        };

        DesktopWindowManager.prototype.min_width = function(record, max_width) {
            var configured = this.is_compact() ? Number(record.options.mobileMinWidth || 180) :
                Number(record.options.minWidth || 280);
            return Math.min(Math.max(180, configured), max_width);
        };

        DesktopWindowManager.prototype.min_height = function(record, max_height) {
            var configured = this.is_compact() ? Number(record.options.mobileMinHeight || 130) :
                Number(record.options.minHeight || 170);
            return Math.min(Math.max(110, configured), max_height);
        };

        DesktopWindowManager.prototype.taskbar_top = function(area) {
            if (!this.taskbar || this.taskbar.classList.contains('is-empty')) {
                return area.height;
            }
            return Math.max(0, area.height - Math.max(0, this.taskbar.offsetHeight || 0) - 6);
        };

        DesktopWindowManager.prototype.get_rect = function(record) {
            var rect = record.element.getBoundingClientRect();
            return {
                left: Number(rect.left || 0),
                top: Number(rect.top || 0),
                width: Number(rect.width || record.options.width || 480),
                height: Number(rect.height || record.options.height || 320)
            };
        };

        DesktopWindowManager.prototype.clamp_rect = function(record, rect) {
            var compact = this.is_compact();
            var margin = compact ? 4 : 8;
            var area = this.work_area();
            var max_width = Math.max(180, area.width - margin * 2);
            var max_height = Math.max(110, area.height - margin * 2);
            var min_width = this.min_width(record, max_width);
            var min_height = this.min_height(record, max_height);
            var width = clamp(Number(rect.width || min_width), min_width, max_width);
            var height = clamp(Number(rect.height || min_height), min_height, max_height);
            var header = record.element.querySelector('.fm-window-titlebar, .fm-dialog-header');
            var header_height = header ? Math.max(32, Number(header.getBoundingClientRect().height || 42)) : 42;
            var taskbar_top = this.taskbar_top(area);
            var title_visible_width = Math.min(width, compact ? 96 : 160);
            var min_left = -width + title_visible_width;
            var max_left = Math.max(min_left, area.width - title_visible_width);
            var max_top = Math.max(margin, taskbar_top - header_height - margin);
            return {
                left: clamp(isFinite(Number(rect.left)) ? Number(rect.left) : margin, min_left, max_left),
                top: clamp(isFinite(Number(rect.top)) ? Number(rect.top) : margin, margin, max_top),
                width: width,
                height: height
            };
        };

        DesktopWindowManager.prototype.apply_rect = function(record, rect) {
            var next = this.clamp_rect(record, rect);
            record.rect = next;
            record.element.style.left = Math.round(next.left) + 'px';
            record.element.style.top = Math.round(next.top) + 'px';
            record.element.style.width = Math.round(next.width) + 'px';
            record.element.style.height = Math.round(next.height) + 'px';
        };

        DesktopWindowManager.prototype.apply_exact_rect = function(record, rect) {
            var next = {
                left: Number(rect.left || 0),
                top: Number(rect.top || 0),
                width: Number(rect.width || record.options.width || 480),
                height: Number(rect.height || record.options.height || 320)
            };
            record.rect = next;
            record.element.style.left = Math.round(next.left) + 'px';
            record.element.style.top = Math.round(next.top) + 'px';
            record.element.style.width = Math.round(next.width) + 'px';
            record.element.style.height = Math.round(next.height) + 'px';
        };

        DesktopWindowManager.prototype.preferred_size = function(record, measured) {
            var fallback_width = Number(record.options.width || measured.width || 680);
            var fallback_height = Number(record.options.height || measured.height || 440);
            if (record.options.persistSize === false || !HF.state || !HF.state.preferences) {
                return { width: fallback_width, height: fallback_height };
            }
            var compact = this.is_compact();
            var configured_width = Number(compact ? HF.state.preferences.mobile_window_width : HF.state.preferences.window_width);
            var configured_height = Number(compact ? HF.state.preferences.mobile_window_height : HF.state.preferences.window_height);
            return {
                width: isFinite(configured_width) && configured_width >= 180 ? configured_width : fallback_width,
                height: isFinite(configured_height) && configured_height >= 130 ? configured_height : fallback_height
            };
        };

        DesktopWindowManager.prototype.persist_size = function(record) {
            var manager = this;
            if (!record || record.options.persistSize === false || record.maximized || !record.rect) {
                return;
            }
            var width = Math.max(180, Math.round(record.rect.width));
            var height = Math.max(130, Math.round(record.rect.height));
            var window_target = this.is_compact() ? 'mobile' : 'desktop';
            if (HF.state && HF.state.preferences) {
                HF.state.preferences[window_target === 'mobile' ? 'mobile_window_width' : 'window_width'] = width;
                HF.state.preferences[window_target === 'mobile' ? 'mobile_window_height' : 'window_height'] = height;
            }
            if (this.window_size_save_timer) {
                clearTimeout(this.window_size_save_timer);
            }
            this.window_size_save_timer = setTimeout(function() {
                manager.window_size_save_timer = null;
                HF.save_preferences({
                    section: 'window',
                    window_target: window_target,
                    window_width: width,
                    window_height: height
                }, '', null, function() {
                });
            }, 420);
        };

        DesktopWindowManager.prototype.initial_rect = function(record) {
            var area = this.work_area();
            var compact = this.is_compact();
            var margin = compact ? 4 : 8;
            var measured = this.get_rect(record);
            var preferred = this.preferred_size(record, measured);
            var max_width = Math.max(180, area.width - margin * 2);
            var max_height = Math.max(130, area.height - margin * 2);
            var width = Math.min(preferred.width, max_width);
            var height = Math.min(preferred.height, max_height);
            var taskbar_top = this.taskbar_top(area);
            return {
                left: Math.max(margin, Math.round((area.width - width) / 2)),
                top: Math.max(margin, Math.round((taskbar_top - height) / 2)),
                width: width,
                height: height
            };
        };

        DesktopWindowManager.prototype.focus = function(record) {
            if (!record || record.closed || record.minimized) {
                return;
            }
            if (record.modal) {
                this.active = record;
                record.element.style.zIndex = '9001';
                this.records.forEach(function(item) {
                    item.element.classList.toggle('fm-window-focused', item === record && !item.minimized && !item.closed);
                });
                this.render_taskbar();
                return;
            }
            if (this.modal_overlay && this.modal_overlay.style.display !== 'none') {
                var modal = this.modal_record;
                if (modal && !modal.closed && !modal.minimized) {
                    modal.element.style.zIndex = '9001';
                    this.active = modal;
                    this.records.forEach(function(item) {
                        item.element.classList.toggle('fm-window-focused', item === modal && !item.minimized && !item.closed);
                    });
                    this.render_taskbar();
                }
                return;
            }
            if (this.next_z_index >= 8400) {
                var ordered = this.records.filter(function(item) { return !item.closed && !item.minimized; })
                    .sort(function(a, b) { return Number(a.element.style.zIndex || 0) - Number(b.element.style.zIndex || 0); });
                this.next_z_index = 4000;
                for (var n = 0; n < ordered.length; n++) {
                    ordered[n].element.style.zIndex = String(++this.next_z_index);
                }
            }
            this.active = record;
            record.element.style.zIndex = String(++this.next_z_index);
            this.records.forEach(function(item) {
                item.element.classList.toggle('fm-window-focused', item === record && !item.minimized && !item.closed);
            });
            this.render_taskbar();
        };

        DesktopWindowManager.prototype.show_modal_overlay = function(record) {
            if (!this.modal_overlay) {
                this.modal_overlay = create_element('div', 'fm-modal-overlay');
                document.body.appendChild(this.modal_overlay);
            }
            if (this.modal_record && this.modal_record !== record && !this.modal_record.closed) {
                this.modal_record.modal = false;
            }
            this.modal_overlay.style.display = 'block';
            this.modal_record = record;
            if (record) {
                record.modal = true;
            }
            this.focus(record);
        };

        DesktopWindowManager.prototype.hide_modal_overlay = function(record) {
            if (record) {
                record.modal = false;
            }
            this.modal_record = null;
            if (this.modal_overlay) {
                this.modal_overlay.style.display = 'none';
            }
        };

        DesktopWindowManager.prototype.set_maximize_button = function(record) {
            if (!record.maximize_button) {
                return;
            }
            var maximized = !!record.maximized;
            record.maximize_button.setAttribute('aria-label', maximized ?
                this.caption('restore_window', 'Restore') : this.caption('maximize_window', 'Maximize'));
            record.maximize_button.setAttribute('title', maximized ?
                this.caption('restore_window', 'Restore') : this.caption('maximize_window', 'Maximize'));
            record.maximize_button.setAttribute('aria-pressed', maximized ? 'true' : 'false');
            record.maximize_button.firstChild.textContent = maximized ? '❐' : '□';
        };

        DesktopWindowManager.prototype.maximize = function(record) {
            if (!record || record.closed || record.minimized) {
                return;
            }
            if (record.maximized) {
                this.restore_size(record);
                return;
            }
            record.restore_rect = this.get_rect(record);
            record.maximized = true;
            var area = this.work_area();
            var margin = this.is_compact() ? 4 : 8;
            this.apply_rect(record, {
                left: margin,
                top: margin,
                width: area.width - margin * 2,
                height: area.height - margin * 2
            });
            record.element.classList.add('fm-window-maximized');
            this.set_maximize_button(record);
            this.focus(record);
        };

        DesktopWindowManager.prototype.restore_size = function(record) {
            if (!record || record.closed) {
                return;
            }
            record.maximized = false;
            record.element.classList.remove('fm-window-maximized');
            this.apply_rect(record, record.restore_rect || this.initial_rect(record));
            this.set_maximize_button(record);
            if (!record.minimized) {
                this.focus(record);
            }
        };

        DesktopWindowManager.prototype.minimize = function(record) {
            if (!record || record.closed || record.minimized) {
                return;
            }
            if (record.modal) {
                return;
            }
            record.rect = this.get_rect(record);
            record.minimized_rect = {
                left: record.rect.left,
                top: record.rect.top,
                width: record.rect.width,
                height: record.rect.height
            };
            record.minimized_viewport = { width: window.innerWidth, height: window.innerHeight };
            record.minimized = true;
            record.element.style.display = 'none';
            record.element.classList.remove('fm-window-focused');
            if (this.active === record) {
                this.active = null;
            }
            this.render_taskbar();
            this.set_taskbar_revealed(true);
        };

        DesktopWindowManager.prototype.restore = function(record) {
            if (!record || record.closed) {
                return;
            }
            record.minimized = false;
            record.element.style.display = record.display_mode || 'flex';
            if (record.maximized) {
                var area = this.work_area();
                var margin = this.is_compact() ? 4 : 8;
                this.apply_rect(record, {
                    left: margin,
                    top: margin,
                    width: area.width - margin * 2,
                    height: area.height - margin * 2
                });
            } else {
                var saved_rect = record.minimized_rect || record.rect || this.initial_rect(record);
                var saved_viewport = record.minimized_viewport;
                if (saved_viewport && saved_viewport.width === window.innerWidth &&
                        saved_viewport.height === window.innerHeight) {
                    this.apply_exact_rect(record, saved_rect);
                } else {
                    this.apply_rect(record, saved_rect);
                }
            }
            this.focus(record);
        };

        DesktopWindowManager.prototype.close = function(record) {
            if (!record || record.closed) {
                return;
            }
            var manager = this;
            var finish = function() {
                if (record.closed) {
                    return;
                }
                if (record.modal) {
                    manager.hide_modal_overlay(record);
                }
                if (record.on_close) {
                    record.on_close(record);
                }
                record.closed = true;
                record.minimized = false;
                record.element.style.display = 'none';
                record.element.classList.remove('fm-window-focused');
                if (manager.active === record) {
                    manager.active = null;
                }
                if (!record.legacy && record.element.parentNode) {
                    record.element.parentNode.removeChild(record.element);
                    manager.records = manager.records.filter(function(item) { return item !== record; });
                }
                manager.render_taskbar();
            };
            if (record.before_close) {
                var result;
                try {
                    result = record.before_close(record);
                } catch (error) {
                    result = true;
                }
                if (result === false) {
                    return;
                }
                if (result && typeof result.then === 'function') {
                    result.then(function(ok) {
                        if (ok !== false) {
                            finish();
                        }
                    });
                    return;
                }
            }
            finish();
        };

        DesktopWindowManager.prototype.add_control = function(controls, action, symbol, label, handler) {
            var button = create_element('button', 'fm-window-control');
            button.type = 'button';
            button.setAttribute('data-window-action', action);
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
            var glyph = create_element('span', 'fm-window-control-symbol', symbol);
            button.appendChild(glyph);
            button.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                handler();
            });
            controls.appendChild(button);
            return button;
        };

        DesktopWindowManager.prototype.setup_controls = function(record, header, existing_close) {
            var manager = this;
            var controls = header.querySelector('.fm-window-controls');
            if (!controls) {
                controls = create_element('div', 'fm-window-controls');
                header.appendChild(controls);
            }
            record.minimize_button = this.add_control(controls, 'minimize', '−',
                this.caption('minimize_window', 'Minimize'), function() { manager.minimize(record); });
            record.maximize_button = this.add_control(controls, 'maximize', '□',
                this.caption('maximize_window', 'Maximize'), function() { manager.maximize(record); });
            if (existing_close) {
                existing_close.classList.add('fm-window-control', 'fm-window-close');
                existing_close.setAttribute('title', this.caption('close_window', 'Close'));
                controls.appendChild(existing_close);
                existing_close.addEventListener('click', function() {
                    window.setTimeout(function() { manager.sync_legacy_windows(); }, 0);
                });
            } else {
                var close_button = this.add_control(controls, 'close', '×',
                    this.caption('close_window', 'Close'), function() { manager.close(record); });
                close_button.classList.add('fm-window-close');
                record.close_button = close_button;
            }
            this.set_maximize_button(record);
        };

        DesktopWindowManager.prototype.bind_drag = function(record, header) {
            var manager = this;
            function can_start(event) {
                if (!is_primary_event(event)) {
                    return false;
                }
                if (event.target && event.target.closest && event.target.closest('button, input, textarea, select, a, label')) {
                    return false;
                }
                return true;
            }
            function start(event) {
                if (!can_start(event)) {
                    return;
                }
                manager.begin_interaction(record, event, 'drag', '');
            }
            if (this.supports_pointer) {
                header.addEventListener('pointerdown', start);
            } else {
                header.addEventListener('mousedown', start);
                header.addEventListener('touchstart', start, { passive: false });
            }
            ['contextmenu', 'selectstart', 'dragstart'].forEach(function(type) {
                header.addEventListener(type, function(event) { event.preventDefault(); });
            });
            header.addEventListener('dblclick', function(event) {
                if (manager.is_compact() || (event.target && event.target.closest && event.target.closest('button, input, textarea, select, a, label'))) {
                    return;
                }
                event.preventDefault();
                manager.maximize(record);
            });
        };

        DesktopWindowManager.prototype.bind_resize_handle = function(record, handle, edge) {
            var manager = this;
            function start(event) {
                if (!is_primary_event(event)) {
                    return;
                }
                manager.begin_interaction(record, event, 'resize', edge);
            }
            if (this.supports_pointer) {
                handle.addEventListener('pointerdown', start);
            } else {
                handle.addEventListener('mousedown', start);
                handle.addEventListener('touchstart', start, { passive: false });
            }
        };

        DesktopWindowManager.prototype.setup_resize_handles = function(record) {
            var edges = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
            for (var i = 0; i < edges.length; i++) {
                var edge = edges[i];
                var handle = create_element('div', 'fm-window-resize fm-window-resize-' + edge);
                handle.setAttribute('aria-hidden', 'true');
                record.element.appendChild(handle);
                this.bind_resize_handle(record, handle, edge);
            }
        };

        DesktopWindowManager.prototype.begin_interaction = function(record, event, kind, edge) {
            if (!record || record.closed || record.minimized) {
                return;
            }
            if (event.cancelable) {
                event.preventDefault();
            }
            if (this.supports_pointer && event.currentTarget && event.currentTarget.setPointerCapture &&
                    event.pointerId !== undefined) {
                try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) {}
            }
            this.focus(record);
            var manager = this;
            var interaction_target = event.currentTarget;
            var start_point = point_from_event(event);
            var interaction_moved = false;
            var start_rect = this.get_rect(record);
            var original_maximized = record.maximized;
            if (original_maximized && kind === 'drag') {
                this.restore_size(record);
                start_rect = this.get_rect(record);
                start_rect.left = Math.max(8, start_point.x - Math.min(start_rect.width * 0.45, 180));
                start_rect.top = Math.max(8, start_point.y - 20);
                this.apply_rect(record, start_rect);
                start_rect = this.get_rect(record);
            }
            if (original_maximized && kind === 'resize') {
                this.restore_size(record);
                start_rect = this.get_rect(record);
            }
            document.body.classList.add(kind === 'drag' ? 'fm-window-dragging' : 'fm-window-resizing');

            var move_event = this.supports_pointer ? 'pointermove' : (event.type.indexOf('touch') === 0 ? 'touchmove' : 'mousemove');
            var end_event = this.supports_pointer ? 'pointerup' : (event.type.indexOf('touch') === 0 ? 'touchend' : 'mouseup');
            var cancel_event = this.supports_pointer ? 'pointercancel' : (event.type.indexOf('touch') === 0 ? 'touchcancel' : null);

            function stop() {
                document.removeEventListener(move_event, move, false);
                document.removeEventListener(end_event, stop, false);
                if (cancel_event) {
                    document.removeEventListener(cancel_event, stop, false);
                }
                document.body.classList.remove('fm-window-dragging', 'fm-window-resizing');
                if (manager.supports_pointer && interaction_target && interaction_target.releasePointerCapture &&
                        event.pointerId !== undefined) {
                    try { interaction_target.releasePointerCapture(event.pointerId); } catch (error) {}
                }
                record.rect = manager.get_rect(record);
                if (kind === 'drag' && !interaction_moved) {
                    manager.reveal_for_page_operation();
                }
                if (kind === 'resize') {
                    manager.persist_size(record);
                }
            }

            function move(move_event_object) {
                if (move_event_object.cancelable) {
                    move_event_object.preventDefault();
                }
                var current = point_from_event(move_event_object);
                var dx = current.x - start_point.x;
                var dy = current.y - start_point.y;
                if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                    interaction_moved = true;
                }
                if (kind === 'drag') {
                    manager.apply_rect(record, {
                        left: start_rect.left + dx,
                        top: start_rect.top + dy,
                        width: start_rect.width,
                        height: start_rect.height
                    });
                    return;
                }

                var area = manager.work_area();
                var margin = manager.is_compact() ? 4 : 8;
                var max_width = Math.max(180, area.width - margin * 2);
                var max_height = Math.max(110, area.height - margin * 2);
                var min_width = manager.min_width(record, max_width);
                var min_height = manager.min_height(record, max_height);
                var next = {
                    left: start_rect.left,
                    top: start_rect.top,
                    width: start_rect.width,
                    height: start_rect.height
                };
                if (edge.indexOf('e') >= 0) {
                    next.width = clamp(start_rect.width + dx, min_width, area.width - margin - start_rect.left);
                }
                if (edge.indexOf('w') >= 0) {
                    next.left = clamp(start_rect.left + dx, margin, start_rect.left + start_rect.width - min_width);
                    next.width = start_rect.left + start_rect.width - next.left;
                }
                if (edge.indexOf('s') >= 0) {
                    next.height = clamp(start_rect.height + dy, min_height, area.height - margin - start_rect.top);
                }
                if (edge.indexOf('n') >= 0) {
                    next.top = clamp(start_rect.top + dy, margin, start_rect.top + start_rect.height - min_height);
                    next.height = start_rect.top + start_rect.height - next.top;
                }
                manager.apply_rect(record, next);
            }

            document.addEventListener(move_event, move, { passive: false });
            document.addEventListener(end_event, stop, false);
            if (cancel_event) {
                document.addEventListener(cancel_event, stop, false);
            }
        };

        DesktopWindowManager.prototype.install_record = function(element, options) {
            var manager = this;
            var record = {
                id: 'fm_window_' + this.next_id++,
                sequence: this.next_id,
                element: element,
                options: options || {},
                legacy: !!options.legacy,
                display_mode: options.displayMode || 'flex',
                minimized: false,
                maximized: false,
                closed: false,
                initialized: false,
                rect: null,
                restore_rect: null,
                before_close: options.beforeClose || null,
                on_close: options.onClose || null,
                icon: options.icon || 'file',
                title_node: options.titleNode || null
            };
            element._fmWindow = record;
            element.setAttribute('data-window-id', record.id);
            element.setAttribute('aria-modal', 'false');
            element.classList.add('fm-window-managed');
            element.addEventListener(this.supports_pointer ? 'pointerdown' : 'mousedown', function() {
                manager.focus(record);
            });
            if (!this.supports_pointer) {
                element.addEventListener('touchstart', function() { manager.focus(record); }, { passive: true });
            }
            this.setup_resize_handles(record);
            this.records.push(record);
            return record;
        };

        DesktopWindowManager.prototype.create = function(options) {
            options = options || {};
            var element = create_element('section', 'fm-desktop-window' + (options.className ? ' ' + options.className : ''));
            element.setAttribute('role', 'dialog');
            var header = create_element('div', 'fm-window-titlebar');
            var title = create_element('div', 'fm-window-title', options.title || '');
            header.appendChild(title);
            element.appendChild(header);
            var body = create_element('div', 'fm-window-body');
            if (options.content) {
                body.appendChild(options.content);
            }
            element.appendChild(body);
            element.style.display = 'none';
            document.body.appendChild(element);
            options.titleNode = title;
            options.displayMode = 'flex';
            options.legacy = false;
            var record = this.install_record(element, options);
            this.setup_controls(record, header, null);
            this.bind_drag(record, header);
            this.show(record, true);
            return record;
        };

        DesktopWindowManager.prototype.open_legacy = function(element, display_mode) {
            if (!element) {
                return null;
            }
            var record = element._fmWindow;
            if (!record) {
                var header = element.querySelector('.fm-dialog-header');
                record = this.install_record(element, {
                    legacy: true,
                    displayMode: display_mode || 'flex',
                    icon: 'file',
                    titleNode: header ? header.querySelector('.fm-dialog-title') : null,
                    minWidth: 260,
                    minHeight: 140,
                    persistSize: false
                });
                if (header) {
                    header.classList.add('fm-window-titlebar');
                    this.setup_controls(record, header, header.querySelector('.fm-dialog-close'));
                    this.bind_drag(record, header);
                }
            }
            record.display_mode = display_mode || record.display_mode || 'flex';
            record.closed = false;
            record.minimized = false;
            this.show(record, !record.initialized);
            return record;
        };

        DesktopWindowManager.prototype.show = function(record, first_open) {
            if (!record) {
                return;
            }
            record.closed = false;
            record.minimized = false;
            record.element.style.display = record.display_mode || 'flex';
            if (!record.initialized || first_open) {
                record.initialized = true;
                this.apply_rect(record, this.initial_rect(record));
            } else if (record.maximized) {
                var area = this.work_area();
                var margin = this.is_compact() ? 4 : 8;
                this.apply_rect(record, {
                    left: margin,
                    top: margin,
                    width: area.width - margin * 2,
                    height: area.height - margin * 2
                });
            } else {
                this.apply_rect(record, record.rect || this.initial_rect(record));
            }
            this.focus(record);
        };

        DesktopWindowManager.prototype.title_for = function(record) {
            var title = record.title_node ? String(record.title_node.textContent || '').replace(/^\s+|\s+$/g, '') : '';
            return title || this.caption('file', 'Window');
        };

        DesktopWindowManager.prototype.render_taskbar = function() {
            var manager = this;
            while (this.taskbar_list.firstChild) {
                this.taskbar_list.removeChild(this.taskbar_list.firstChild);
            }
            var visible_records = this.records.filter(function(record) { return !record.closed; });
            this.taskbar.classList.toggle('is-empty', !visible_records.length);
            if (!visible_records.length) {
                this.taskbar.classList.remove('is-revealed');
            }
            this.refresh_taskbar_pill();
            visible_records.forEach(function(record) {
                var title = manager.title_for(record);
                var button = create_element('button', 'fm-window-task' +
                    (record === manager.active && !record.minimized ? ' is-active' : '') +
                    (record.minimized ? ' is-minimized' : ''));
                button.type = 'button';
                button.setAttribute('title', title + (record.minimized ? ' (' + manager.caption('restore_window', 'Restore') + ')' : ''));
                button.setAttribute('aria-label', title);
                var image = create_element('img', 'fm-window-task-icon');
                image.src = typeof HF.icon_url === 'function' ? HF.icon_url(record.icon || 'file') : '';
                image.alt = '';
                var fallback = create_element('span', 'fm-window-task-fallback', title.charAt(0).toUpperCase() || '•');
                fallback.style.display = 'none';
                image.onerror = function() {
                    this.style.display = 'none';
                    fallback.style.display = 'inline-flex';
                };
                button.appendChild(image);
                button.appendChild(fallback);
                button.appendChild(create_element('span', 'fm-window-task-label', title));
                button.addEventListener('click', function() {
                    if (record.minimized) {
                        manager.restore(record);
                    } else {
                        manager.focus(record);
                    }
                });
                manager.taskbar_list.appendChild(button);
            });
        };

        DesktopWindowManager.prototype.sync_legacy_windows = function() {
            var changed = false;
            this.records.forEach(function(record) {
                if (!record.legacy || record.closed || record.minimized) {
                    return;
                }
                if (record.element.style.display === 'none') {
                    record.closed = true;
                    changed = true;
                }
            });
            if (changed) {
                if (this.active && this.active.closed) {
                    this.active = null;
                }
                this.render_taskbar();
            }
        };

        DesktopWindowManager.prototype.close_all_legacy = function() {
            var changed = false;
            this.records.forEach(function(record) {
                if (record.legacy && !record.closed) {
                    record.closed = true;
                    record.minimized = false;
                    record.element.style.display = 'none';
                    changed = true;
                }
            });
            if (this.active && this.active.legacy) {
                this.active = null;
            }
            if (changed) {
                this.render_taskbar();
            }
        };

        DesktopWindowManager.prototype.bind_viewport_events = function() {
            var manager = this;
            var refresh = function() {
                manager.records.forEach(function(record) {
                    if (record.closed || record.minimized) {
                        return;
                    }
                    if (record.maximized) {
                        var area = manager.work_area();
                        var margin = manager.is_compact() ? 4 : 8;
                        manager.apply_rect(record, {
                            left: margin,
                            top: margin,
                            width: area.width - margin * 2,
                            height: area.height - margin * 2
                        });
                    } else {
                        manager.apply_rect(record, record.rect || manager.get_rect(record));
                    }
                });
            };
            window.addEventListener('resize', refresh);
            window.addEventListener('orientationchange', function() { window.setTimeout(refresh, 80); });
        };

        return new DesktopWindowManager();
    })();
    HF.WindowManager = HF.window_manager;
    HF.WindowManager.openLegacy = HF.window_manager.open_legacy;
})(window.HarborFile = window.HarborFile || {});
