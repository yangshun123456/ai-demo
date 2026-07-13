# Kernel AI

一个基于 Electron + Vite + Vue + JavaScript 的 Linux AI 连接器原型，视觉风格参考 `stitch_ai_powered_linux_manager` 设计稿。

## 功能

- 服务器连接配置与测试
- 远程文件列表浏览
- 文件内容读取、编辑与保存
- 文件上传、下载和拖拽上传入口
- Kernel AI 对话面板
- OpenAI-compatible 模型配置：Base URL、API Key、Model
- Vue Router 页面路由
- Pinia 工作台状态管理

## 目录

- `src/views`：页面级视图
- `src/components`：侧栏、服务器配置、文件列表、编辑器、AI 面板等组件
- `src/stores`：Pinia 状态和业务动作
- `src/router`：Vue Router 路由配置
- `electron/backend`：Node 后台服务、IPC 注册、本地配置仓库

## 开发运行

```bash
pnpm install
pnpm dev
```

## 构建

```bash
pnpm build
```

## 连接说明

当前主进程通过纯 Node 的 `ssh2` 和 `ssh2-sftp-client` 执行远程连接与文件操作，开发和打包后使用同一套后台逻辑。服务器表单支持两种认证方式：用户名 + 密码，或用户名 + 私钥路径；如果私钥本身带口令，可继续填写密码字段作为私钥口令。
