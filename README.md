# harbor file pro — Desktop-class File Manager LuCI Panel

[**简体中文**](./CN_README.md) | English

The OpenWrt LuCI management panel for [**harbor-core**](https://github.com/whzhni1/harbor-core): service lifecycle, UCI configuration, core installation and online updates, logs, initial account, and firewall allowlisting.

> ⚠️ **This repository does not include the file management core.** The file management web interface is provided by harbor-core (default `0.0.0.0:9700`). The core must be installed before first use; this can be completed via this panel's “Core Installation / Online Update”.

---

## Installation

### One-click installation (recommended)

**Using curl:**

```bash
curl -fsSL "https://gitlab.com/whzhni/tailscale/-/raw/main/Auto_Install_Script.sh" | sh -s luci-app-harbor-file-pro
```

**Using wget:**

```bash
wget -q -O - "https://gitlab.com/whzhni/tailscale/-/raw/main/Auto_Install_Script.sh" | sh -s luci-app-harbor-file-pro
```

### Manual installation

Download `.ipk` / `.apk` from [Releases](https://github.com/whzhni1/luci-app-harbor-file-pro/releases) and install manually.

> The one-click script and Releases install the **LuCI management panel**; for first use, you still need to ensure `harbor-core` is installed.

### First use

1. Go to **System → Harbor File Pro → Overview**;
2. Check the service status and core version;
3. Complete the initial administrator account setup;
4. Use the file management features via `http://<device IP>:9700`.

---

## Screenshots

<details>
<summary>Expand to view Overview / Settings screenshots</summary>

<p align="center">
  <img src="https://github.com/user-attachments/assets/11fc72e7-82c6-4ae9-a69a-01848e9aa4da" width="720" alt="LuCI Status page">
  <br>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/09d40c75-899f-4210-8cfa-4ecca5e0bd28" width="720" alt="LuCI Settings page">
</p>

</details>

---

## Features

| Feature | Description |
|---|---|
| Service management | procd-managed harbor-core: start/stop/restart/status query, with crash self-healing (respawn) support |
| Configuration management | 33 settings, stored in UCI `/etc/config/harbor_file_pro` (preserved across upgrades, conffiles) |
| Core installation and online update | `harbor-update.sh`: automatic architecture detection, multi-mirror fallback, integrity verification, transactional installation |
| LuCI self-update | `auto_update_luci` upgrades this app in sync with the core update channel |
| Logs | View/clear service logs; `harbor-logs.sh` performs automatic rotation |
| Initial account | Initialize the administrator account via an asynchronous task, with job receipt polling (job mechanism) |
| Theme | Light/dark theme settings (`get_theme` / `set_theme`) |
| WAN access | One-click firewall allow (`firewall.harbor_wan`) |

---

## Configuration

UCI path: `harbor_file_pro` → `main`, 33 items in total, preserved across upgrades. Common items are as follows:

| Option | Default | Description |
|---|---|---|
| `root` / `root_policy` | — / unrestricted | File management root directory and root directory policy |
| `_listen_endpoint` | 0.0.0.0:9700 | Listen address |
| `wan_access` | 0 | WAN-side access (firewall allow switch) |
| `secure_cookie` | 0 | Secure Cookie (recommended to enable in HTTPS environments) |
| `auto_update` | — | Automatic update (used with `update_interval` / `update_time`) |
| `session_ttl` | 43200 | Session validity period (seconds) |

---

## Security Notes

- rpcd ACL is declared with least privilege (`acl.d`), exposing only the fixed methods above;
- The three session parameters (TTL / idle / sliding) and Secure Cookie are configurable;
- `wan_access` is disabled by default; when enabled, it is allowed via the firewall without restarting the service;
- Configuration file permissions are 600; the service is managed by procd and runs with least privilege;
- Core updates are transactional (download → verify → atomic replacement), with rollback on failure and no disruption to the live environment.

---

## Related Repositories

- **harbor-core** (Rust core, web service defaults to `0.0.0.0:9700`):
  <https://github.com/whzhni1/harbor-core>
- **v2.x** (Rust LuCI management panel):
  <https://github.com/whzhni1/luci-app-harbor-file-pro>
- **v1.x branch** (ucode version, adapted for mobile):
  <https://github.com/whzhni1/luci-app-harbor-file-pro/tree/v1.x>
- **Original project** (Lua version, fewer features and not adapted for mobile)
  <https://github.com/destan19/luci-app-harbor-file>