/* ==========================================================
   资中二中校园网 · 公共脚本
   ========================================================== */

// 站点建站日期（用于"本站已运行 XXX 天"）
var SITE_START = new Date(2003, 2, 15); // 2003-03-15

// 渲染"本站已运行"天数
function renderUptime() {
  var el = document.getElementById('uptime');
  if (!el) return;
  var now = new Date();
  var days = Math.floor((now - SITE_START) / 86400000);
  el.textContent = days;
}

// 输出今天的日期（YYYY-MM-DD）
function todayStr() {
  var d = new Date();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

// 输出今天的日期（中文）
function todayCn() {
  var d = new Date();
  return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}

// 当前时间 HH:MM
function nowHM() {
  var d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// 获取访客标识（无联网，用本地随机 ID 模拟"IP"）
function visitorTag() {
  var key = 'zz2z_visitor';
  var v = null;
  try { v = localStorage.getItem(key); } catch (e) {}
  if (!v) {
    // 生成一个像内网 IP 的标识
    var a = 10, b = 0, c = Math.floor(Math.random() * 200) + 1, d = Math.floor(Math.random() * 250) + 2;
    v = a + '.' + b + '.' + c + '.' + d;
    try { localStorage.setItem(key, v); } catch (e) {}
  }
  return v;
}

// 页面初始化
document.addEventListener('DOMContentLoaded', function () {
  renderUptime();

  // 页脚年份
  var y = document.getElementById('footYear');
  if (y) y.textContent = '2003';

  // 控制台留一句
  console.log('%c谁在维护这个站？', 'color:#888;font-size:14px;');
});
