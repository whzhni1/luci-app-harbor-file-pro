include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-harbor-file-pro
PKG_VERSION:=2.0.0
PKG_RELEASE:=1
PKG_PO_VERSION:=$(PKG_VERSION)-r$(PKG_RELEASE)

PKG_LICENSE:=MIT
PKG_MAINTAINER:=whzhni1

LUCI_TITLE:=LuCI support for Harbor File Pro
LUCI_DEPENDS:=+luci-base +rpcd +ucode +ucode-mod-fs +ucode-mod-uci +curl +tar +jsonfilter
LUCI_PKGARCH:=all

define Build/Prepare/$(PKG_NAME)
	$(SED) "s/^const ASSET_VERSION = '[^']*';/const ASSET_VERSION = '$(PKG_VERSION)-r$(PKG_RELEASE)';/" $(PKG_BUILD_DIR)/htdocs/luci-static/resources/harbor/common.js
endef

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
/etc/init.d/harbor-core stop >/dev/null 2>&1
/etc/init.d/harbor-core disable >/dev/null 2>&1
exit 0
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
chmod 755 "$${IPKG_INSTROOT}/etc/init.d/harbor-core" \
	"$${IPKG_INSTROOT}/etc/uci-defaults/99_harbor-file-pro" \
	"$${IPKG_INSTROOT}/usr/libexec/harbor/harbor-update.sh" \
	"$${IPKG_INSTROOT}/usr/libexec/harbor/harbor-logs.sh" \
	"$${IPKG_INSTROOT}/usr/libexec/rpcd/luci.harbor-file-pro" 2>/dev/null || :
chmod 600 "$${IPKG_INSTROOT}/etc/config/harbor_file_pro" 2>/dev/null || :
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

if uci -q get firewall.harbor_wan >/dev/null 2>&1; then
	uci -q delete firewall.harbor_wan 2>/dev/null
	uci -q commit firewall 2>/dev/null
	/etc/init.d/firewall reload >/dev/null 2>&1
fi

rm -f /tmp/luci-indexcache*
rm -rf /tmp/luci-modulecache/
/etc/init.d/rpcd reload >/dev/null 2>&1
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk
$(eval $(call BuildPackage,$(PKG_NAME)))