# PageLinkMode

PageLinkMode 是一个面向 Chrome 的 Manifest V3 扩展，用来统一控制网页内部链接的打开方式。

它不尝试接管浏览器自身的所有标签行为，而是聚焦在真正影响日常浏览体验的网页内导航场景：列表页点开详情、卡片跳转、`window.open(...)`、常见表单提交。这让它更像一个针对网页导航语义的轻量控制层，而不是一个到处强插逻辑的浏览器魔改插件。

## Overview

- 控制网页内链接默认在当前标签页还是新标签页打开
- 支持全局默认、站点级、页面级三层规则
- 支持 popup 快速配置，也支持 options 页集中管理
- 支持新站点先授权，再配置站点级和页面级规则
- 支持规则导入 / 导出，方便迁移和备份

## Why

很多网站会混用普通链接、脚本跳转和 `window.open(...)`，导致“这个站点到底应该当前页打开还是新标签打开”没有统一策略。PageLinkMode 的目标就是把这件事显式化：

- 全局先给一个默认行为
- 对某些站点加例外
- 对某些具体页面再做更细粒度覆盖

这套模型简单，但已经足够覆盖多数论坛、内容站、视频站和信息流站点的日常浏览需求。

## Features

- 全局默认模式
  - `同标签页打开`
  - `新标签页打开`
- 规则优先级
  - 页面规则
  - 站点规则
  - 全局默认规则
- Popup 快速操作
  - 查看当前页面实际生效模式
  - 配置当前站点规则
  - 配置当前页面规则
  - 修改全局默认模式
- Options 管理页
  - 查看全部站点规则和页面规则
  - 删除已有规则
  - 导入 / 导出完整配置
- 授权流
  - 新站点首次配置前需要先授权
  - 授权完成后不会自动刷新，当前页手动刷新后开始接管

## Rule Model

PageLinkMode 的规则按以下顺序生效：

1. 页面规则
2. 站点规则
3. 全局默认规则

规则键定义如下：

- 页面规则键：规范化 URL，即 `origin + pathname + search`
- 页面规则忽略 `hash`
- 站点规则键：精确 `hostname`

## Supported Navigation

当前版本已覆盖以下网页内导航行为：

- 普通 `<a href="...">` 链接点击
- `target="_blank"` 链接
- `window.open(...)`
- 常见 HTML 表单提交

为了保留用户主动操作的原始语义，以下行为默认不会被强制改写：

- `Ctrl / Cmd / Shift / Alt` 修饰键点击
- 中键点击
- 下载链接
- `mailto:` 链接
- `javascript:` 链接
- 同页锚点跳转

## Non-goals

以下场景明确不在当前版本目标范围内：

- `chrome://` 页面
- 扩展页
- Chrome Web Store 页面
- 浏览器地址栏、书签栏、标签栏等原生 UI
- 浏览器右键菜单中的“在新标签页打开链接”
- 纯 `history.pushState` / `replaceState` 驱动的 SPA 路由切换

这些不是 bug，而是当前项目刻意保持的边界。

## How It Works

PageLinkMode 采用“事前拦截”的方式处理导航，而不是等新标签页打开后再回头修正。

- `service worker`
  - 负责规则读写
  - 负责解析当前页面上下文
  - 负责统一执行 `tabs.update` / `tabs.create`
- `content script`
  - 在 `document_start` 注入
  - 负责拦截文档点击和表单提交
- `page bridge`
  - 负责接管页面脚本中的 `window.open(...)`
- `popup`
  - 负责当前页面上下文下的快速配置和授权提示
- `options`
  - 负责完整规则管理，以及导入 / 导出

## Installation

当前项目以本地开发加载为主。

### Build From Source

```powershell
npm install
npm run build
```

构建产物位于：

```text
dist/
```

### Load In Chrome

1. 打开 `chrome://extensions`
2. 启用右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 [dist](./dist)

## Usage

1. 打开一个普通网页
2. 点击浏览器工具栏中的 PageLinkMode 图标
3. 如果当前站点尚未授权，先点击“授权当前站点”
4. 如需让当前页立即开始接管，手动刷新当前页面
5. 根据需要设置：
   - 全局默认模式
   - 当前站点规则
   - 当前页面规则
6. 若要集中查看、修改、删除、导入或导出规则，打开“规则管理”

## Development

### Requirements

- Node.js 24+
- npm 11+
- Chrome 最新稳定版

### Commands

```powershell
npm install
npm run typecheck
npm run build
```

### Project Layout

```text
src/
  background/   service worker
  content/      content script 与主世界桥接
  lib/          规则、消息、URL 与存储逻辑
  styles/       popup / options 样式
public/
  manifest.json
  icons/
scripts/
  build.mjs
```

## Known Limitations

- 某些高度定制的网站不会通过标准链接或标准表单进行跳转，这类页面仍需要定向兼容
- 当前版本没有实现路径前缀、正则或通配符规则
- 当前版本没有实现通用 SPA 路由接管
- 当前版本主要针对 Chrome 生态验证，尚未系统整理 Edge / Firefox 兼容性

## Roadmap

- 支持路径前缀级规则
- 支持更丰富的匹配模式
- 支持临时规则开关
- 补充更多真实站点兼容性修复
- 增加自动化验证场景

## Contributing

欢迎通过 issue 或 pull request 提交问题反馈和改进建议。若你准备扩展站点兼容性，建议优先保持当前项目边界，不把功能扩展到浏览器原生 UI 或站点业务逻辑本身。

## License

本项目基于 [MIT License](./LICENSE) 发布。
