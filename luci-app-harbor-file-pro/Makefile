include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-harbor-file-pro
PKG_VERSION:=1.1.3
PKG_RELEASE:=1
PKG_PO_VERSION:=$(PKG_VERSION)

LUCI_MINIFY_JS:=0
LUCI_MINIFY_CSS:=0

PKG_LICENSE:=MIT
PKG_MAINTAINER:=whzhni1

LUCI_TITLE:=LuCI support for HarborFile Pro (ucode backend)
LUCI_DEPENDS:=+luci-base +rpcd +rpcd-mod-file +ucode +ucode-mod-fs +ucode-mod-ubus +ucode-mod-uci
LUCI_PKGARCH:=all

define Build/Prepare/$(PKG_NAME)
	$(SED) "s/^const harbor_asset_version = '[^']*';/const harbor_asset_version = '$(PKG_VERSION)';/" $(PKG_BUILD_DIR)/root/usr/share/ucode/luci/template/harbor_file_pro/index.ut
endef

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(PKG_NAME)/conffiles
/etc/config/harbor_file_pro
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

BACKUP_DIR=/tmp/harbor-file-pro-backup
UPGRADE_MARKER=/tmp/harbor-file-pro-upgrade

case "$${1:-remove}" in
	upgrade)
		: > "$${UPGRADE_MARKER}"
		exit 0
		;;
esac
[ "$${PKG_UPGRADE}" = "1" ] && { : > "$${UPGRADE_MARKER}"; exit 0; }

rm -rf "$${BACKUP_DIR}"
mkdir -p "$${BACKUP_DIR}"
cp -f /etc/config/harbor_file_pro "$${BACKUP_DIR}/harbor_file_pro" 2>/dev/null
exit 0
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

BACKUP_DIR=/tmp/harbor-file-pro-backup
UPGRADE_MARKER=/tmp/harbor-file-pro-upgrade

upgrade=0
if [ "$${PKG_UPGRADE}" = "1" ] || [ -e "$${UPGRADE_MARKER}" ]; then
	upgrade=1
fi
rm -f "$${UPGRADE_MARKER}"

if [ "$$upgrade" = "0" ]; then
	if [ -d "$${BACKUP_DIR}" ]; then
		[ -f "$${BACKUP_DIR}/harbor_file_pro" ] && cp -f "$${BACKUP_DIR}/harbor_file_pro" /etc/config/harbor_file_pro
		rm -rf "$${BACKUP_DIR}"
	fi
fi

rm -f /tmp/luci-indexcache*
rm -rf /tmp/luci-modulecache/
/etc/init.d/rpcd reload >/dev/null 2>&1
exit 0
endef

define Package/$(PKG_NAME)/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

case "$${1:-remove}" in
	upgrade) exit 0 ;;
esac
[ "$${PKG_UPGRADE}" = "1" ] && exit 0

uci -q delete harbor_file_pro 2>/dev/null
uci -q commit harbor_file_pro 2>/dev/null
rm -f /etc/config/harbor_file_pro 2>/dev/null

rm -f /tmp/luci-indexcache*
rm -rf /tmp/luci-modulecache/
/etc/init.d/rpcd reload >/dev/null 2>&1
exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
