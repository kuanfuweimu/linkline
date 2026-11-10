# Linkline 0.1.0

在 Figma Design 里像 FigJam 一样连接元素。
FigJam-style connectors between elements in Figma Design.

## 为什么是插件 / Why a plugin

Figma 的原生连线 API（`createConnector`）只在 FigJam 可用。Linkline 改用普通矢量箭头，并在插件运行期间让连线跟随元素移动。
Figma's native connector API (`createConnector`) is FigJam-only. Linkline draws regular vector arrows and keeps them attached while the plugin runs.

## 安装 / Install

Figma 桌面版 → Plugins → Development → Import plugin from manifest，选择本目录的 `manifest.json`。不需要构建或联网。
Figma desktop → Plugins → Development → Import plugin from manifest, then choose this folder's `manifest.json`. No build step or network access is needed.

## 使用 / Use

- **连线 / Connect**：选中 2 个或更多元素后运行。按选择顺序依次连接，箭头指向后一个元素。
  Select two or more elements and run. They are chained in selection order; arrows point to the next element.
- **跟随 / Follow**：插件保持运行时，拖动或缩放元素，连线自动更新。需要时随时停止插件。
  While the plugin keeps running, dragging or resizing elements updates their lines. Stop the plugin whenever you like.
- **恢复跟随 / Resume**：停止后元素移动过，再次运行（无需选择）即可把当前页所有连线对齐并继续跟随。
  If elements moved after stopping, run again with nothing selected: every line on the page is re-aligned and followed again.
- **反转方向 / Reverse**：只选中一条连线再运行。
  Select a single connector and run.
- **删除 / Delete**：直接删除连线即可；删除端点元素时连线保留，但不再跟随。
  Delete a line like any layer. If an endpoint is deleted, the line stays but stops following.

线条样式（颜色、粗细、虚线）可直接在右侧面板修改，跟随时保留。
Colour, weight and dashes can be changed in the properties panel and are kept while following.

## 限制 / Limitations

- 仅直线、单端箭头，暂无折线和文字标注。 / Straight lines with a single arrowhead only; no elbow routing or labels yet.
- 插件停止后连线是普通矢量，不会自动跟随。 / After the plugin stops, lines are plain vectors and do not follow on their own.
- 端点按外框计算，旋转或非矩形元素的箭头落在外框上。 / Endpoints use bounding boxes, so rotated or non-rectangular elements connect at their bounds.
- 只跟随当前页。 / Only the current page is followed.

## 验证 / Verification

`npm test`：12 项针对模拟 Plugin API 的离线检查；官方 `@figma/plugin-typings` 1.142.0 类型检查通过。尚未在 Figma 桌面版实机验证。
`npm test` runs 12 offline checks against a mock Plugin API, and the official `@figma/plugin-typings` 1.142.0 typecheck passes. Not yet verified in the Figma desktop app.
