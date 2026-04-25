<div align="center">
  <img src="./public/icons/icon128.png" alt="PageLinkMode Logo" width="112" height="112" />

# PageLinkMode

**一个面向 Chrome 的网页内链接跳转控制扩展。**

让站内链接、脚本打开页和常见表单提交，在 `同标签页` 与 `新标签页` 之间拥有一致、可配置、可记忆的打开策略。

[项目主页](https://github.com/Zenith-Angle/PageLinkMode) · [问题反馈](https://github.com/Zenith-Angle/PageLinkMode/issues) · [MIT License](./LICENSE)

[![Repository](https://img.shields.io/badge/repository-PageLinkMode-181717?logo=github)](https://github.com/Zenith-Angle/PageLinkMode)
[![Language](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Release](https://img.shields.io/badge/release-v0.4.1-0969DA)](https://github.com/Zenith-Angle/PageLinkMode/releases)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![License](https://img.shields.io/badge/license-MIT-2ea043)](https://github.com/Zenith-Angle/PageLinkMode/blob/main/LICENSE)

</div>

---

## 项目简介

PageLinkMode 是一个聚焦“网页内导航”的 Chrome Manifest V3 扩展。它不尝试篡改浏览器原生标签体系，而是专门处理用户最常遇到的站内跳转场景：

- 帖子列表点开详情页
- 视频卡片跳转播放页
- 页面脚本调用 `window.open(...)`
- 常见 HTML 表单提交跳转

项目的目标很明确：把“一个网站里的链接默认应该当前页打开，还是新标签页打开”变成一个显式、稳定、可配置的规则系统。

## 核心特性

- 全局默认模式
  - 新安装默认 `新标签页打开`
  - 也支持切回 `同标签页打开`
- 分类策略 + 粗粒度整体规则
  - 页面整体规则
  - 站点整体规则
  - 站点分类覆写
  - 全局分类策略
- Popup 快速配置
  - 查看当前页面的实际生效模式
  - 一键停用当前站点的扩展影响
  - 配置当前站点规则
  - 配置当前页面规则
  - 修改全局默认模式
- Options 管理页
  - 查看 12 类跳转的全局默认动作
  - 按站点覆写分类策略
  - 查看最近 50 条调试记录
  - 维护页面整体规则
  - 删除规则
  - 导入 / 导出完整配置
- 显式授权流程
  - 新站点首次配置前需要先授权
  - 授权完成后不自动刷新，用户手动刷新后开始接管当前页

## 适用场景

PageLinkMode 适合这些场景：

- 你希望论坛、内容站、文档站的列表页统一在当前标签页打开
- 你希望信息流或视频站里的内容卡片统一在新标签页打开
- 你需要为少数站点或单独页面设置例外，而不是全局一刀切

它不适合这些目标：

- 接管浏览器地址栏、书签栏、标签栏等原生 UI
- 强行改写浏览器右键菜单中的“在新标签页打开链接”
- 通用接管 SPA 的 `history.pushState` / `replaceState` 路由切换
- 扩展到站点业务功能本身，而不是导航行为

## 规则模型

PageLinkMode 在 `v0.4.1` 中把“跳转类型”显式建模为分类策略，并按以下优先级计算最终行为：

若当前站点被停用，则扩展会直接回退为浏览器原生导航，并保留此前保存的站点规则与页面规则。

1. 页面规则
2. 站点规则
3. 站点分类覆写
4. 全局分类策略

规则键说明：

- 页面规则键：规范化 URL，即 `origin + pathname + search`
- 页面规则忽略 `hash`
- 站点规则键：精确 `hostname`

## 当前支持的导航类型

当前版本已覆盖并可单独配置的分类包括：

- 同站内容链接 / 跨站内容链接
- 站点壳层导航 / 传统分页 / 图片查看 / 认证相关链接
- GET 表单 / 非 GET 表单
- 普通 `window.open(...)` / 认证相关 `window.open(...)`
- 图片相关 `window.open(...)` / 命名窗口或弹窗式 `window.open(...)`

以下行为默认保持浏览器原始语义，不做强制改写：

- `Ctrl / Cmd / Shift / Alt` 修饰键点击
- 中键点击
- 下载链接
- `mailto:` 链接
- `javascript:` 链接
- 同页锚点跳转
- 传统翻页链接（如页码、上一页、下一页、`rel=prev/next`）
- 图片查看 / 原图预览 / Lightbox 等高置信图片查看入口

PageLinkMode 优先保留页面脚本已经接管的 `click` / `submit` 事件。页面在到达 `window` 之前完成 `preventDefault()` 或停止传播时，扩展沿用页面自己的交互结果。

当扩展已经明确接管某次链接点击时，会同时阻止浏览器默认跳转和页面后续 `click` 监听中的脚本导航，避免出现“新标签已打开，但当前页也被带走”的双跳转。

分页链接按当前页打开处理，属于集合浏览控制语义。

## 工作方式

PageLinkMode 采用“事前拦截”的方式处理网页导航，而不是等标签页已经打开后再回头修正。

- `service worker`
  - 负责规则存储、上下文解析和最终的标签页操作
- `content script`
  - 在 `document_start` 注入，负责拦截文档点击和表单提交
- `page bridge`
  - 负责接管页面脚本中的 `window.open(...)`
- `popup`
  - 负责当前页面上下文下的快速配置和授权提示
- `options`
  - 负责规则工作台、站点覆写、调试记录，以及导入 / 导出

## 安装方式

### 从源码构建

```powershell
npm install
npm run build
```

构建产物位于：

```text
dist/
```

### 在 Chrome 中加载

1. 打开 `chrome://extensions`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本仓库下的 [dist](./dist) 目录

## 使用方式

1. 打开一个普通网页
2. 点击浏览器工具栏中的 PageLinkMode 图标
3. 如果当前站点尚未授权，先点击“授权当前站点”
4. 如果希望当前页立刻开始接管，手动刷新当前页面
5. 根据需要设置：
   - 顶部“当前站点生效”开关
   - 全局默认模式
   - 当前站点规则
   - 当前页面规则
6. 若要集中查看、修改、删除、导入或导出规则，打开“规则管理”

## 开发

### 环境要求

- Node.js 24+
- npm 11+
- Chrome 最新稳定版

### 常用命令

```powershell
npm install
npm run typecheck
npm run build
```

### 项目结构

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

## 已知限制

- 某些高度定制的网站不会通过标准链接或标准表单进行跳转，仍需要定向兼容
- 翻页与图片查看例外目前基于高置信启发式识别，极端站点结构下仍可能需要继续补兼容
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

欢迎通过 issue 或 pull request 提交问题反馈和改进建议。若要扩展站点兼容性，建议优先保持当前项目边界，把精力集中在“网页内导航行为”本身，而不是浏览器原生 UI 或具体站点业务逻辑。

## License

本项目基于 [MIT License](./LICENSE) 发布。
