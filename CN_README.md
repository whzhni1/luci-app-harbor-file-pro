
# harbor file pro————桌面级文件管理器 LuCI 面板

[English](./README.md) | 简体中文

[**harbor-core**](https://github.com/whzhni1/harbor-core) 的 OpenWrt LuCI 管理面板：服务生命周期、UCI 配置、内核安装与在线更新、日志、初始账号、防火墙放行。

> ⚠️ **本仓库不含文件管理内核。** 文件管理 Web 界面由 harbor-core 提供（默认 `0.0.0.0:9700`），首次使用前需安装内核，可通过本面板「内核安装 / 在线更新」完成。

---

## 安装

### 一键安装（推荐）

**使用 curl：**

```bash
curl -fsSL "https://gitlab.com/whzhni/tailscale/-/raw/main/Auto_Install_Script.sh" | sh -s luci-app-harbor-file-pro
```

**使用 wget：**

```bash
wget -q -O - "https://gitlab.com/whzhni/tailscale/-/raw/main/Auto_Install_Script.sh" | sh -s luci-app-harbor-file-pro
```

### 手动安装

从 [Releases](https://github.com/whzhni1/luci-app-harbor-file-pro/releases) 下载 `.ipk` / `.apk` 手动安装。

> 一键脚本和 Releases 用于安装 **LuCI 管理面板**，首次使用仍需确保 `harbor-core` 已安装。

### 首次使用

1. 进入 **系统 → Harbor File Pro → Overview**；
2. 检查服务状态与内核版本；
3. 完成初始管理员账号设置；
4. 通过 `http://<设备IP>:9700` 使用文件管理功能。

---

## 界面截图

<details>
<summary>展开查看 Overview / Settings 截图</summary>

<p align="center">
  <img src="https://github.com/user-attachments/assets/11fc72e7-82c6-4ae9-a69a-01848e9aa4da" width="720" alt="LuCI Status 状态页">
  <br>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/09d40c75-899f-4210-8cfa-4ecca5e0bd28" width="720" alt="LuCI Settings 设置页">
</p>

</details>

---

## 功能特性

| 功能 | 说明 |
|---|---|
| 服务管理 | procd 托管 harbor-core：启动/停止/重启/状态查询，支持崩溃自愈（respawn） |
| 配置管理 | 33 项设置，存储于 UCI `/etc/config/harbor_file_pro`（升级保留，conffiles） |
| 内核安装与在线更新 | `harbor-update.sh`：架构自动识别、多镜像回退、完整性校验、事务化安装 |
| LuCI 自身更新 | `auto_update_luci` 随内核更新通道同步升级本应用 |
| 日志 | 服务日志查看/清理，`harbor-logs.sh` 自动轮转 |
| 初始账号 | 异步任务初始化管理员账号，任务回执轮询（job 机制） |
| 主题 | 明暗主题设置（`get_theme` / `set_theme`） |
| WAN 访问 | 一键防火墙放行（`firewall.harbor_wan`） |

---

## 配置

UCI 路径：`harbor_file_pro` → `main`，共 33 项，升级保留。常用项如下：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `root` / `root_policy` | — / unrestricted | 文件管理根目录与根目录策略 |
| `_listen_endpoint` | 0.0.0.0:9700 | 监听地址 |
| `wan_access` | 0 | WAN 侧访问（防火墙放行开关） |
| `secure_cookie` | 0 | Secure Cookie（HTTPS 环境建议开启） |
| `auto_update` | — | 自动更新（配合 `update_interval` / `update_time`） |
| `session_ttl` | 43200 | 会话有效期（秒） |


---

## 安全说明

- rpcd ACL 按最小授权声明（`acl.d`），仅暴露上述固定方法；
- 会话三参数（TTL / 空闲 / 滑动）与 Secure Cookie 可配；
- `wan_access` 默认关闭，开启走防火墙放行、不重启服务；
- 配置文件权限 600；服务由 procd 托管，按最小权限运行；
- 内核更新事务化（下载 → 校验 → 原子替换），失败回退、不破坏现网。

---

## 相关仓库

- **harbor-core**（Rust 内核，Web 服务默认 `0.0.0.0:9700`）：
  <https://github.com/whzhni1/harbor-core>
- **v2.x**（Rust LuCI 管理面板）：
  <https://github.com/whzhni1/luci-app-harbor-file-pro>
- **v1.x 分支**（ucode 版，适配手机端）：
  <https://github.com/whzhni1/luci-app-harbor-file-pro/tree/v1.x>
- **原项目** (lua 版，功能少未适配移动端)
  <https://github.com/destan19/luci-app-harbor-file>

