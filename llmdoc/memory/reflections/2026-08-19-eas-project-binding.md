# EAS 项目绑定与多变体身份

## 发生了什么

Expo Dashboard 的当前 General 页面没有直接展示 EAS Project ID，页面中提到的 internal distribution
随机 UUID 又不是项目身份。仓库当时还为三个安装变体配置了不同 slug，直接运行 `eas project:init` 会把
CLI 指向错误的项目名。

## 有效做法

- 先用已登录的 EAS CLI 核实用户对 `tokenroll` 组织具有 Owner 权限；不传 access token，也不把登录态
  写入仓库。
- 在初始化前把 Expo owner/slug 收敛为真实存在的 `@tokenroll/tool-bridge`，同时保留三套 package、
  bundle identifier、scheme 与显示名称。
- 让交互式 `eas project:init` 发现现有项目并显示 UUID，确认 full name 与 UUID 后才关联，避免创建同名
  之外的新项目。
- dynamic `app.config.ts` 无法由 EAS CLI 自动写入；CLI 给出的 Project ID 要手工写入
  `extra.eas.projectId`，再用 `eas project:info`、`eas config` 和仓库 config gate 三重验证。

## 可复用结论

- EAS Project ID 是可提交的项目路由标识，不是签名密钥或 API token。
- 安装变体不需要复制 EAS project；单一 project/slug 配合独立 build profile、environment 和平台安装
  标识即可。
- EAS project 已关联不等于 transport、push、OTA Update 或商店签名已配置。未设置的公开 allowlist 与
  gateway 变量必须继续 fail closed。
- GitHub Actions 的仓库验证和 EAS Build 的分发职责不同，不能用任一方的成功替代另一方证据。

