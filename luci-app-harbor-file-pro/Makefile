include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-harbor-file-pro
PKG_VERSION:=1.0.2
PKG_RELEASE:=1
PKG_PO_VERSION:=$(PKG_VERSION)

LUCI_MINIFY_JS:=0
LUCI_MINIFY_CSS:=0

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=whzhni1

LUCI_TITLE:=LuCI support for HarborFile Pro (ucode backend)
LUCI_DEPENDS:=+luci-base +rpcd +rpcd-mod-file +ucode +ucode-mod-fs +ucode-mod-ubus +ucode-mod-uci
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(PKG_NAME)/conffiles
/etc/config/harbor_file_pro
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] || {
	rm -f /tmp/luci-indexcache*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd reload >/dev/null 2>&1
}
exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
