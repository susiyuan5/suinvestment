# 本周操作 Dashboard 布局优化

## 代码审计与修改范围

项目采用原生 HTML、CSS、JavaScript，无前端框架或编译打包依赖。入口是 `index.html`；`workspace-navigation.js` 使用 hash 路由切换 weekly、holdings、dip 和研究工具视图。

修改前，`#decisionSummary` 的 CSS 将市场状态、定投计划、资金池排成三栏。股票由 `app.js` 的 `renderWeeklyDecisionPlan()` 渲染；比例和排序事件处理位于同一文件，算法位于独立策略模块。

| 文件 | 修改内容 |
| --- | --- |
| `index.html` | 四张 KPI 卡、合并计划工具区、原生表头与 tbody、保留所有原有控件 ID 和详情入口 |
| `app.js` | 仅展示与 UI 事件组织：表格行、独立详情展开行、批量操作菜单、焦点恢复、简短状态文案、摘要数据状态 |
| `workspace-navigation.css` | 156px 导航、居中主区、深色视觉 token、紧凑表格、响应式卡片、交互/焦点状态、菜单层级和极窄容器处理 |
| `scripts/workspace-smoke.mjs` | 将旧三栏断言改为顶部 KPI + 全宽计划；固定数据版本和时钟，等待刷新完成后比较重载结果 |
| `scripts/weekly-allocation-smoke.mjs` | 均分操作前打开新的批量操作菜单 |
| `scripts/dashboard-layout-smoke.mjs` | 新增八种宽度、键盘、展开多行、归一化、下移、手机编辑及展开不改变资金结果的回归检查 |
| `DASHBOARD_LAYOUT_REPORT.md` | 本报告 |

没有新增框架组件或 UI 库。复用原页面，新增的展示结构是四张摘要卡、七列表格、每只股票下一行的详情区域，以及原生 details 批量菜单。`style.css` 中的全站主题、路由实现和策略文件未修改。

## 布局与功能

- 页面结构改为导航 + 主内容，市场状态和资金信息不再占据主表格两侧。
- 主区最大宽度 1560px，桌面 padding 24px/28px，header 56px，股票标准行高 60px。
- 刷新为主要按钮；搜索、添加、复制、预算/比例设置仍可用；归一化和均分收入批量菜单。没有新增或替代原有比例重置算法。
- 使用原生 table/th/td；默认折叠详情，按钮关联 aria-controls 和 aria-expanded，可同时展开多行。
- 删除保留为低权重文字按钮；手动排序模式保留上下移动；输入仍调用原有比例应用函数。
- 新增明确 focus-visible、菜单 Escape 返回焦点、批量操作后恢复焦点；按钮保留稳定最小尺寸。
- 数据发布状态条移至页面底部，避免被固定 header 遮挡并占据首屏空白。

## 不变边界及前后对比

未修改 DCA、资金分配、信号计算、安全门禁、预算迁移、执行策略、LocalStorage/API 数据结构或抄底账本逻辑。

使用相同固定数据和时钟，分别加载 Git HEAD 原始页面资源与修改后资源，比较以下五个场景：初始加载、手动修改 NVDA 比例、归一化、均分、刷新。完整执行计划及信号、组合风险、持久化比例，以及基础预算、备用金、储备、保留现金、计划总额与状态全部一致。结果记录于 `output/playwright/dashboard-financial-parity.json`。这项对比覆盖固定测试数据；并非对全部可能行情的穷举证明。

## 响应式验收

| 宽度 | 摘要 | 股票展示 | 结果 |
| --- | --- | --- | --- |
| 1920 / 1440 / 1200px | 四列 | 表格 | 无横向溢出 |
| 1000 / 800px | 两列 | 缩减间距的表格，较窄时操作换行 | 无横向溢出 |
| 799 / 390px | 两列 | 紧凑卡片 | 搜索、编辑、应用、详情、删除可操作 |
| 320px | 单列 | 单列紧凑卡片 | 无横向溢出 |
| 手机 200% 缩放 | 按实际容器宽度改为单列 | 控件换行 | 工作区审计通过 |

含操作反馈文字的测试状态下，1440×900 首屏完整显示 5 个标的，1920×1080 显示默认全部 6 个标的。桌面表格不再被左右信息卡挤窄。测试结果及截图位于 `output/playwright/dashboard-layout-results.json` 和 `dashboard-<width>.png`。

## 验证结果

- 修改前后 `npm test`：211/211 通过。
- `npm run check:js`：通过。
- `python -m unittest discover -s tests`：187/187 通过。
- `python scripts/check_static_contracts.py`：通过，371 个唯一 ID、66 个 JavaScript 文件。
- `npm run audit:pages`：页面冒烟、数据失败路径、无障碍基本检查、移动端、200% 缩放通过。
- `node scripts/workspace-smoke.mjs`：路由、历史、表单保留、资金不变性、键盘与缩放通过。
- `node scripts/weekly-allocation-smoke.mjs`：搜索/添加/自动分配、手动比例、应用、均分、排序、删除/恢复、重载、设置、账本与手机操作通过。
- `node scripts/dashboard-layout-smoke.mjs`：八种宽度、归一化、下移、多详情、键盘菜单、手机应用通过。
- `node scripts/market-calendar-smoke.mjs`、`node scripts/dip-smoke.mjs`、`node scripts/live-data-browser-smoke.mjs`：通过。
- `git diff --check`：通过。

浏览器命令使用 `BASE_URL=http://localhost:8765`；可先运行 `python -m http.server 8765`。浏览器数据采用测试 fixture，截图中的数值和过期提示不是当前真实行情结论。

## Build 与未完成事项

`package.json` 没有 lint、typecheck 或 build 脚本。此站点由 GitHub Pages 直接发布静态文件，本地执行了项目现有语法检查、静态契约和浏览器加载验证；没有声称执行不存在的编译构建，也没有新增构建框架。

布局与回归工作已完成。本报告记录发布前验收；用户随后授权通过 main 分支发布到 GitHub Pages，发布结果以对应提交的 Pages 工作流为准。HTML 已同步更新脚本和样式缓存版本号。没有改动预先存在的未跟踪研究文件。
