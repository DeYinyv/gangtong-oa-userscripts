// ==UserScript==
// @name         HRM 考勤日历 - 打卡记录自动滚到底
// @namespace    http://221.0.113.37/spa/hrm/static4attendance/attendance-checking
// @version      0.1.0
// @description  把考勤日历每个日期格子的打卡记录滚动到底部，完整显示 4 条打卡数据
// @match        http://221.0.113.37:88/spa/hrm/static4attendance/index.html*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // #region 常量配置

  // 日期格子内部真正可滚动的容器：antd 日历单元格内容区（overflow-y 是 scroll）
  const CELL_SELECTOR = '.ant-fullcalendar-content';

  // #endregion

  // #region 滚动逻辑

  // 把所有格子的滚动位置设到底部
  // scrollTop 超出范围时浏览器会自动夹到最大值，所以直接赋 scrollHeight 即可
  function scrollCellsToBottom() {
    const cells = document.querySelectorAll(CELL_SELECTOR);
    for (let i = 0; i < cells.length; i++) {
      cells[i].scrollTop = cells[i].scrollHeight;
    }
  }

  // #endregion

  // #region 监听渲染与内容变化

  // 日历是异步渲染的：初次进页、切换月份、打卡数据回填都会重建或撑高格子内容
  // 用 requestAnimationFrame 合并同一帧内的多次变化，避免重复滚动
  let scheduled = false;

  function scheduleScroll() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      scrollCellsToBottom();
    });
  }

  // 先处理当前已渲染的格子
  scrollCellsToBottom();

  // 之后任何 DOM 结构或文本变化都重新滚一次（覆盖切月、数据异步加载变高）
  new MutationObserver(scheduleScroll).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // #endregion
})();
