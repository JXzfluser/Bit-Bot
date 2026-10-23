# vendor/ — 第三方前端库（原样入库，不再打包）

桌面渲染进程不走打包器（`index.html` 直接 `<script src>`），又要能在离线/内网环境启动，
所以这两份 UMD 产物原样入库，**不做任何修改**。升级时整份替换并更新下表。

| 文件 | 版本 | 许可证 | 上游 |
|------|------|--------|------|
| `marked.umd.js` | 18.1.1 | MIT | https://github.com/markedjs/marked |
| `dompurify.umd.js` | 3.4.17 | Apache-2.0 OR MPL-2.0 | https://github.com/cure53/DOMPurify |

用途：

- `marked` 把 assistant 回复里的 Markdown 渲染成 HTML（围栏代码块、表格、列表）。
- `dompurify` 在插入 `innerHTML` 前做一次白名单清洗，与 `index.html` 里的
  `defangMarkdown()` 形成两层防线：
  1. `defangMarkdown()` 先把「原始 HTML / 图片语法 / 非 http(s) 链接」降级成**纯文本**，
     保证 GP-93 的 fail-closed 语义（远端图片不加载、`javascript:` 不可点）；
  2. `DOMPurify.sanitize()` 再用 `FORBID_TAGS`（img/iframe/object/embed/style/link/meta/form）兜底。

两者都**不联网**，体积共约 133 KB，`package.json` 的 `build.files` 已包含 `vendor/**/*`。
