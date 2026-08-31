
# Harbor File Pro: Smoother File Management for OpenWrt

[**中文版本**](./CN_README.md) | Chinese

**Harbor File Pro** is a deeply enhanced OpenWrt file manager based on [destan19/luci-app-harbor-file](https://github.com/destan19/luci-app-harbor-file).  
While retaining all the excellent features of the original, I have spent my spare time on **code refactoring** and **dozens of practical new features**. Since multiple pull requests were not merged upstream, I have released it independently as the **Pro Edition**.  
**Better performance, smoother operations, and more powerful functionality** — that's the new experience Pro brings to you.


## 📸 Screenshots

![0](images/0.png)  
![1](images/1.png)  
![2](images/2.png)  
![3](images/3.png)  
![4](images/4.png)  
![5](images/5.png)

---

## 🎯 Pro Edition Core Highlights (Comprehensive Upgrades over Original)

### 🪟 Modern Window Interaction — As Smooth as a Desktop App
- **Window Controls**: Support maximize/minimize, resize freely, and automatically remember window size.
- **Taskbar & Drag**: Drag the title bar to move; new taskbar for quick switching between multiple windows, auto-hide after 3 seconds of inactivity, and bring it back by scrolling with mouse or sliding on mobile.
- **Adaptive Scrolling**: Pages automatically fill the screen, with horizontal/vertical scrolling support when content overflows.

### 📝 Text Editor — Handles Large Files with Ease and Smarter Operations
- **Find & Replace**: Support case sensitivity, display result count and positions, highlight matches; provide Replace, Replace All, and Previous/Next navigation.
- **Infinite Undo/Redo**: Easily revert mistakes.
- **Crash Recovery**: Automatically ask to recover unsaved changes after accidental closure or crash to prevent data loss.
- **Toggle Line Numbers**: Show/hide line numbers with one click.
- **Auto-indent & Word Wrap**: Auto-indent when editing code (not for plain text), and support word wrap for viewing.
- **🚀 Performance Breakthrough**: **No file size limit** — open a 1TB file as smoothly as a 1KB file (depends on device performance, browser will not freeze).

### 🔢 Hex Editor — Professional Debugging Tool
- **Find & Replace**: Support regular expressions, case sensitivity, display match positions and count, highlight matches; support Replace and Replace All.
- **Dual View Sync**: Simultaneously display hex view (00-0F) and ASCII view; click on any data in either view, the other view highlights the corresponding position synchronously.
- **Undo/Redo & Crash Recovery**: Same as text editor — infinite undo steps and recovery from unexpected closure.
- **Same Performance Breakthrough**: Smooth operations on large files without memory overflow issues.

### 📂 File Management & Compression/Extraction — More Humanized Details
- **Directory Restoration**: Automatically open the last accessed directory after refresh or re-entry.
- **Compression Enhancements**: Added `gz` format; support custom compression paths; prompt to overwrite if file already exists.
- **Extraction Enhancements**: Support setting extraction path; prompt to overwrite if file already exists.
- **Paste Conflict Handling**: For duplicate file names, choose among **Overwrite**, **Rename** (auto-add sequence like `1.(1).txt`), or **Skip** — no more headaches.

### ⭐ Favorites (Similar to Edge Browser) — One‑Click Access to Frequently Used Directories
- **Add/Remove Favorite**: Click the ☆ on the address bar to favorite the current path; click again to remove.
- **Open Favorites Panel**: Click the ★ button after the address bar to pop up the management panel.
- **Full Management**: Support setting favorite name, address (directory), create new folders, move folders, delete, etc., making common paths easily accessible.

### 📱 Mobile‑Friendly
- **Single‑tap to Open, Long‑press for Context Menu**: Tap a file/folder to open, long‑press to show action menu.
- **Drag to Move**: Tap and hold a file to drag and move; support multi‑select and batch dragging.
- **Auto‑scroll**: When dragging files to the edge of a long page, the page automatically scrolls.
- **Selection Optimization**: When marking files, the page automatically scrolls to the top or bottom for smoother operations.

### ✏️ Address Bar Interaction Enhanced
- **Click on the blank area of the address bar to directly enter a path**, enabling quick jumps.
- The original address bar is completely non‑clickable for input on both desktop and mobile; this Pro‑exclusive feature greatly improves efficiency.

### 🔧 Property Page Permission Editing
- In the file/folder properties page, **added permission display and editing**.
- Supports **checking** read/write/execute permissions, as well as **manual input** of numeric permission values (e.g., 755) for more flexible and intuitive control.

### 🔧 Other Practical Enhancements
- **Fixed the issue where opening ttyd from external networks would prompt "not installed"**.
- **UI Details**: Truncate long filenames with `...`; improved recognition of files without extensions.
- **Error Prompts**: Use Windows‑style windowed notifications for a more intuitive experience.

---

## 📦 All Original Features Are Also Included (Pro Contains Full Basic Capabilities)

Harbor File Pro fully retains all core features of the original Harbor File, giving you a complete Windows‑like file manager experience on OpenWrt:

- **Visual File Browsing**: Icon/Tile/List views, breadcrumb navigation, quick access, disk space display.
- **Complete File Operations**: New, rename, delete, copy/cut/paste, batch operations, upload/download (with progress).
- **Text Editor**: Supports common formats like `txt, log, conf, json, lua, sh`, with online editing and saving.
- **Hex Viewer**: View Hex and ASCII content of non‑text files.
- **Media Preview**: Images (PNG/JPG/GIF/WebP, etc.), PDF, videos (MP4/MKV/AVI, etc.).
- **Package Management**: Support uploading and one‑click installation of `.ipk` and `.apk` packages, with detailed log display.
- **Terminal Integration**: If ttyd is installed, open a Web Terminal from the current directory with one click.
- **Security Controls**: System directories are protected by default; toggle display of hidden files; settings saved to UCI.

---

## ⚙️ Technical Refactoring (Developer Perspective)

- **Full Code Migration**: Migrated entirely from Lua to **ucode** with a modular architecture, reducing code volume by **60%** (excluding new feature code), resulting in higher runtime efficiency and lower memory usage (requires OpenWrt 22.03 or later).
- **Standalone CGI**: The download function is separated from the dispatcher as an independent CGI, using native browser streaming download, so large files no longer consume memory, avoiding OOM.
- **Frontend Refactoring**: All frontend code is modularized by type, making it easier to maintain and extend.

---

## 📥 Installation

### One‑click Installation (Recommended)

Use curl or wget to run the following command:

```bash
# Using curl
curl -fsSL "https://gitlab.com/whzhni/tailscale/-/raw/main/Auto_Install_Script.sh" | sh -s luci-app-harbor-file-pro

# Using wget
wget -q -O - "https://gitlab.com/whzhni/tailscale/-/raw/main/Auto_Install_Script.sh" | sh -s luci-app-harbor-file-pro
```

### Manual Installation

You can also download the `.ipk` or `.apk` package and install it via the plugin's built‑in installation feature or using `opkg`/`apk` commands.

---

## 🙏 Acknowledgements

- The original project author [destan19](https://github.com/destan19/luci-app-harbor-file) for their outstanding work.
- All enthusiastic users who participated in testing and provided feedback — your suggestions have made the Pro edition better.

---

**Harbor File Pro** — Making OpenWrt file management as simple as using Windows, yet more powerful than the original. Welcome to experience it!
```