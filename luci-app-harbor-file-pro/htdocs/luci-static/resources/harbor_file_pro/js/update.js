/* HarborFile update.js -- in-app updater (check / download / install) */
(function (HF) {
    'use strict';

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
        HF.request_write(HF.api.update_start, {}, '', function(data) {
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
})(window.HarborFile = window.HarborFile || {});
