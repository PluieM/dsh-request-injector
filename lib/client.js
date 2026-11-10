// dsh-request-injector — 浏览器半边（客户端插件 bundle）。
//
// 由 dsh-client-modules 从 /plugins/dsh-request-injector/client.js 加载，经
// window.__ModuleLoader__.load 的惰性 CJS 模块表执行。factory 体是纯 CJS，
// require("react") 解析到宿主平台基座的同一份 React 实例。
//
// 本文件手写，不经过构建步骤；形态与宿主内置 ui-* 包的构建产出一致。
(function (root) {
  if (!root || !root.__ModuleLoader__ || typeof root.__ModuleLoader__.load !== "function") return;

  root.__ModuleLoader__.load({
    id: "dsh-request-injector",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;

      var React = null;
      try { React = require("react") || null; } catch (e) { React = null; }

      var NS = "dsh-request-injector";
      // 行 id 与包名相同：插件行配置 slot 的 key 为 `<包名>#<行 id>`，
      // 且行详情页用行 id 作为 settings namespace 去查可编辑表单。
      var ROW_ID = "dsh-request-injector";
      var SLOT_KEY = ROW_ID + "#" + ROW_ID;

      // ---------------------------------------------------------------- 文案
      var UI_zh = {
        summary: "按 provider / model / host 匹配注入请求头",
        settingsNav: "请求头注入",
        settingsTitle: "请求头注入",
        settingsHint: "按 provider / model / host 匹配注入请求头。",
        loading: "加载中…",
        unavailable: "这一行没有可编辑的配置。",
        readOnly: "当前配置不可写（只读配置层）。",
        basic: "基本",
        enabled: "启用插件",
        enabledHint: "关闭后两个后端都不再注入任何请求头。",
        backend: "后端",
        backendAuto: "自动（两个后端都注册）",
        backendHeaders: "仅官方扩展点",
        backendFetch: "仅包装 fetch",
        backendHint:
          "自动：官方扩展点 + 包装 fetch 同时启用，已注入的规则不会重复生效。websocket 传输下只有官方扩展点有效。",
        onMissingVariable: "变量缺失时",
        missingSkip: "跳过该请求头",
        missingEmpty: "置为空串",
        missingError: "让本次请求失败",
        missingHint: "模板里引用了运行时拿不到的变量时的处理方式。",
        debug: "调试日志",
        debugHint: "只在排查问题时打开。",
        rules: "规则",
        rulesHint: "按“顺序”从小到大依次应用，同名请求头后写的覆盖先写的。",
        addRule: "新增规则",
        noRules: "还没有规则。新增一条后即可开始注入请求头。",
        ruleEnabled: "启用",
        comment: "备注",
        commentPlaceholder: "这条规则的用途（可留空）",
        match: "匹配条件",
        matchHint: "留空表示不限。model 支持尾部 * 通配，例如 deepseek-v4* 。",
        provider: "provider",
        model: "model",
        host: "host",
        hostHint: "host 条件只在“包装 fetch”后端生效，官方扩展点拿不到 host。",
        headers: "请求头",
        headersEmpty: "这条规则还没有请求头。",
        addHeader: "新增请求头",
        headerName: "名称",
        headerValue: "值",
        removeHeader: "删除这个请求头",
        moveUp: "上移",
        moveDown: "下移",
        removeRule: "删除这条规则",
        order: "顺序",
        variables: "可用变量",
        variablesHint: "在请求头的值里用 ${ 变量名 } 引用，$$ 表示一个字面量 $。",
        save: "保存",
        revert: "还原",
        saving: "保存中…",
        saved: "已保存",
        dirty: "有未保存的修改",
        noChange: "没有修改",
        saveFailed: "保存失败：配置已被其他改动更新，请还原后重试。",
        saveRejected: "保存被拒绝：",
        invalidHeaderName: "请求头名称不合法",
        reservedHeader: "保留请求头，会被忽略",
        duplicateHeader: "重复的请求头名称",
        badValue: "值只能是 Latin-1 字符，且不能包含换行（HTTP 头限制）",
        delete: "删除",
        // 变量速查表：键名与 ${...} 里的变量名一一对应（首字母大写拼接在
        // VariableList 里做），宿主 lookup 只做单层取值、不展开 "varList." 前缀。
        varSessionId: "会话 id",
        varProvider: "provider",
        varModel: "model",
        varBaseURL: "请求基地址（仅官方扩展点可见）",
        varPurpose: "请求用途",
        varHost: "目标主机名（仅包装 fetch 可见）",
        varDate: "本地日期 YYYY-MM-DD",
        varTime: "本地时间 HH:mm:ss",
        varTimestamp: "Unix 毫秒时间戳",
        varUuid: "随机 UUID v4",
        varRandom: "随机字符串，可写 ${random:16} 指定长度",
      };

      var UI_en = {
        summary: "Inject request headers matched by provider / model / host",
        settingsNav: "Request headers",
        settingsTitle: "Request headers",
        settingsHint: "Inject request headers matched by provider / model / host.",
        loading: "Loading…",
        unavailable: "This row exposes no editable configuration.",
        readOnly: "This configuration is read-only.",
        basic: "Basics",
        enabled: "Enable plugin",
        enabledHint: "While off, neither backend injects any header.",
        backend: "Backend",
        backendAuto: "Auto (both backends)",
        backendHeaders: "Official extension point only",
        backendFetch: "Fetch wrapper only",
        backendHint:
          "Auto runs the official extension point and the fetch wrapper together; a rule applied once is not applied again. Only the extension point reaches websocket transports.",
        onMissingVariable: "Missing variable",
        missingSkip: "Skip that header",
        missingEmpty: "Use an empty value",
        missingError: "Fail this request",
        missingHint: "What to do when a template references a variable the runtime does not have.",
        debug: "Debug logging",
        debugHint: "Enable only while diagnosing.",
        rules: "Rules",
        rulesHint: "Applied in ascending order; a later rule overrides an earlier one for the same header.",
        addRule: "Add rule",
        noRules: "No rules yet. Add one to start injecting headers.",
        ruleEnabled: "Enabled",
        comment: "Comment",
        commentPlaceholder: "What this rule is for (optional)",
        match: "Match",
        matchHint: "Empty matches everything. model accepts a trailing * wildcard, e.g. deepseek-v4* .",
        provider: "provider",
        model: "model",
        host: "host",
        hostHint: "A host condition only works with the fetch wrapper; the extension point cannot see the host.",
        headers: "Headers",
        headersEmpty: "This rule has no headers yet.",
        addHeader: "Add header",
        headerName: "Name",
        headerValue: "Value",
        removeHeader: "Remove this header",
        moveUp: "Move up",
        moveDown: "Move down",
        removeRule: "Remove this rule",
        order: "Order",
        variables: "Available variables",
        variablesHint: "Reference a variable as ${ name } inside a header value; $$ is a literal $.",
        save: "Save",
        revert: "Revert",
        saving: "Saving…",
        saved: "Saved",
        dirty: "Unsaved changes",
        noChange: "No changes",
        saveFailed: "Save failed: the configuration changed elsewhere. Revert and try again.",
        saveRejected: "Save rejected: ",
        invalidHeaderName: "Invalid header name",
        reservedHeader: "Reserved header, ignored",
        duplicateHeader: "Duplicate header name",
        badValue: "Value must be Latin-1 with no line breaks (HTTP header limit)",
        delete: "Delete",
        varSessionId: "Session id",
        varProvider: "provider",
        varModel: "model",
        varBaseURL: "Request base URL (extension point only)",
        varPurpose: "Request purpose",
        varHost: "Target host (fetch wrapper only)",
        varDate: "Local date YYYY-MM-DD",
        varTime: "Local time HH:mm:ss",
        varTimestamp: "Unix timestamp in milliseconds",
        varUuid: "Random UUID v4",
        varRandom: "Random string; ${random:16} picks the length",
      };

      // 与宿主 schema 保持一致的默认值（客户端只用于补齐草稿，不做校验）。
      var RULE_DEFAULTS = {
        id: "",
        enabled: true,
        comment: "",
        match: { provider: "", model: "", host: "" },
        headers: {},
        order: 0,
      };
      var DEFAULTS = {
        enabled: true,
        backend: "auto",
        rules: [],
        onMissingVariable: "skip",
        debug: false,
      };

      // 与 lib/rules.js 的 RESERVED 必须保持一致：client.js 是手写 CJS，
      // 无法 import ESM 模块，只能各留一份。改动任一侧都要同步另一侧。
      var RESERVED = [
        "user-agent",
        "authorization",
        "content-length",
        "host",
        "transfer-encoding",
        "connection",
      ];
      var RESERVED_PREFIX = "x-dsh-";

      function isReserved(name) {
        var lower = String(name || "").trim().toLowerCase();
        if (lower === "") return false;
        if (lower.indexOf(RESERVED_PREFIX) === 0) return true;
        return RESERVED.indexOf(lower) !== -1;
      }

      // 与宿主 lib/rules.js 的 isUsableHeaderValue 保持一致。client.js 是手写
      // CJS、无法 import ESM 模块，因此只能手工复制一份；两侧一旦漂移，界面
      // 就会放行宿主会拒的头值。一致性由 test/unit/client.test.js 的对拍用例保证。
      //
      // Headers.set 只接受 ByteString（每个字符码 <= 0xff）且不允许 CR/LF/NUL。
      function isUsableHeaderValue(value) {
        var body = String(value == null ? "" : value);
        for (var i = 0; i < body.length; i++) {
          var code = body.charCodeAt(i);
          if (code === 0 || code === 0x0a || code === 0x0d) return false;
          if (code > 0xff) return false;
        }
        return true;
      }

      var HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

      function normalizeDraft(raw) {
        var cfg = raw && typeof raw === "object" ? raw : {};
        var rules = Array.isArray(cfg.rules) ? cfg.rules : [];
        var seen = {};
        return {
          enabled: cfg.enabled !== false,
          backend: cfg.backend === "headers" || cfg.backend === "fetch" ? cfg.backend : "auto",
          onMissingVariable:
            cfg.onMissingVariable === "empty" || cfg.onMissingVariable === "error"
              ? cfg.onMissingVariable
              : "skip",
          debug: cfg.debug === true,
          rules: rules
            .filter(function (rule) { return rule && typeof rule === "object"; })
            .map(function (rule, index) {
              var id = typeof rule.id === "string" && rule.id !== "" ? rule.id : "rule-" + (index + 1);
              // 草稿里必须保持 id 唯一：id 是规则在配置里的稳定标识，
              // 重复会让表单定位与后续按 id 的增删改指向同一条。
              while (seen[id]) id = id + "-";
              seen[id] = true;
              var match = rule.match && typeof rule.match === "object" ? rule.match : {};
              // 草稿里请求头用有序数组表示，才能编辑“尚无名称”的新行；保存时再折回字典。
              var headers = [];
              if (rule.headers && typeof rule.headers === "object" && !Array.isArray(rule.headers)) {
                for (var name in rule.headers) {
                  if (Object.prototype.hasOwnProperty.call(rule.headers, name)) {
                    headers.push({ name: name, value: String(rule.headers[name]) });
                  }
                }
              }
              return {
                id: id,
                enabled: rule.enabled !== false,
                comment: typeof rule.comment === "string" ? rule.comment : "",
                match: {
                  provider: typeof match.provider === "string" ? match.provider : "",
                  model: typeof match.model === "string" ? match.model : "",
                  host: typeof match.host === "string" ? match.host : "",
                },
                headers: headers,
                order: typeof rule.order === "number" && isFinite(rule.order) ? rule.order : index * 10,
              };
            }),
        };
      }

      // ---------------------------------------------------------------- 样式
      var STYLE_ID = "dsh-request-injector-style";
      var CSS = [
        ".dri-form{display:flex;flex-direction:column;gap:16px;max-width:880px}",
        ".dri-card{border:1px solid var(--dsw-alias-border-l2,#d8dce2);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}",
        ".dri-card-head{display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap}",
        ".dri-card-title{font-size:13px;font-weight:600;margin:0}",
        ".dri-section{display:flex;flex-direction:column;gap:6px}",
        ".dri-section-title{font-size:15px;font-weight:600;margin:0}",
        ".dri-field{display:flex;flex-direction:column;gap:6px}",
        ".dri-field-label{font-size:12px;font-weight:600}",
        ".dri-field-hint{font-size:11px;opacity:.7;margin:0;line-height:1.5}",
        ".dri-field-error{font-size:11px;margin:0;color:var(--dsw-alias-state-error-primary,#c0392b)}",
        ".dri-row{display:flex;gap:10px;flex-wrap:wrap}",
        ".dri-row>.dri-field{flex:1 1 180px;min-width:150px}",
        // 输入类控件必须同时指定底色与文字色：宿主是深色主题时，只写 color:inherit
        // 会继承到浅色文字，配上写死的白底就是「白底白字」。
        ".dri-input,.dri-select,.dri-textarea{font:inherit;font-size:12px;padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#c9ced6);background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-sizing:border-box;width:100%}",
        ".dri-input::placeholder,.dri-textarea::placeholder{color:var(--dsw-alias-label-tertiary,#8a8f98);opacity:1}",
        ".dri-input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary,#c0392b)}",
        ".dri-switch{display:flex;align-items:center;gap:8px;font-size:12px}",
        ".dri-switch input{width:14px;height:14px;margin:0}",
        ".dri-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
        ".dri-button{font:inherit;font-size:12px;padding:6px 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#c9ced6);background:var(--dsw-alias-button-elevated-fill,#f6f7f9);color:var(--dsw-alias-label-primary,#1a1a1a);cursor:pointer}",
        ".dri-button:disabled{opacity:.5;cursor:default}",
        ".dri-button-primary{background:var(--dsw-alias-button-primary-fill,#1f6feb);border-color:var(--dsw-alias-button-primary-fill,#1f6feb);color:#fff}",
        ".dri-button-danger{color:var(--dsw-alias-state-error-primary,#c0392b)}",
        ".dri-rule{border:1px solid var(--dsw-alias-border-l2,#e2e5ea);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px}",
        ".dri-rule-head{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}",
        ".dri-rule-dim{opacity:.62}",
        ".dri-headers{display:flex;flex-direction:column;gap:8px}",
        ".dri-header-row{display:flex;gap:8px;align-items:flex-start}",
        ".dri-header-row>.dri-name{flex:0 0 200px}",
        ".dri-header-row>.dri-value{flex:1 1 auto;min-width:0}",
        ".dri-icon-button{font:inherit;font-size:12px;line-height:1;padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#c9ced6);background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);cursor:pointer}",
        ".dri-icon-button:disabled{opacity:.35;cursor:default}",
        ".dri-status{font-size:12px;margin:0}",
        ".dri-vars{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;opacity:.85;margin:0;padding:0;list-style:none}",
        ".dri-vars code{font-size:11px}",
        ".dri-order{width:72px;flex:0 0 72px}",
        // 上面的 --dsw-* 令牌由宿主 ui-theme 客户端插件在 body 上注入。令牌缺失时
        // 浅色 fallback 在深色主题下会重新变成白底白字，按宿主的深色标记再兜一层；
        // 主按钮有自己的品牌底色，用 :not() 排除以免被这里覆盖。
        "body[data-ds-dark-theme] .dri-input,body[data-ds-dark-theme] .dri-select,body[data-ds-dark-theme] .dri-textarea{background:var(--dsw-specific-input-major,#232429);color:var(--dsw-alias-label-primary,#e8e8ea)}",
        "body[data-ds-dark-theme] .dri-input::placeholder,body[data-ds-dark-theme] .dri-textarea::placeholder{color:var(--dsw-alias-label-tertiary,#8d929c)}",
        "body[data-ds-dark-theme] .dri-button:not(.dri-button-primary){background:var(--dsw-alias-button-elevated-fill,#2f3035);color:var(--dsw-alias-label-primary,#e8e8ea)}",
        "body[data-ds-dark-theme] .dri-icon-button{color:var(--dsw-alias-label-primary,#e8e8ea)}",
        "body[data-ds-dark-theme] .dri-card,body[data-ds-dark-theme] .dri-rule{border-color:var(--dsw-alias-border-l2,#3a3b40)}",
      ].join("\n");

      function installStyles() {
        if (typeof document === "undefined" || !document.head) return function () {};
        var existing = document.getElementById(STYLE_ID);
        if (existing) return function () {};
        var style = document.createElement("style");
        style.id = STYLE_ID;
        style.setAttribute("data-plugin", "dsh-request-injector");
        style.textContent = CSS;
        document.head.append(style);
        return function () {
          if (style.parentNode) style.parentNode.removeChild(style);
        };
      }

      // ---------------------------------------------------------------- 辅助
      var h = React ? React.createElement : null;

      function text(t, key, fallback) {
        var value = typeof t === "function" ? t(key) : undefined;
        return value === undefined || value === null || value === "" ? fallback : value;
      }

      function cloneRule(rule) {
        return {
          id: rule.id,
          enabled: rule.enabled,
          comment: rule.comment,
          match: { provider: rule.match.provider, model: rule.match.model, host: rule.match.host },
          headers: rule.headers.map(function (pair) {
            return { name: pair.name, value: pair.value };
          }),
          order: rule.order,
        };
      }

      function cloneDraft(draft) {
        return {
          enabled: draft.enabled,
          backend: draft.backend,
          onMissingVariable: draft.onMissingVariable,
          debug: draft.debug,
          rules: draft.rules.map(cloneRule),
        };
      }

      function newRuleId() {
        return "rule-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
      }

      /** 结构比较：用于判断草稿是否已改动。 */
      function sameDraft(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
      }

      /** 草稿 -> 可保存配置：请求头数组折回字典，空名称与重名按“后者覆盖”处理。 */
      function toConfig(draft) {
        return {
          enabled: draft.enabled,
          backend: draft.backend,
          onMissingVariable: draft.onMissingVariable,
          debug: draft.debug,
          rules: draft.rules.map(function (rule, index) {
            var headers = {};
            rule.headers.forEach(function (pair) {
              var name = String(pair.name || "").trim();
              if (name === "") return;
              headers[name] = String(pair.value === undefined || pair.value === null ? "" : pair.value);
            });
            var match = rule.match && typeof rule.match === 'object' ? rule.match : {};
            return {
              id: rule.id,
              enabled: rule.enabled,
              comment: rule.comment,
              match: {
                provider: match.provider || '',
                model: match.model || '',
                host: match.host || '',
              },
              headers: headers,
              order: rule.order,
            };
          }),
        };
      }

      /** 与宿主侧一致的头名/头值合法性检查（仅用于界面提示，不代替宿主校验）。 */
      function headerProblems(rule) {
        var problems = [];
        var seen = {};
        rule.headers.forEach(function (pair) {
          var name = String(pair.name || "").trim();
          if (name === "") return;
          if (!HEADER_NAME.test(name)) problems.push({ name: name, reason: "invalid" });
          else if (isReserved(name)) problems.push({ name: name, reason: "reserved" });
          else if (!isUsableHeaderValue(pair.value)) problems.push({ name: name, reason: "badValue" });
          var lower = name.toLowerCase();
          if (seen[lower]) problems.push({ name: name, reason: "duplicate" });
          seen[lower] = true;
        });
        return problems;
      }


      // ---------------------------------------------------------------- 组件
      function Field(props) {
        return h("div", { className: "dri-field" }, [
          h("label", { className: "dri-field-label", key: "label" }, props.label),
          h("div", { key: "control" }, props.children),
          props.hint ? h("p", { className: "dri-field-hint", key: "hint" }, props.hint) : null,
          props.error ? h("p", { className: "dri-field-error", key: "error" }, props.error) : null,
        ]);
      }

      function SwitchLine(props) {
        var input = h("input", {
          type: "checkbox",
          checked: props.checked === true,
          disabled: props.disabled === true,
          "aria-label": props.label,
          onChange: function (event) { props.onChange(event.target.checked); },
        }, null);
        return h("div", { className: "dri-field" }, [
          h("label", { className: "dri-switch", key: "switch" }, [input, h("span", { key: "text" }, props.label)]),
          props.hint ? h("p", { className: "dri-field-hint", key: "hint" }, props.hint) : null,
        ]);
      }

      function SelectLine(props) {
        var options = props.options.map(function (option) {
          return h("option", { value: option.value, key: option.value }, option.label);
        });
        return h(Field, {
          label: props.label,
          hint: props.hint,
          children: h("select", {
            className: "dri-select",
            value: props.value,
            disabled: props.disabled === true,
            onChange: function (event) { props.onChange(event.target.value); },
          }, options),
        });
      }

      function TextLine(props) {
        return h(Field, {
          label: props.label,
          hint: props.hint,
          error: props.error,
          children: h("input", {
            className: "dri-input",
            type: "text",
            value: props.value,
            placeholder: props.placeholder,
            disabled: props.disabled === true,
            "aria-invalid": props.error ? "true" : undefined,
            onChange: function (event) { props.onChange(event.target.value); },
          }, null),
        });
      }

      function IconButton(props) {
        return h("button", {
          type: "button",
          className: "dri-icon-button" + (props.danger ? " dri-button-danger" : ""),
          title: props.title,
          "aria-label": props.title,
          disabled: props.disabled === true,
          onClick: props.onClick,
        }, props.text);
      }

      /** 一条规则的编辑卡片。草稿是受控的，任何改动经 onChange 上抛整条规则。 */
      function RuleEditor(props) {
        var rule = props.rule;
        var t = props.t;
        var disabled = props.disabled === true;
        var problems = headerProblems(rule);
        var byName = {};
        problems.forEach(function (problem) { byName[problem.name.toLowerCase()] = problem.reason; });

        function patch(changes) {
          props.onChange(Object.assign({}, rule, changes));
        }

        function patchMatch(key, value) {
          patch({ match: Object.assign({}, rule.match, { [key]: value }) });
        }

        function patchHeader(index, changes) {
          var next = rule.headers.map(function (pair, at) {
            return at === index ? Object.assign({}, pair, changes) : pair;
          });
          patch({ headers: next });
        }

        var headerRows = rule.headers.map(function (pair, index) {
          var reason = pair.name.trim() === "" ? undefined : byName[pair.name.trim().toLowerCase()];
          var message =
            reason === "invalid"
              ? text(t, "invalidHeaderName", "非法请求头名称")
              : reason === "reserved"
                ? text(t, "reservedHeader", "保留头，会被忽略")
                : reason === "duplicate"
                  ? text(t, "duplicateHeader", "重复的请求头名称")
                  : reason === "badValue"
                    ? text(t, "badValue", "值只能是 Latin-1 字符，且不能包含换行（HTTP 头限制）")
                    : undefined;
          return h("div", { className: "dri-header-row", key: "header-" + index }, [
            h("div", { className: "dri-name", key: "name" }, h("input", {
              className: "dri-input",
              type: "text",
              value: pair.name,
              placeholder: "x-header-name",
              disabled: disabled,
              "aria-invalid": message ? "true" : undefined,
              "aria-label": text(t, "headerName", "名称"),
              onChange: function (event) { patchHeader(index, { name: event.target.value }); },
            }, null)),
            h("div", { className: "dri-value", key: "value" }, [
              h("input", {
                className: "dri-input",
                type: "text",
                value: pair.value,
                placeholder: "${sessionId}",
                disabled: disabled,
                "aria-label": text(t, "headerValue", "值"),
                onChange: function (event) { patchHeader(index, { value: event.target.value }); },
              }, null),
              message ? h("p", { className: "dri-field-hint", key: "hint" }, message) : null,
            ]),
            h(IconButton, {
              key: "remove",
              text: "✕",
              title: text(t, "removeHeader", "删除这个请求头"),
              disabled: disabled,
              onClick: function () {
                patch({
                  headers: rule.headers.filter(function (_pair, at) { return at !== index; }),
                });
              },
            }),
          ]);
        });

        return h("div", { className: "dri-rule" + (rule.enabled ? "" : " dri-rule-dim") }, [
          h("div", { className: "dri-rule-head", key: "head" }, [
            h("label", { className: "dri-switch", key: "enabled" }, [
              h("input", {
                type: "checkbox",
                checked: rule.enabled === true,
                disabled: disabled,
                "aria-label": text(t, "ruleEnabled", "启用"),
                onChange: function (event) { patch({ enabled: event.target.checked }); },
              }, null),
              h("span", { key: "text" }, text(t, "ruleEnabled", "启用") + " " + (props.index + 1)),
            ]),
            h("div", { className: "dri-actions", key: "actions" }, [
              h("div", { className: "dri-order", key: "order" }, h("input", {
                className: "dri-input",
                type: "number",
                value: String(rule.order),
                title: text(t, "order", "顺序"),
                "aria-label": text(t, "order", "顺序"),
                disabled: disabled,
                onChange: function (event) {
                  var value = Number(event.target.value);
                  patch({ order: isFinite(value) ? value : 0 });
                },
              }, null)),
              h(IconButton, {
                key: "up",
                text: "↑",
                title: text(t, "moveUp", "上移"),
                disabled: disabled || props.index === 0,
                onClick: function () { props.onMove(-1); },
              }),
              h(IconButton, {
                key: "down",
                text: "↓",
                title: text(t, "moveDown", "下移"),
                disabled: disabled || props.index === props.total - 1,
                onClick: function () { props.onMove(1); },
              }),
              h(IconButton, {
                key: "delete",
                text: text(t, "delete", "删除"),
                title: text(t, "removeRule", "删除这条规则"),
                danger: true,
                disabled: disabled,
                onClick: props.onRemove,
              }),
            ]),
          ]),
          h(TextLine, {
            key: "comment",
            label: text(t, "comment", "备注"),
            value: rule.comment,
            placeholder: text(t, "commentPlaceholder", ""),
            disabled: disabled,
            onChange: function (value) { patch({ comment: value }); },
          }),
          h("div", { className: "dri-row", key: "match" }, [
            h(TextLine, {
              key: "provider",
              label: text(t, "provider", "provider"),
              value: rule.match.provider,
              placeholder: "newapi-responses",
              disabled: disabled,
              onChange: function (value) { patchMatch("provider", value); },
            }),
            h(TextLine, {
              key: "model",
              label: text(t, "model", "model"),
              value: rule.match.model,
              placeholder: "deepseek-v4*",
              disabled: disabled,
              onChange: function (value) { patchMatch("model", value); },
            }),
            h(TextLine, {
              key: "host",
              label: text(t, "host", "host"),
              value: rule.match.host,
              hint: text(t, "hostHint", ""),
              placeholder: "api.example.com",
              disabled: disabled,
              onChange: function (value) { patchMatch("host", value); },
            }),
          ]),
          h("p", { className: "dri-field-hint", key: "match-hint" }, text(t, "matchHint", "")),
          h("div", { className: "dri-headers", key: "headers" }, headerRows.length > 0
            ? headerRows
            : [h("p", { className: "dri-field-hint", key: "empty" }, text(t, "headersEmpty", "还没有请求头"))]),
          h("div", { className: "dri-actions", key: "add" }, [
            h("button", {
              type: "button",
              className: "dri-button",
              disabled: disabled,
              onClick: function () {
                patch({ headers: rule.headers.concat([{ name: "", value: "" }]) });
              },
            }, text(t, "addHeader", "新增请求头")),
          ]),
        ]);
      }


      // ---------------------------------------------------------------- 表单
      function VariableList(props) {
        var t = props.t;
        var names = props.names;
        var items = names.map(function (name) {
          var label = text(t, "var" + name.charAt(0).toUpperCase() + name.slice(1), name);
          return h("li", { key: name }, [
            h("code", { key: "code" }, "${" + name + "}"),
            h("span", { key: "text" }, " — " + label),
          ]);
        });
        return h("div", { className: "dri-field" }, [
          h("span", { className: "dri-field-label", key: "label" }, text(t, "variables", "可用变量")),
          h("p", { className: "dri-field-hint", key: "hint" }, text(t, "variablesHint", "")),
          h("ul", { className: "dri-vars", key: "list" }, items),
        ]);
      }

      function StatusLine(props) {
        if (!props.message) return null;
        return h("p", {
          className: "dri-status" + (props.message.kind === "error" ? " dri-field-error" : ""),
          role: "status",
        }, props.message.text);
      }

      /** 插件行的配置页。宿主通过 slot props 传入 { t, view, form }。 */
      function RuleFormPage(props) {
        var t = props.t;
        var form = props.form;
        var snapshot = form && form.state;
        var status = snapshot && snapshot.status;

        var baselineState = React.useState(null);
        var baseline = baselineState[0];
        var setBaseline = baselineState[1];
        var draftState = React.useState(null);
        var draft = draftState[0];
        var setDraft = draftState[1];
        var busyState = React.useState(false);
        var busy = busyState[0];
        var setBusy = busyState[1];
        var messageState = React.useState(null);
        var message = messageState[0];
        var setMessage = messageState[1];
        var revisionRef = React.useRef(undefined);

        var dirty = draft !== null && baseline !== null && !sameDraft(draft, baseline);

        // 宿主快照变化时：未改动就把新值采纳为基线与草稿；已改动则保留草稿，
        // 由用户自行决定还原还是覆盖保存。
        React.useEffect(function () {
          if (!snapshot || snapshot.status !== "ready") return;
          if (baseline !== null && dirty) return;
          if (baseline !== null && revisionRef.current === snapshot.revision) return;
          var incoming = normalizeDraft(snapshot.value);
          revisionRef.current = snapshot.revision;
          setBaseline(incoming);
          setDraft(cloneDraft(incoming));
        }, [snapshot, snapshot && snapshot.status, snapshot && snapshot.revision, baseline, dirty]);

        if (status === "loading") return h("p", { className: "dri-field-hint" }, text(t, "loading", "加载中…"));
        if (status === "unavailable" || draft === null || baseline === null) {
          return h("p", { className: "dri-field-hint" }, text(t, "unavailable", "这一行没有可编辑的配置。"));
        }

        var writable = snapshot.writable !== false;
        var disabled = busy || !writable;
        var problems = [];
        draft.rules.forEach(function (rule) {
          headerProblems(rule).forEach(function (problem) {
            // 三类问题都拦保存：非法头名发出去会被拒，保留头注定被忽略，
            // 重名头在序列化时会被静默合并 —— 都会让用户以为配置生效了
            problems.push(problem);
          });
        });
        var invalid = problems.length > 0;

        function update(changes) {
          setDraft(Object.assign({}, draft, changes));
          setMessage(null);
        }

        function updateRule(index, next) {
          update({
            rules: draft.rules.map(function (rule, at) { return at === index ? next : rule; }),
          });
        }

        function moveRule(index, delta) {
          var target = index + delta;
          if (target < 0 || target >= draft.rules.length) return;
          var rules = draft.rules.slice();
          var moved = rules[index];
          rules[index] = rules[target];
          rules[target] = moved;
          // 只交换这两条的 order 值，不重排整表：手填过的 order 是有意义的，
          // 重排成 at*10 会把用户设的语义顺序悄悄改掉
          var movedOrder = moved.order;
          rules[target] = Object.assign({}, rules[target], { order: rules[index].order });
          rules[index] = Object.assign({}, rules[index], { order: movedOrder });
          update({ rules: rules });
        }

        function addRule() {
          // 新规则排在现有最大 order 之后：用 rules.length * 10 在删过规则之后
          // 会算出与既有 order 相同的值，导致排序结果取决于数组下标而非用户意图。
          var maxOrder = -Infinity;
          draft.rules.forEach(function (rule) {
            var order = Number(rule.order);
            if (Number.isFinite(order) && order > maxOrder) maxOrder = order;
          });
          var nextOrder = Number.isFinite(maxOrder) ? maxOrder + 10 : 0;
          var rules = draft.rules.concat([{
            id: newRuleId(),
            enabled: true,
            comment: "",
            match: { provider: "", model: "", host: "" },
            headers: [],
            order: nextOrder,
          }]);
          update({ rules: rules });
        }

        function removeRule(index) {
          update({ rules: draft.rules.filter(function (_rule, at) { return at !== index; }) });
        }

        function revert() {
          setDraft(cloneDraft(baseline));
          setMessage(null);
        }

        function save() {
          if (!form || busy || !writable || invalid) return;
          setBusy(true);
          setMessage(null);
          // dirty 期间上面那个 effect 会提前返回，revisionRef 不会跟进宿主快照，
          // 因此它保存的正是「本地基线对应的 revision」，提交时必须用它而不是
          // 屏幕上的最新 revision（后者可能已经被别人的改动推走）。
          var revision = revisionRef.current === undefined ? snapshot.revision : revisionRef.current;
          Promise.resolve()
            .then(function () {
              return form.mutate([{ op: "set", path: [], value: toConfig(draft) }], revision);
            })
            .then(function (accepted) {
              setBusy(false);
              if (accepted === false) {
                setMessage({ kind: "error", text: text(t, "saveFailed", "保存失败，请还原后重试。") });
                return;
              }
              setBaseline(cloneDraft(draft));
              // 复位后上面那个 effect 会重新对齐到宿主最新的 revision；不复位的话
              // revisionRef 会一直停在旧值，第二次保存会拿过期的 revision 去 CAS。
              revisionRef.current = undefined;
              setMessage({ kind: "ok", text: text(t, "saved", "已保存") });
            })
            .catch(function (error) {
              setBusy(false);
              var detail = error && error.message ? error.message : String(error);
              setMessage({ kind: "error", text: text(t, "saveRejected", "保存被拒绝：") + detail });
            });
        }

        var statusText = busy
          ? text(t, "saving", "保存中…")
          : message
            ? message.text
            : dirty
              ? text(t, "dirty", "有未保存的修改")
              : text(t, "noChange", "没有修改");

        return h("form", {
          className: "dri-form",
          onSubmit: function (event) { event.preventDefault(); save(); },
        }, [
          !writable
            ? h("p", { className: "dri-field-hint", key: "readonly" }, text(t, "readOnly", "当前配置不可写。"))
            : null,

          h("section", { className: "dri-card", key: "basic" }, [
            h("div", { className: "dri-card-head", key: "head" }, [
              h("h3", { className: "dri-card-title", key: "title" }, text(t, "basic", "基本")),
            ]),
            h(SwitchLine, {
              key: "enabled",
              label: text(t, "enabled", "启用插件"),
              hint: text(t, "enabledHint", ""),
              checked: draft.enabled,
              disabled: disabled,
              onChange: function (value) { update({ enabled: value }); },
            }),
            h(SelectLine, {
              key: "backend",
              label: text(t, "backend", "后端"),
              hint: text(t, "backendHint", ""),
              value: draft.backend,
              disabled: disabled,
              options: [
                { value: "auto", label: text(t, "backendAuto", "自动") },
                { value: "headers", label: text(t, "backendHeaders", "仅官方扩展点") },
                { value: "fetch", label: text(t, "backendFetch", "仅包装 fetch") },
              ],
              onChange: function (value) { update({ backend: value }); },
            }),
            h(SelectLine, {
              key: "missing",
              label: text(t, "onMissingVariable", "变量缺失时"),
              hint: text(t, "missingHint", ""),
              value: draft.onMissingVariable,
              disabled: disabled,
              options: [
                { value: "skip", label: text(t, "missingSkip", "跳过该请求头") },
                { value: "empty", label: text(t, "missingEmpty", "置为空串") },
                { value: "error", label: text(t, "missingError", "让本次请求失败") },
              ],
              onChange: function (value) { update({ onMissingVariable: value }); },
            }),
            h(SwitchLine, {
              key: "debug",
              label: text(t, "debug", "调试日志"),
              hint: text(t, "debugHint", ""),
              checked: draft.debug,
              disabled: disabled,
              onChange: function (value) { update({ debug: value }); },
            }),
          ]),

          h("section", { className: "dri-card", key: "rules" }, [
            h("div", { className: "dri-card-head", key: "head" }, [
              h("h3", { className: "dri-card-title", key: "title" }, text(t, "rules", "规则")),
              h("div", { className: "dri-actions", key: "actions" }, [
                h("button", {
                  type: "button",
                  className: "dri-button",
                  disabled: disabled,
                  onClick: addRule,
                }, text(t, "addRule", "新增规则")),
              ]),
            ]),
            h("p", { className: "dri-field-hint", key: "hint" }, text(t, "rulesHint", "")),
            draft.rules.length === 0
              ? h("p", { className: "dri-field-hint", key: "empty" }, text(t, "noRules", "还没有规则。"))
              : draft.rules.map(function (rule, index) {
                  return h(RuleEditor, {
                    key: rule.id,
                    rule: rule,
                    index: index,
                    total: draft.rules.length,
                    t: t,
                    disabled: disabled,
                    onChange: function (next) { updateRule(index, next); },
                    onMove: function (delta) { moveRule(index, delta); },
                    onRemove: function () { removeRule(index); },
                  });
                }),
          ]),

          h("section", { className: "dri-card", key: "vars" }, [
            h("div", { className: "dri-card-head", key: "head" }, [
              h("h3", { className: "dri-card-title", key: "title" }, text(t, "variables", "可用变量")),
            ]),
            h(VariableList, {
              key: "list",
              t: t,
              names: [
                "sessionId",
                "provider",
                "model",
                "baseURL",
                "purpose",
                "host",
                "date",
                "time",
                "timestamp",
                "uuid",
                "random",
              ],
            }),
          ]),

          h("div", { className: "dri-actions", key: "footer" }, [
            h("button", {
              type: "submit",
              className: "dri-button dri-button-primary",
              disabled: disabled || !dirty || invalid,
            }, text(t, "save", "保存")),
            h("button", {
              type: "button",
              className: "dri-button",
              disabled: disabled || !dirty,
              onClick: revert,
            }, text(t, "revert", "还原")),
            h(StatusLine, { key: "status", message: message }),
            h("span", { className: "dri-field-hint", key: "state" }, busy ? "" : statusText),
          ]),
        ]);
      }

      /** slot 入口：summary 视图只给一句话，page 视图给完整表单。 */
      function RuleForm(props) {
        if (props.view === "summary") {
          return h("span", null, text(props.t, "summary", "按 provider / model / host 匹配注入请求头"));
        }
        if (!React || !formUsable(props.form)) {
          return h("p", { className: "dri-field-hint" }, text(props.t, "unavailable", "这一行没有可编辑的配置。"));
        }
        return h(RuleFormPage, props);
      }

      function formUsable(form) {
        return !!form && typeof form.mutate === "function" && !!form.state;
      }

      /**
       * 设置面板里的整页入口。
       *
       * 宿主把注册项 inject 返回对象的 hooks.<name> 变成组件的 use<Name> prop，
       * 因此这里用 useConfigForm 订阅 ConfigFormController 的快照；写入方法由
       * 同一注册项的 mutate 字段原样传入，两者拼成 RuleFormPage 认识的 form。
       */
      function RuleFormSection(props) {
        var t = props.t;
        // 宿主未提供 hooks 时（例如单测直接渲染）退化为不可用提示，不抛错
        var snapshot = typeof props.useConfigForm === "function"
          ? props.useConfigForm(function (value) { return value; })
          : undefined;
        var form = snapshot === undefined
          ? null
          : { state: snapshot, mutate: props.mutate };
        return h("div", { className: "dri-section" }, [
          h("h2", { className: "dri-section-title", key: "title" },
            text(t, "settingsTitle", "请求头注入")),
          h("p", { className: "dri-field-hint", key: "hint" }, text(t, "settingsHint", "")),
          formUsable(form)
            ? h(RuleFormPage, { key: "form", t: t, form: form })
            : h("p", { className: "dri-field-hint", key: "empty" },
                text(t, "unavailable", "这一行没有可编辑的配置。")),
        ]);
      }

      // ---------------------------------------------------------------- 插件
      var inject = ["slots", "locale", "configForms"];

      function apply(ctx) {
        if (!React || typeof React.createElement !== "function") return;
        if (!ctx || !ctx.slots || !ctx.locale) return;

        if (typeof ctx.locale.register === "function") {
          ctx.effect(function () {
            return ctx.locale.register(NS, { zh: UI_zh, en: UI_en });
          }, "dsh-request-injector: locale");
        }

        // 样式安装放进 effect 里：ctx.effect 负责在卸载时回收，若在 effect 之外
        // 先 installStyles() 再捕获 disposer，插件热重载时会残留失效的 <style> 节点。
        ctx.effect(function () {
          return installStyles();
        }, "dsh-request-injector: styles");

        if (typeof ctx.slots.inject !== "function") return;
        ctx.slots.inject("plugins.row.config", function () {
          return ctx.slots.register(
            { name: "plugins.row.config", key: SLOT_KEY, locale: NS, order: 10 },
            RuleForm,
          );
        });

        // 设置面板直达入口：插件行详情页要下钻三层才看得到表单，这里在
        // 「设置」里再挂一个同名分区，路径缩短为一层。配置数据仍来自
        // configForms 服务，与行详情页共用同一个 namespace（即 ROW_ID）。
        var navT = typeof ctx.locale.bind === "function" ? ctx.locale.bind(NS) : null;
        var configForms = ctx.configForms;
        if (configForms && typeof configForms.get === "function") {
          ctx.slots.inject("settings.section", function () {
            var controller = configForms.get(ROW_ID);
            return ctx.slots.register(
              {
                name: "settings.section",
                id: ROW_ID,
                order: 20,
                label: function () { return text(navT, "settingsNav", "请求头注入"); },
                locale: NS,
                inject: function () {
                  return {
                    hooks: { configForm: controller },
                    mutate: function (ops, revision) { return controller.mutate(ops, revision); },
                  };
                },
              },
              RuleFormSection,
            );
          });
        }
      }

      exports.inject = inject;
      exports.apply = apply;

      exports.UI_zh = UI_zh;
      exports.UI_en = UI_en;
      exports.__internals = {
        NS: NS,
        ROW_ID: ROW_ID,
        SLOT_KEY: SLOT_KEY,
        DEFAULTS: DEFAULTS,
        RULE_DEFAULTS: RULE_DEFAULTS,
        normalizeDraft: normalizeDraft,
        isReserved: isReserved,
        isUsableHeaderValue: isUsableHeaderValue,
        HEADER_NAME: HEADER_NAME,
        sameDraft: sameDraft,
        cloneDraft: cloneDraft,
        newRuleId: newRuleId,
        toConfig: toConfig,
        headerProblems: headerProblems,
        formUsable: formUsable,
      };

      module.exports = exports;
      return module.exports;
    },
  });
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : null);
