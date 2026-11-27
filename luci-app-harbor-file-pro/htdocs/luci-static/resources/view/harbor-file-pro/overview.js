// Harbor File Pro overview view
// status, quick actions, health summary and in-card updates
'use strict';
'require view';
'require ui';
'require poll';
'require harbor.common as harbor';

var Rpc = null, Fmt = null, UI = null;
var state = null;
var statusTimer = null;
var updateCards = {};

function t(s) { return _(s); }

function pillFor(st) {
    if (!st || !st.installed) return [t('Not installed'), 'off'];
    if (!st.health) return [t('Stopped'), 'err'];
    if (st.health.status === 'ok') return [t('Running'), 'ok'];
    return [t('Running'), 'ok'];
}

function setBusy(area, busy, label) {
    if (!area) return;
    area.dataset.harborBusy = busy ? '1' : '0';
    area.querySelectorAll('button').forEach(function(b) { b.disabled = busy; });
    area.querySelectorAll('button.harbor-ib').forEach(function(b) { UI.setBusy(b, busy); });
    if (!busy) updateActionButtons(state);
    var lamp = area.querySelector('.harbor-busy');
    if (lamp) lamp.remove();
    if (busy) {
        var span = E('span', { 'class': 'harbor-busy harbor-row' }, [
            E('i', { 'class': 'harbor-breath' }),
            E('span', {}, label || t('Working…'))
        ]);
        area.appendChild(span);
    }
}

function waitForState(wantRunning, area, label, oldPid) {
    var started = Date.now();
    return new Promise(function(resolve) {
        var tick = function() {
            Rpc.status().then(function(st) {
                state = st;
                renderStatus(st);
                var done = wantRunning === null ? true : (!!st.running === wantRunning && (wantRunning ? !!st.health : true));
                if (oldPid && st.pid === oldPid) done = false;
                if (done || Date.now() - started > 60000) {
                    setBusy(area, false);
                    if (!done) UI.note(area.querySelector('.harbor-action-note'), 'err', t('Action failed'));
                    resolve(st);
                } else {
                    setTimeout(tick, 3000);
                }
            }).catch(function() {
                if (Date.now() - started > 60000) { setBusy(area, false); UI.note(area.querySelector('.harbor-action-note'), 'err', t('Action failed')); resolve(state); }
                else setTimeout(tick, 3000);
            });
        };
        setTimeout(tick, 3000);
    });
}

function refreshStatusDelayed() {
    [3000, 6000, 9000].forEach(function(delay) {
        setTimeout(function() {
            Rpc.status().then(renderStatus).catch(function() {});
        }, delay);
    });
}

function doAction(action, area) {
    var labels = { start: t('Starting…'), stop: t('Stopping…'), restart: t('Restarting…') };
    setBusy(area, true, labels[action] || t('Working…'));
    Rpc.action(action).then(function(r) {
        if (!r || !r.ok) {
            setBusy(area, false);
            var note = area.querySelector('.harbor-action-note');
            UI.note(note, 'err', t('Action failed'));
            return;
        }
        var want = action === 'stop' ? false : true;
        waitForState(want, area, labels[action], action === 'restart' && state ? state.pid : null);
    }).catch(function() {
        setBusy(area, false);
        UI.note(area.querySelector('.harbor-action-note'), 'err', t('Action failed'));
    });
}

function showInitAccount() {
    var userInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'autocomplete': 'off' });
    var passInput = E('input', { 'class': 'cbi-input-password', 'type': 'password', 'autocomplete': 'new-password' });
    var confirmInput = E('input', { 'class': 'cbi-input-password', 'type': 'password', 'autocomplete': 'new-password' });
    var note = E('div', { 'class': 'harbor-meta' });
    var body = E('div', {}, [
        E('p', {}, t('Set the administrator account for the Harbor web panel.')),
        E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, t('Username')), E('div', { 'class': 'cbi-value-field' }, userInput) ]),
        E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, t('Password')), E('div', { 'class': 'cbi-value-field' }, passInput) ]),
        E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, t('Confirm password')), E('div', { 'class': 'cbi-value-field' }, confirmInput) ]),
        note,
        E('div', { 'class': 'right' }, [
            E('button', { 'class': 'btn', 'click': function() { ui.hideModal(); } }, t('Cancel')),
            ' ',
            E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': function(ev) {
                var btn = ev.currentTarget;
                if (passInput.value !== confirmInput.value) {
                    UI.note(note, 'err', t('Passwords do not match'));
                    return;
                }
                btn.disabled = true;
                UI.note(note, '', t('Initializing…'));
                var started = Date.now();
                function showFailure(r) {
                    btn.disabled = false;
                    UI.note(note, 'err', (r && r.error === 'invalid_username') ? t('Invalid username') :
                        (r && r.error === 'invalid_password') ? t('Password must be 6–128 characters') : t('Initialization failed'));
                }
                function waitForInit() {
                    Rpc.initAccountStatus().then(function(r) {
                        if (r && r.pending) {
                            if (Date.now() - started < 600000) setTimeout(waitForInit, 3000);
                            else {
                                btn.disabled = false;
                                UI.note(note, 'err', t('Initialization is still running. Check the service status later.'));
                            }
                            return;
                        }
                        if (r && r.ok) {
                            passInput.value = '';
                            ui.hideModal();
                            refreshStatusDelayed();
                            return;
                        }
                        showFailure(r);
                    }).catch(function() {
                        if (Date.now() - started < 600000) setTimeout(waitForInit, 3000);
                        else { btn.disabled = false; UI.note(note, 'err', t('Initialization is still running. Check the service status later.')); }
                    });
                }
                Rpc.initAccount(userInput.value.trim(), passInput.value).then(function(r) {
                    if (r && r.ok && r.pending) { passInput.value = ''; setTimeout(waitForInit, 3000); return; }
                    showFailure(r);
                }).catch(function() {
                    btn.disabled = false;
                    UI.note(note, 'err', t('Initialization status is unknown. Check the service status before retrying.'));
                });
            } }, t('Initialize and start'))
        ])
    ]);
    UI.fixLabelTargets(body);
    ui.showModal(t('Set up administrator account'), body);
}

function confirmDialog(title, text, actionLabel, onOk) {
    var note = E('div', { 'class': 'harbor-meta' });
    ui.showModal(title, E('div', {}, [
        E('p', {}, text),
        note,
        E('div', { 'class': 'right' }, [
            E('button', { 'class': 'btn', 'click': function() { ui.hideModal(); } }, t('Cancel')),
            ' ',
            E('button', { 'class': 'btn cbi-button cbi-button-negative', 'click': function(ev) {
                var btn = ev.currentTarget;
                btn.disabled = true;
                onOk(note, function() { btn.disabled = false; });
            } }, actionLabel)
        ])
    ]));
}

function buildUpdateCard(project, title) {
    var refs = {
        pill: UI.pill(t('Not checked'), 'off'),
        version: E('div', { 'class': 'harbor-version' }, '—'),
        meta: E('div', { 'class': 'harbor-meta' }, ''),
        fileSel: E('select', { 'class': 'cbi-input-select' }),
        note: E('div', { 'class': 'harbor-meta', 'style': 'min-height:18px;margin-top:6px' }),
        progress: UI.progress(),
        releases: []
    };
    refs.fileSel.disabled = true;
    refs.fileRow = E('div', { 'class': 'harbor-file-row', 'style': 'display:none' }, [ E('label', {}, t('Release file')), refs.fileSel ]);
    var checkBtn = UI.iconActionButton('refresh', t('Check'), function() { checkUpdate(project, true); }, { anim: 'rotate' });
    var updateBtn = UI.iconButton('download', t('Update'), function() { startUpdate(project); }, true);
    refs.checkBtn = checkBtn;
    refs.updateBtn = updateBtn;
    refs.el = E('div', { 'class': 'cbi-section harbor-card' }, [
        E('h3', {}, title),
        E('div', {}, [
            E('div', { 'class': 'harbor-vercard-top' }, [ refs.pill ]),
            refs.version,
            refs.meta,
            refs.fileRow,
            E('div', { 'class': 'harbor-file-row' }, [ checkBtn, updateBtn ]),
            refs.note,
            refs.progress
        ])
    ]);
    updateCards[project] = refs;
    return refs.el;
}

function fillUpdateCard(project, res, currentOverride) {
    var refs = updateCards[project];
    if (!refs) return;
    var current = currentOverride != null ? currentOverride : (res && res.current) || '';
    if (project === 'harbor-core' && state) current = state.version || current;
    if (project === 'luci-app-harbor-file-pro' && state) current = state.luci_version || current;
    refs.version.textContent = current ? 'v' + Fmt.version(current) : '—';
    var releases = (res && res.releases) || [];
    refs.releases = releases;
    refs.fileSel.innerHTML = '';
    if (!releases.length) {
        refs.fileSel.disabled = true;
        refs.updateBtn.disabled = true;
        refs.fileRow.style.display = 'none';
        UI.setPill(refs.pill, t('Check failed'), 'err');
        refs.meta.textContent = t('Unable to fetch release information');
        return;
    }
    var latest = releases[0];
    var files = latest.files || [];
    files.forEach(function(f) {
        refs.fileSel.appendChild(E('option', { 'value': f.name }, f.name));
    });
    refs.fileSel.disabled = !files.length;
    var detected = latest.detectedFile || '';
    if (detected) {
        for (var i = 0; i < refs.fileSel.options.length; i++) {
            if (refs.fileSel.options[i].value === detected) { refs.fileSel.selectedIndex = i; break; }
        }
    }
    var latestVer = Fmt.version(latest.tag || latest.version || '');
    var hasNew = current && latestVer && Fmt.isNewer(latestVer, Fmt.version(current));
    UI.setPill(refs.pill, !current ? t('Not installed') : hasNew ? t('Update available') : t('Up to date'), !current ? 'off' : hasNew ? 'warn' : 'ok');
    refs.meta.textContent = current ? (t('Latest') + ' v' + latestVer + (hasNew ? '' : ' · ' + t('Up to date'))) : (t('Latest') + ' v' + latestVer);
    var showRelease = files.length > 0 && (!current || hasNew);
    refs.fileRow.style.display = showRelease ? '' : 'none';
    refs.fileSel.disabled = !showRelease;
    refs.updateBtn.disabled = !showRelease;
}

function finishCheck(project, res) {
    var refs = updateCards[project];
    if (!refs) return;
    refs.checkBtn.disabled = false;
    refs.checkResult = res;
    fillUpdateCard(project, res);
    UI.note(refs.note, res && res.ok ? 'ok' : 'err', res && res.ok ? t('Check complete') : t('Check failed'));
}

function failCheck(project) {
    var refs = updateCards[project];
    if (!refs) return;
    refs.checkBtn.disabled = false;
    refs.updateBtn.disabled = true;
    refs.fileSel.disabled = true;
    refs.fileRow.style.display = 'none';
    UI.setPill(refs.pill, t('Check failed'), 'err');
    UI.note(refs.note, 'err', t('Check failed'));
}

function pollCheck(project, attempts, started) {
    started = started || Date.now();
    if (Date.now() - started > 480000) { failCheck(project); return; }
    var refs = updateCards[project];
    if (!refs) return;
    Rpc.getUpdateStatus(project).then(function(r) {
        var status = (r && r.status) || '';
        if (status === 'checking' || status === 'downloading' || status === 'installing' || status.indexOf('downloading:') === 0) {
            UI.note(refs.note, '', t('Checking for updates…'));
            setTimeout(function() { pollCheck(project, attempts, started); }, 3000);
            return;
        }
        if (status.indexOf('ready:') === 0 || status.indexOf('done') === 0) {
            Rpc.getUpstreamVersion(project, '', false).then(function(res) {
                if (res && res.pending) {
                    setTimeout(function() { pollCheck(project, attempts, started); }, 3000);
                    return;
                }
                finishCheck(project, res);
            }).catch(function() { failCheck(project); });
            return;
        }
        if (status.indexOf('error') === 0) {
            failCheck(project);
            return;
        }
        if ((attempts || 0) < 5) {
            setTimeout(function() { pollCheck(project, (attempts || 0) + 1, started); }, 3000);
            return;
        }
        failCheck(project);
    }).catch(function() {
        if ((attempts || 0) < 5)
            setTimeout(function() { pollCheck(project, (attempts || 0) + 1, started); }, 3000);
        else
            failCheck(project);
    });
}

function checkUpdate(project, force) {
    var refs = updateCards[project];
    if (!refs) return Promise.resolve();
    UI.note(refs.note, '', t('Checking for updates…'));
    refs.checkBtn.disabled = true;
    refs.updateBtn.disabled = true;
    refs.fileSel.disabled = true;
    refs.fileRow.style.display = 'none';
    return Rpc.getUpstreamVersion(project, '', !!force).then(function(res) {
        if (res && res.pending) {
            pollCheck(project, 0);
            return;
        }
        finishCheck(project, res);
    }).catch(function() {
        failCheck(project);
    });
}

function startUpdate(project) {
    var refs = updateCards[project];
    var latest = refs.releases[0];
    var filename = refs.fileSel.value;
    if (!latest || !filename) return;
    var tag = latest.tag || latest.version || '';
    refs.updateBtn.disabled = true;
    refs.checkBtn.disabled = true;
    UI.note(refs.note, '', t('Updating, please do not close this page…'));
    Rpc.doUpdate(project, tag, filename).then(function(r) {
        if (!r || !r.ok) {
            refs.updateBtn.disabled = false;
            refs.checkBtn.disabled = false;
            UI.note(refs.note, 'err', r && r.error ? r.error : t('Failed to start update'));
            return;
        }
        refs.taskId = r.task_id || r.job_id || '';
        pollUpdate(project);
    }).catch(function() {
        refs.updateBtn.disabled = false;
        refs.checkBtn.disabled = false;
        UI.note(refs.note, 'err', t('Failed to start update'));
    });
}

function pollUpdate(project) {
    var refs = updateCards[project];
    Rpc.getUpdateStatus(project, refs.taskId || '').then(function(r) {
        if (!r || !r.ok) {
            refs.checkBtn.disabled = false;
            refs.updateBtn.disabled = refs.fileRow.style.display === 'none' || !refs.fileSel.value;
            UI.note(refs.note, 'err', t('Failed to query update status'));
            return;
        }
        var status = r.status || '';
        var pct = 0;
        var m = status.match(/^downloading:(-?\d+):/) || status.match(/^progress:(\d+)$/);
        if (m) pct = parseInt(m[1]);
        else if (status.indexOf('done') === 0) pct = 100;
        UI.setProgress(refs.progress, pct);
        var log = (r && r.log) || [];
        if (log.length) refs.note.textContent = log[log.length - 1];
        refs.note.style.color = 'var(--harbor-muted)';
        if (status.indexOf('done') === 0) {
            UI.note(refs.note, 'ok', t('Update complete'));
            refs.updateBtn.disabled = false;
            refs.checkBtn.disabled = false;
            Rpc.status().then(function(st) {
                state = st;
                renderStatus(st);
                checkUpdate(project, false);
                if (project === 'luci-app-harbor-file-pro')
                    setTimeout(function() { window.location.reload(); }, 3000);
            });
            return;
        }
        if (status.indexOf('error') === 0) {
            UI.note(refs.note, 'err', status);
            refs.updateBtn.disabled = refs.fileRow.style.display === 'none' || !refs.fileSel.value;
            refs.checkBtn.disabled = false;
            return;
        }
        setTimeout(function() { pollUpdate(project); }, 1000);
    }).catch(function() {
        setTimeout(function() { pollUpdate(project); }, 1000);
    });
}

var refs = {};

function updateActionButtons(st) {
    if (!refs.actionArea || refs.actionArea.dataset.harborBusy === '1') return;
    var unavailable = !st || !st.installed;
    refs.startBtn.disabled = unavailable || !!st.running;
    refs.stopBtn.disabled = unavailable || !st.running;
    refs.restartBtn.disabled = unavailable || !st.running;
}

function renderStatus(st) {
    if (!st) { updateActionButtons(null); return; }
    state = st;
    var p = pillFor(st);
    UI.setPill(refs.statusPill, p[0], p[1]);
    refs.bannerWarn.style.display = 'none';
    refs.bannerSetup.style.display = 'none';
    if (!st.installed) {
        refs.bannerWarn.style.display = '';
        refs.bannerWarn.textContent = t('Core not installed. Download and install it from the core version card below.');
    } else if (st.account && st.account.needs_setup) {
        refs.bannerSetup.style.display = '';
    }
    refs.healthStat.textContent = st.health ? (st.health.status || 'ok') : '—';
    refs.healthSub.textContent = st.health ? (t('Running %(time)s').replace('%(time)s', Fmt.uptime(st.health.uptime)) + ' · ' + t('Version') + ' ' + (st.health.version || '')) : t('No data');
    refs.accountStat.textContent = !st.account ? '—' : st.account.needs_setup ? t('Not initialized') : (st.account.username || '');
    refs.accountSub.textContent = !st.account ? t('No data') : st.account.needs_setup ? t('Set an administrator account first') : (st.account.totp_enabled ? t('Initialized · 2FA enabled') : t('Initialized · 2FA disabled'));
    refs.accessStat.textContent = !st.installed ? '—' : st.wan_actual ? t('LAN + WAN') : t('LAN only');
    refs.accessSub.textContent = !st.installed ? t('No data') : st.wan_actual ? t('Reachable from WAN') : t('LAN only');
    refs.versionStat.textContent = st.version ? 'v' + Fmt.version(st.version) : '—';
    refs.versionSub.textContent = st.installed ? (t('LuCI package') + ' ' + (st.luci_version ? 'v' + Fmt.version(st.luci_version) : '—')) : t('Not installed');
    var addr = Fmt.joinUrl(window.location.hostname, st.port);
    refs.panelLink.href = addr;
    refs.kvListen.textContent = (st.listen || '') + ':' + (st.port || '');
    refs.kvAddress.textContent = addr;
    refs.kvWan.textContent = st.wan_actual ? t('Allowed') : t('Not allowed');
    var pol = st.service_info && st.service_info.root_policy;
    refs.kvPolicy.textContent = pol === 'allowlist' ? t('Whitelist') :
        pol === 'denylist' ? t('Blacklist') :
        pol === 'unrestricted' ? t('Unrestricted') : '—';
    refs.kvAccount.textContent = !st.account ? '—' : st.account.needs_setup ? t('Not initialized') : (st.account.username || '');
    refs.kvVersion.textContent = st.version ? 'v' + Fmt.version(st.version) : '—';
    refs.openBtn.disabled = !st.installed || !st.running;
    updateActionButtons(st);
    Object.keys(updateCards).forEach(function(project) {
        var card = updateCards[project];
        if (card && card.checkResult && !card.checkBtn.disabled)
            fillUpdateCard(project, card.checkResult);
    });
}

function clearLogs() {
    refs.clearLogsBtn.disabled = true;
    Rpc.clearLogs().then(function(r) {
        if (!r || !r.ok) throw new Error('log_clear_failed');
        refs.logBody.textContent = t('No logs');
        refs.logNote.textContent = t('Logs cleared');
    }).catch(function() {
        refs.logNote.textContent = t('Failed to clear logs');
    }).finally(function() { refs.clearLogsBtn.disabled = false; });
}

function loadLogs() {
    refs.logNote.textContent = t('Loading…');
    Rpc.logs(200).then(function(r) {
        if (!r || !r.ok) throw new Error('log_fetch_failed');
        var lines = ((r && r.lines) || []).filter(function(line) { return String(line || '').trim() !== ''; });
        refs.logBody.textContent = lines.length ? lines.join('\n') : t('No logs');
        refs.logNote.textContent = '';
    }).catch(function() {
        refs.logBody.textContent = '';
        refs.logNote.textContent = t('Failed to load logs');
    });
}

return view.extend({
    load: function() {
        Rpc = harbor.HarborRpc; Fmt = harbor.HarborFormat; UI = harbor.HarborUI;
        return null;
    },

    render: function() {
        refs.statusPill = UI.pill(t('loading…'), 'off');
        refs.bannerWarn = E('div', { 'class': 'harbor-alert warn', 'style': 'display:none' });
        refs.bannerSetup = E('div', { 'class': 'harbor-alert warn', 'style': 'display:none' }, [
            E('span', {}, t('Administrator account is not initialized yet. ')),
            E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': showInitAccount }, t('Set up now'))
        ]);
        refs.panelLink = E('a', { 'href': '#', 'target': '_blank', 'rel': 'noopener' }, t('Open web panel'));
        refs.openBtn = UI.iconButton('open', t('Open web panel'), function() {
            window.open(Fmt.joinUrl(window.location.hostname, state ? state.port : 9700), '_blank', 'noopener');
        }, true);
        refs.healthStat = E('div', { 'class': 'v' }, '—');
        refs.healthSub = E('div', { 'class': 's' }, '');
        refs.accountStat = E('div', { 'class': 'v' }, '—');
        refs.accountSub = E('div', { 'class': 's' }, '');
        refs.accessStat = E('div', { 'class': 'v' }, '—');
        refs.accessSub = E('div', { 'class': 's' }, '');
        refs.versionStat = E('div', { 'class': 'v' }, '—');
        refs.versionSub = E('div', { 'class': 's' }, '');
        refs.kvListen = E('dd', {});
        refs.kvAddress = E('dd', {});
        refs.kvWan = E('dd', {});
        refs.kvPolicy = E('dd', {});
        refs.kvAccount = E('dd', {});
        refs.kvVersion = E('dd', {});
        refs.logBody = E('pre', { 'class': 'harbor-log' }, '');
        refs.logNote = E('span', { 'class': 'harbor-meta' });

        var actionArea = refs.actionArea = E('div', { 'class': 'harbor-row' }, [
            refs.startBtn = UI.iconActionButton('start', t('Start'), function() { doAction('start', actionArea); }, { tone: 'green', anim: 'play' }),
            refs.stopBtn = UI.iconActionButton('stop', t('Stop'), function() { doAction('stop', actionArea); }, { anim: 'stop' }),
            refs.restartBtn = UI.iconActionButton('restart', t('Restart'), function() { doAction('restart', actionArea); }, { tone: 'blue', anim: 'rotate' }),
            E('span', { 'class': 'harbor-action-note harbor-meta' })
        ]);

        var dangerArea = E('div', {}, [
            E('div', { 'class': 'harbor-row' }, [
                E('button', { 'class': 'btn cbi-button cbi-button-negative', 'click': function() {
                    confirmDialog(t('Reset authentication'), t('This clears the administrator password and 2FA. You will need to set up the account again. Continue?'), t('Reset'), function(note, done) {
                        Rpc.action('reset_auth').then(function(r) {
                            ui.hideModal();
                            if (r && r.ok) { refreshStatusDelayed(); return; }
                            UI.note(note, 'err', t('Action failed'));
                            done();
                        }).catch(function() { UI.note(note, 'err', t('Action failed')); done(); });
                    });
                } }, t('Reset authentication')),
                E('button', { 'class': 'btn cbi-button cbi-button-negative', 'click': function() {
                    confirmDialog(t('Uninstall core'), t('This stops the service and removes the core binary. Configuration and data are kept. Continue?'), t('Uninstall'), function(note, done) {
                        Rpc.action('uninstall_core').then(function(r) {
                            ui.hideModal();
                            if (r && r.ok) { refreshStatusDelayed(); return; }
                            UI.note(note, 'err', t('Action failed'));
                            done();
                        }).catch(function() { UI.note(note, 'err', t('Action failed')); done(); });
                    });
                } }, t('Uninstall core'))
            ])
        ]);

        var page = E('div', {}, [
            E('div', { 'class': 'harbor-head' }, [
                E('div', {}, [
                    E('h2', {}, t('Harbor File Pro')),
                    E('div', { 'class': 'harbor-meta' }, t('Lightweight file server · WebDAV / S3'))
                ]),
                E('div', { 'class': 'harbor-head-actions' }, [ refs.openBtn, UI.themeButton() ])
            ]),
            refs.bannerWarn,
            refs.bannerSetup,
            UI.card(t('Service status'), [
                E('div', { 'class': 'harbor-row', 'style': 'margin-bottom:12px' }, [ refs.statusPill ]),
                actionArea,
                E('div', { 'class': 'harbor-grid', 'style': 'margin-top:14px' }, [
                    E('div', { 'class': 'harbor-stat' }, [ E('div', { 'class': 'k' }, t('Health')), refs.healthStat, refs.healthSub ]),
                    E('div', { 'class': 'harbor-stat' }, [ E('div', { 'class': 'k' }, t('Account')), refs.accountStat, refs.accountSub ]),
                    E('div', { 'class': 'harbor-stat' }, [ E('div', { 'class': 'k' }, t('Access scope')), refs.accessStat, refs.accessSub ]),
                    E('div', { 'class': 'harbor-stat' }, [ E('div', { 'class': 'k' }, t('Core version')), refs.versionStat, refs.versionSub ])
                ]),
                E('dl', { 'class': 'harbor-kv' }, [
                    E('dt', {}, t('Listen')), refs.kvListen,
                    E('dt', {}, t('Panel address')), refs.kvAddress,
                    E('dt', {}, t('WAN access')), refs.kvWan,
                    E('dt', {}, t('Root policy')), refs.kvPolicy,
                    E('dt', {}, t('Account')), refs.kvAccount,
                    E('dt', {}, t('Core version')), refs.kvVersion
                ])
            ]),
            E('div', { 'class': 'harbor-vergrid' }, [
                buildUpdateCard('harbor-core', t('Core version')),
                buildUpdateCard('luci-app-harbor-file-pro', t('LuCI package'))
            ]),
            UI.card(t('Recent logs'), [
                E('div', { 'class': 'harbor-row', 'style': 'margin-bottom:10px' }, [
                    UI.iconActionButton('refresh', t('Refresh logs'), loadLogs, { anim: 'rotate' }),
                    refs.clearLogsBtn = UI.iconActionButton('trash', t('Clear logs'), clearLogs, { tone: 'red', anim: 'wiggle' }),
                    refs.logNote
                ]),
                refs.logBody
            ]),
            E('div', { 'class': 'cbi-section harbor-card harbor-danger-card' }, [
                E('h3', {}, t('Danger zone')),
                dangerArea
            ])
        ]);

        updateActionButtons(null);
        Rpc.status().then(renderStatus).catch(function() {
            UI.setPill(refs.statusPill, t('Failed'), 'err');
        });
        loadLogs();
        Rpc.getUpdateStatus('harbor-core', 'last').then(function(r) {
            if (r && r.ok && (r.state === 'queued' || r.state === 'running')) {
                var card = updateCards['harbor-core'];
                card.taskId = r.task_id;
                card.checkBtn.disabled = true;
                card.updateBtn.disabled = true;
                UI.note(card.note, '', t('Updating, please do not close this page…'));
                pollUpdate('harbor-core');
            } else if (r && r.ok && r.state === 'failed') {
                var failedCard = updateCards['harbor-core'];
                UI.note(failedCard.note, 'err', r.status || t('Update failed'));
            } else {
                checkUpdate('harbor-core', false);
            }
        }).catch(function() { checkUpdate('harbor-core', false); });
        checkUpdate('luci-app-harbor-file-pro', false);
        poll.add(function() {
            return Rpc.status().then(renderStatus).catch(function() {});
        }, 3);
        return page;
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
