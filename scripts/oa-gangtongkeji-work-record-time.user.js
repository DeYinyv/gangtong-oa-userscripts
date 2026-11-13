// ==UserScript==
// @name         港通科技 OA - 工作记录时间快捷填充
// @namespace    https://oa.gangtongkeji.com/gm/work-record-time
// @version      0.5.0
// @description  在「添加工作记录」弹层标题栏添加「上午」「下午」「餐补」「车补」按钮，一键填入可自定义的预设时间，打开弹层默认填「上午」预设；扩展页「高级功能」开关可放开日期选择限制
// @match        https://oa.gangtongkeji.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

/* ==UserConfig==
advanced:
  historyDateUnlock:
    title: 高级功能
    description: 关闭时「时间范围」保持页面原生限制（只能选最近 7 天）；开启后可选今天及以前的任意一天。切换后重新打开弹层即生效
    type: checkbox
    default: false
 ==/UserConfig== */

(function () {
  'use strict';

  // #region 常量配置

  // 目标弹层标题文字（layui-layer-title 的纯文本）
  const TITLE_TEXT = '添加工作记录';

  // 预设按钮：key 对应存储里的字段，label 既是按钮文字，也是设置面板里的行名
  const PRESET_BUTTONS = [
    { key: 'morning', label: '上午' },
    { key: 'afternoon', label: '下午' },
    { key: 'meal', label: '餐补' },
    { key: 'car', label: '车补' },
  ];

  // 预设时间的默认值（用户在「时间预设」面板里改过的值会覆盖它）
  const DEFAULT_PRESET_TIMES = {
    morning: { start: '08:00', end: '12:00' },
    afternoon: { start: '13:00', end: '17:00' },
    meal: { start: '18:00', end: '20:00' },
    car: { start: '18:00', end: '21:30' },
  };

  // GM 存储键：保存全部预设时间，形如 { morning: {start,end}, afternoon: {...}, meal: {...}, car: {...} }
  const STORAGE_KEY = 'sc_work_time_presets';

  // 高级功能开关的存储键：由扩展页「脚本配置」里的 UserConfig 开关写入，未设置时视为 false
  const ADVANCED_DATE_KEY = 'advanced.historyDateUnlock';

  // 备选定位：用户提供的绝对 XPath（按真实页面核对：div[1] 是开始时间，div[2] 是结束时间）
  const FALLBACK_XPATH = {
    start: '/html/body/div[5]/div[2]/form/table/tbody/tr[1]/td[2]/div[1]/div',
    end: '/html/body/div[5]/div[2]/form/table/tbody/tr[1]/td[2]/div[2]/div',
  };

  // 工作类别默认值（真实页面核对：select#work_cate 里「系统开发」唯一，value = 9）
  const DEFAULT_CATEGORY_VALUE = '9';

  // 工作类型默认值（真实页面核对：单选组 input[name=labor_type]，案头工作 = 1、外勤工作 = 2）
  const DEFAULT_LABOR_TYPE_VALUE = '1';

  // #endregion

  // #region 定位时间控件

  /**
   * 在弹层内找到某个时间控件的 layui 渲染外壳（.layui-form-select）
   * 优先用弹层内的相对定位：select#id -> 同级的 .layui-form-select
   * 找不到时退回绝对 XPath
   * @param {HTMLElement} layer 弹层根节点 .layui-layer
   * @param {string} selectId 时间下拉的原生 select id
   * @param {string} xpath 备选的绝对 XPath
   * @returns {HTMLElement|null}
   */
  function findWrapper(layer, selectId, xpath) {
    const select = layer.querySelector('select[id="' + selectId + '"]');
    if (select && select.parentNode) {
      const wrapper = select.parentNode.querySelector('.layui-form-select');
      if (wrapper) return wrapper;
    }

    const doc = layer.ownerDocument;
    return doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  }

  // #endregion

  // #region 写入时间

  /**
   * 把一个时间控件设为指定值
   * 做法是点击 layui 自己的下拉项 dd，让 layui 内部逻辑同步原生 select、显示框和选中高亮，
   * 比直接改 value 更接近真实操作，提交时取到的值也一致
   * @param {HTMLElement} wrapper .layui-form-select 外壳
   * @param {string} value 目标时间，如 "08:00"
   */
  function setTime(wrapper, value) {
    if (!wrapper) return;
    const items = Array.from(wrapper.querySelectorAll('dd'));
    const target = items.find(function (dd) {
      return dd.getAttribute('lay-value') === value;
    });
    if (target) target.click();
  }

  /**
   * 同时设置开始与结束时间
   * @param {HTMLElement} layer 弹层根节点
   * @param {string} start 开始时间
   * @param {string} end 结束时间
   */
  function applyPreset(layer, start, end) {
    setTime(findWrapper(layer, 'start_time_b', FALLBACK_XPATH.start), start);
    setTime(findWrapper(layer, 'end_time_b', FALLBACK_XPATH.end), end);
  }

  /**
   * 弹层打开时把时间范围预填成「上午」预设
   * 页面原生默认是 09:00 / 09:30，要等 layui 把下拉项 dd 渲染出来再点，否则点不到
   * @param {HTMLElement} layer 弹层根节点
   * @param {number} [retry] 已重试次数
   */
  function applyMorningPreset(layer, retry) {
    const startWrapper = findWrapper(layer, 'start_time_b', FALLBACK_XPATH.start);
    const endWrapper = findWrapper(layer, 'end_time_b', FALLBACK_XPATH.end);
    const ready =
      startWrapper && endWrapper && startWrapper.querySelector('dd') && endWrapper.querySelector('dd');

    // 下拉项还没渲染出来时短暂重试，和默认工作类别同样的时序处理
    if (!ready) {
      if (!retry || retry < 10) {
        setTimeout(function () {
          applyMorningPreset(layer, (retry || 0) + 1);
        }, 100);
      }
      return;
    }

    applyPreset(layer, presetTimes.morning.start, presetTimes.morning.end);
  }

  // #endregion

  // #region 默认值（工作类别 / 工作类型）

  /**
   * 把「工作类别」设为默认值（系统开发）
   * 只在弹层打开时调用一次，之后用户手动改动不会被再次覆盖
   * @param {HTMLElement} layer 弹层根节点
   * @param {number} [retry] 已重试次数（layui 表单渲染可能晚于标题出现）
   */
  function applyDefaultCategory(layer, retry) {
    const select = layer.querySelector('select#work_cate');
    const wrapper = select && select.parentNode.querySelector('.layui-form-select');
    const options = wrapper ? Array.from(wrapper.querySelectorAll('dd')) : [];
    const target = options.find(function (dd) {
      return dd.getAttribute('lay-value') === DEFAULT_CATEGORY_VALUE;
    });

    // 下拉项还没渲染出来时短暂重试，避免表单渲染时序问题
    if (!target) {
      if (!retry || retry < 10) {
        setTimeout(function () {
          applyDefaultCategory(layer, (retry || 0) + 1);
        }, 100);
      }
      return;
    }

    // 已经是默认值就不再点击，避免多余事件
    if (select.value === DEFAULT_CATEGORY_VALUE) return;
    target.click();
  }

  /**
   * 把「工作类型」设为默认值（案头工作）
   * 同样只在弹层打开时调用一次；点 layui 渲染出的 div.layui-form-radio 才能同步选中样式
   * @param {HTMLElement} layer 弹层根节点
   */
  function applyDefaultLaborType(layer) {
    const radio = layer.querySelector(
      'input[name="labor_type"][value="' + DEFAULT_LABOR_TYPE_VALUE + '"]'
    );
    if (!radio || radio.checked) return;

    const styled = radio.nextElementSibling;
    // 有 layui 渲染层就点它，保证样式与取值一起更新
    if (styled && styled.classList.contains('layui-form-radio')) {
      styled.click();
    } else {
      radio.click();
    }
  }

  // #endregion

  // #region 放开日期选择范围

  /**
   * 去掉「时间范围」日期控件的「只能选最近 7 天」限制
   * 页面原逻辑：laydate.render({ min: -7, max: 0 })，min 把 7 天前的日期置灰
   * 做法：取原实例配置重新渲染，只是不再传 min；max 保留，所以今天及以前都能选、未来仍不可选
   * 注意：done 回调必须沿用原函数——它闭包里同步了页面内部的 detail 变量，丢了会导致提交时提示「请选择工作时间范围」
   * @param {HTMLElement} layer 弹层根节点
   * @param {number} [retry] 已重试次数（页面的 render 在弹层 success 回调里，可能晚于标题出现）
   */
  function removeMinDateLimit(layer, retry) {
    const startInput = layer.querySelector('#start_time_a');
    const endInput = layer.querySelector('#end_time_a');
    if (!startInput || !endInput) return;

    // 加了 GM 权限后脚本运行在沙箱里，window 不是页面 window，必须用 unsafeWindow 取页面上的 layui
    const laydate = unsafeWindow.layui && unsafeWindow.layui.laydate;
    if (!laydate) return;

    const startInst = laydate.getInst('start_time_a');
    const endInst = laydate.getInst('end_time_a');

    // 页面还没 render 出实例时短暂重试，避免时序问题
    if (!startInst || !endInst || !startInst.config || !endInst.config) {
      if (!retry || retry < 20) {
        setTimeout(function () {
          removeMinDateLimit(layer, (retry || 0) + 1);
        }, 100);
      }
      return;
    }

    const startConfig = startInst.config;
    const endConfig = endInst.config;

    // 先解绑旧实例，避免重复渲染后同一个控件绑了多份事件、点一次弹出多个面板
    laydate.unbind('start_time_a');
    laydate.unbind('end_time_a');

    // 按原配置重新渲染，只是不传 min
    // 注意 max 要传页面原始的 0（表示今天）：实例里的 max 是 laydate 解析后的对象，原样传回去会被再次解析而报错
    laydate.render({
      elem: '#start_time_a',
      type: startConfig.type,
      max: 0,
      format: startConfig.format,
      showBottom: startConfig.showBottom,
      done: startConfig.done,
    });
    laydate.render({
      elem: '#end_time_a',
      type: endConfig.type,
      max: 0,
      format: endConfig.format,
      showBottom: endConfig.showBottom,
      done: endConfig.done,
    });
  }

  // #endregion

  // #region 时间预设设置

  // 面板元素 id（同一时间只会存在一个）
  const PANEL_ID = 'sc-work-time-settings';

  // 面板内输入框、按钮的公共样式
  const INPUT_STYLE =
    'height:28px;padding:0 4px;border:1px solid #d2d2d2;border-radius:2px;font-size:13px;color:#333;';
  const PANEL_BUTTON_STYLE =
    'height:28px;padding:0 12px;font-size:13px;cursor:pointer;color:#666;background:#fff;' +
    'border:1px solid #d2d2d2;border-radius:2px;';

  // 当前生效的预设时间：启动时从 GM 存储读取，点「上午」「下午」时使用
  let presetTimes = loadPresetTimes();

  // 「时间预设」按钮的引用，用来判断点击是否在面板外部
  let settingsAnchor = null;

  /**
   * 判断是否为合法时间：格式 HH:mm，且分钟是 15 的整数倍（与控件 15 分钟粒度一致）
   * @param {string} value
   * @returns {boolean}
   */
  function isValidTime(value) {
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) return false;
    return Number(value.slice(3)) % 15 === 0;
  }

  /**
   * 校验一组起止时间，返回错误提示文字；合法时返回空字符串
   * @param {string} label 用于提示的组名（上午 / 下午）
   * @param {string} start
   * @param {string} end
   * @returns {string}
   */
  function checkPair(label, start, end) {
    if (!isValidTime(start) || !isValidTime(end)) {
      return label + '时间格式不对，请选 HH:mm 且为 15 分钟粒度';
    }
    // HH:mm 定长补零，字符串比较等价于时间先后比较
    if (end <= start) return label + '结束时间要晚于开始时间';
    return '';
  }

  /**
   * 从 GM 存储读取预设时间
   * 某一组不存在或不合法（例如被手动改坏）就回落到默认值，绝不把坏值带进表单
   * 旧版本只存了上午/下午，新增的餐补/车补会自动用默认值补齐
   * @returns {Object} 形如 { morning: {start, end}, afternoon: {...}, meal: {...}, car: {...} }
   */
  function loadPresetTimes() {
    // 先用默认值铺底，保证每个预设都有可用值
    const result = {};
    PRESET_BUTTONS.forEach(function (preset) {
      const def = DEFAULT_PRESET_TIMES[preset.key];
      result[preset.key] = { start: def.start, end: def.end };
    });

    const saved = GM_getValue(STORAGE_KEY, null);
    if (!saved || typeof saved !== 'object') return result;

    // 存储里通过校验的值覆盖默认值
    PRESET_BUTTONS.forEach(function (preset) {
      const item = saved[preset.key];
      if (item && checkPair('', item.start, item.end) === '') {
        result[preset.key] = { start: item.start, end: item.end };
      }
    });
    return result;
  }

  /**
   * 生成一行设置项（组名 + 开始输入框 + 结束输入框）
   * 用原生 input[type=time] 且 step=900（15 分钟），提交值就是 HH:mm
   */
  function buildRow(label, key, times) {
    return (
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">' +
      '<span style="width:34px;color:#555;">' + label + '</span>' +
      '<input type="time" step="900" data-key="' + key + '" data-role="start" value="' +
      times.start + '" style="' + INPUT_STYLE + '">' +
      '<span style="color:#999;">-</span>' +
      '<input type="time" step="900" data-key="' + key + '" data-role="end" value="' +
      times.end + '" style="' + INPUT_STYLE + '">' +
      '</div>'
    );
  }

  /**
   * 读取面板里某组的某个输入框的值
   */
  function readPanelTime(panel, key, role) {
    return panel.querySelector('input[data-key="' + key + '"][data-role="' + role + '"]').value;
  }

  /**
   * 关闭设置面板并清理外部点击监听
   */
  function closeSettingsPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
    settingsAnchor = null;
    document.removeEventListener('mousedown', onOutsideMouseDown, true);
  }

  /**
   * 点击面板与「时间预设」按钮之外的地方就关闭面板
   * 用捕获阶段，避免被内部元素 stopPropagation 拦住
   */
  function onOutsideMouseDown(e) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    // 弹层被关掉（「时间预设」按钮已不在文档里）时也一并关闭面板
    if (!settingsAnchor || !document.body.contains(settingsAnchor)) {
      closeSettingsPanel();
      return;
    }
    if (panel.contains(e.target) || settingsAnchor.contains(e.target)) return;
    closeSettingsPanel();
  }

  /**
   * 打开预设时间编辑面板
   * 面板挂到 body 上并 position:fixed，不放进标题栏，所以不影响标题拖动和关闭按钮
   * @param {HTMLElement} anchor 「时间预设」按钮，用来定位面板
   */
  function openSettingsPanel(anchor) {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText =
      'position:fixed;z-index:19891015;width:250px;padding:12px;box-sizing:border-box;' +
      'background:#fff;border:1px solid #d2d2d2;border-radius:4px;' +
      'box-shadow:0 2px 12px rgba(0,0,0,.18);font-size:13px;color:#333;';
    panel.innerHTML =
      '<div style="margin-bottom:10px;font-size:14px;color:#333;">时间预设</div>' +
      buildRow('上午', 'morning', presetTimes.morning) +
      buildRow('下午', 'afternoon', presetTimes.afternoon) +
      buildRow('餐补', 'meal', presetTimes.meal) +
      buildRow('车补', 'car', presetTimes.car) +
      '<div data-role="error" style="min-height:18px;line-height:18px;font-size:12px;color:#ff5722;"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:6px;">' +
      '<button type="button" data-role="reset" style="' + PANEL_BUTTON_STYLE + '">恢复默认</button>' +
      '<button type="button" data-role="save" style="' + PANEL_BUTTON_STYLE +
      'color:#16baaa;border-color:#16baaa;">保存</button>' +
      '</div>';

    document.body.appendChild(panel);

    // 定位到「设置」按钮正下方；右侧空间不够时往左收，避免超出窗口
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8);
    panel.style.top = rect.bottom + 6 + 'px';
    panel.style.left = Math.max(8, left) + 'px';

    const errorEl = panel.querySelector('[data-role="error"]');

    // 保存：先校验全部预设，任意一组不合法就只在面板里提示，不写存储、不影响当前生效值
    panel.querySelector('[data-role="save"]').addEventListener('click', function () {
      const values = {};
      let error = '';

      PRESET_BUTTONS.forEach(function (preset) {
        const item = {
          start: readPanelTime(panel, preset.key, 'start'),
          end: readPanelTime(panel, preset.key, 'end'),
        };
        values[preset.key] = item;
        // 累积第一条错误提示
        error = error || checkPair(preset.label, item.start, item.end);
      });

      if (error) {
        errorEl.textContent = error;
        return;
      }

      GM_setValue(STORAGE_KEY, values);
      presetTimes = values;
      closeSettingsPanel();
    });

    // 恢复默认：直接写回默认值并生效，省掉再点一次保存
    panel.querySelector('[data-role="reset"]').addEventListener('click', function () {
      GM_setValue(STORAGE_KEY, DEFAULT_PRESET_TIMES);
      presetTimes = loadPresetTimes();
      closeSettingsPanel();
    });

    settingsAnchor = anchor;
    document.addEventListener('mousedown', onOutsideMouseDown, true);
  }

  // #endregion

  // #region 往标题栏注入按钮

  /**
   * 给一个「添加工作记录」弹层加按钮；已经加过则跳过
   * @param {HTMLElement} title 标题元素 .layui-layer-title
   */
  function addButtons(title) {
    if (title.dataset.scWorkTimeAdded === '1') return;
    title.dataset.scWorkTimeAdded = '1';

    const layer = title.parentNode;
    if (!layer) return;

    // 按钮容器紧跟在标题文字后面排布（左对齐），用行内元素，不改变标题栏高度
    const bar = document.createElement('span');
    bar.style.cssText =
      'display:inline-flex;align-items:center;gap:8px;margin-left:10px;vertical-align:middle;';

    PRESET_BUTTONS.forEach(function (preset) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = preset.label;
      // 样式贴近 layui 标题栏：放大后的尺寸仍然装得进 42px 行高，不撑高标题栏
      btn.style.cssText =
        'height:28px;line-height:26px;padding:0 16px;font-size:13px;cursor:pointer;' +
        'color:#16baaa;background:#fff;border:1px solid #16baaa;border-radius:3px;' +
        'transition:background-color .35s ease,color .35s ease;';
      // 阻止 mousedown 冒泡，避免点击按钮时触发标题栏的拖动
      btn.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        // 每次点击时取当前生效值，用户在「时间预设」里改过的时间立刻生效
        const times = presetTimes[preset.key];
        applyPreset(layer, times.start, times.end);
        // 闪烁提示：先快速闪成主题绿（0.1s 闪入），再慢速淡回白色（0.45s 淡出）
        btn.style.transition = 'background-color .1s ease, color .1s ease';
        btn.style.backgroundColor = '#16baaa';
        btn.style.color = '#fff';
        setTimeout(function () {
          btn.style.transition = 'background-color .45s ease, color .45s ease';
          btn.style.backgroundColor = '#fff';
          btn.style.color = '#16baaa';
        }, 150);
      });
      bar.appendChild(btn);
    });

    // 「时间预设」按钮：打开预设时间编辑面板，尺寸比预设按钮略小
    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.textContent = '时间预设';
    settingsBtn.title = '修改上午 / 下午 / 餐补 / 车补的预设时间';
    settingsBtn.style.cssText =
      'height:24px;line-height:22px;padding:0 12px;font-size:12px;cursor:pointer;' +
      'color:#16baaa;background:#fff;border:1px solid #16baaa;border-radius:3px;';
    settingsBtn.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    settingsBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openSettingsPanel(settingsBtn);
    });
    bar.appendChild(settingsBtn);

    title.appendChild(bar);

    // 弹层刚打开时设置一次工作类别与工作类型的默认值，并把时间范围预填为「上午」预设
    applyDefaultCategory(layer);
    applyDefaultLaborType(layer);
    applyMorningPreset(layer);
    // 只有扩展页「高级功能」开关打开时才放开日期限制；每次弹层注入读一次，切换开关后重开弹层即生效
    if (GM_getValue(ADVANCED_DATE_KEY, false)) removeMinDateLimit(layer);
  }

  // #endregion

  // #region 监听弹层出现

  // 扫描当前文档里所有目标弹层并注入按钮（弹层是异步弹出的，需要反复扫）
  function scan() {
    const titles = document.querySelectorAll('.layui-layer-title');
    for (let i = 0; i < titles.length; i++) {
      const title = titles[i];
      if (title.textContent.trim() === TITLE_TEXT) addButtons(title);
    }
  }

  // 弹层可能在脚本执行后才出现，也可能重复打开，用 MutationObserver 持续监听
  scan();
  new MutationObserver(scan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // #endregion
})();
