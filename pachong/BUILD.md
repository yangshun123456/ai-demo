# Electron 打包

## 开发运行

```bash
npm install
npm run electron
```

## 打包 macOS

在 macOS 机器上执行：

```bash
npm run dist:mac
```

产物会输出到 `dist/`，默认生成 `dmg` 和 `zip`。

## 打包 Windows

在 Windows 机器上执行：

```bash
npm run dist:win
```

产物会输出到 `dist/`，默认生成 `nsis` 安装包和 `zip`。

## Playwright 浏览器

`dist:*` 脚本会先执行 `prepare:playwright`，把当前系统可用的 Chromium 下载到 `ms-playwright/`，然后随 Electron 应用打包。

因为 Playwright 浏览器是按操作系统下载的，Windows 包建议在 Windows 上构建，macOS 包建议在 macOS 上构建。
