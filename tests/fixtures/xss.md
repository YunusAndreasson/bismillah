---
title: <script>window.__xss = "frontmatter"</script>
---

# Script that must stay text <script>window.__xss = "heading"</script>

<script>window.__xss = "script"</script>

<img src="x" onerror="window.__xss = 'img'">

<svg onload="window.__xss = 'svg'"><circle r="1"/></svg>

<iframe src="javascript:parent.__xss = 'iframe'"></iframe>

<a href="javascript:window.__xss = 'anchor'">an anchor</a>

<details open ontoggle="window.__xss = 'details'"><summary>x</summary></details>

<style>body { display: none }</style>

<!-- a comment --><script>window.__xss = "after comment"</script>

<object data="javascript:window.__xss = 'object'"></object>

<form action="javascript:window.__xss = 'form'"><button>go</button></form>

<base href="javascript:/">

<meta http-equiv="refresh" content="0;url=javascript:window.__xss = 'meta'">

<math><mi xlink:href="javascript:window.__xss = 'math'">x</mi></math>

<div style="background-image: url(javascript:window.__xss = 'style')">styled</div>

Inline <span onmouseover="window.__xss = 'span'">HTML</span> in a paragraph, and an
entity: &lt;script&gt;window.__xss = "entity"&lt;/script&gt;.

A [javascript link](javascript:window.__xss='link'), a [mixed case one](JaVaScRiPt:window.__xss='case'),
an [encoded one](&#106;avascript:window.__xss='encoded'), an [angle one](<javascript:window.__xss='angle'>),
a [data link](data:text/html;base64,PHNjcmlwdD53aW5kb3cuX194c3M9J2RhdGEnPC9zY3JpcHQ+),
a [vbscript link](vbscript:msgbox) and a [reference one][bad].

[bad]: javascript:window.__xss='reference'

An autolink <javascript:window.__xss='autolink'> and <https://example.com/"onmouseover="window.__xss='quote'>.

![javascript image](javascript:window.__xss='image')

![svg image](data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIG9ubG9hZD0id2luZG93Ll9feHNzPSdzdmctaW1hZ2UnIi8+)

![remote image](https://example.com/"onerror="window.__xss='remote')

`<script>window.__xss = "code"</script>`

```html
<script>window.__xss = "fence"</script>
```

A footnote with HTML in it.[^x]

[^x]: <img src="x" onerror="window.__xss = 'footnote'">

| HTML | in a table |
|---|---|
| <img src="x" onerror="window.__xss = 'table'"> | <script>window.__xss = "cell"</script> |

- [ ] <script>window.__xss = "task"</script>
- [x] <img src="x" onerror="window.__xss = 'done task'">
