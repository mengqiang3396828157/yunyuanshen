/* ==========================================================
   资中二中校园网 · 公共脚本 v4
   包含：站点工具 / 成就系统(24) / 回访记忆 / 日期彩蛋
   ========================================================== */

// ---------- 站点常量 ----------
var SITE_START = new Date(2003, 2, 15);   // 2003-03-15 建站
var LS_PREFIX = 'zzez_';                  // 统一 localStorage 前缀

// ---------- 安全读写 localStorage ----------
function lsGet(key, def) {
  try {
    var v = localStorage.getItem(LS_PREFIX + key);
    return v === null ? def : v;
  } catch (e) { return def; }
}

function lsSet(key, val) {
  try { localStorage.setItem(LS_PREFIX + key, String(val)); } catch (e) {}
}

// ---------- 日期工具 ----------
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function todayCn() {
  var d = new Date();
  return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}

// 是否 4 月 7 日（日期彩蛋）
function isApril7() {
  var d = new Date();
  return d.getMonth() === 3 && d.getDate() === 7;
}

// ---------- 访客标识 ----------
function visitorTag() {
  var v = lsGet('visitor', null);
  if (!v) {
    v = '10.0.' + (Math.floor(Math.random() * 200) + 1) + '.' + (Math.floor(Math.random() * 250) + 2);
    lsSet('visitor', v);
  }
  return v;
}

// ---------- 本站已运行天数 ----------
function renderUptime() {
  var el = document.getElementById('uptime');
  if (!el) return;
  el.textContent = Math.floor((new Date() - SITE_START) / 86400000);
}

/* ==========================================================
   成就系统（24 个）
   主线 4 / 水塔支线 6 / 食堂支线 6 / 文化线 3 / 结局 3 / 交互 2
   ========================================================== */
var ACHIEVEMENTS = [
  // 主线 4
  { id: 'a01', name: '唯一的访客',     desc: '首次打开首页' },
  { id: 'a02', name: '坏掉的两个字',   desc: '解开口令「二中」' },
  { id: 'a03', name: '4 月 7 日',      desc: '解开口令「20030407」' },
  { id: 'a04', name: '三段',           desc: '集齐 2-8 / 3-1 / 4-6' },
  // 水塔支线 7
  { id: 'a05', name: '我来数一数',     desc: '读完值班表最后一行' },
  { id: 'a06', name: '第一条',         desc: '读到手册「接班人到齐后方可离岗」' },
  { id: 'a07', name: '翻历年日志',     desc: '翻完历年日志' },
  { id: 'a08', name: '那扇关着的窗',   desc: '在影像页注意到顶层窗格' },
  { id: 'a09', name: '倒着听',         desc: '触发校歌倒放' },
  { id: 'a10', name: '导航之外',       desc: '打开 sitemap.xml' },
  { id: 'a11', name: '代签，未上塔',   desc: '读到值班表 2007 年那行' },
  // 食堂支线 6
  { id: 'a12', name: '那道没卖过的菜', desc: '发现菜价表里那行是空的' },
  { id: 'a13', name: '被删的帖',       desc: '读完被删的帖子' },
  { id: 'a14', name: '十二年没断',     desc: '翻完留样登记本' },
  { id: 'a15', name: '多做了 30 份',   desc: '算出 2011 年 4 月的夜班餐' },
  { id: 'a16', name: '三分钟',         desc: '读到办公室里的三分钟' },
  { id: 'a17', name: '刷黑的板书',     desc: '看见被擦掉半行的粉笔字' },
  // 文化线 3
  { id: 'a18', name: '合订本里的灯',   desc: '在 2009 年校刊里看见水塔的灯' },
  { id: 'a19', name: '第 4 次',        desc: '读到陈敏笔记本上的记录' },
  { id: 'a20', name: '接收学校是空的', desc: '发现学籍异动的接收学校一栏空白' },
  // 结局 3
  { id: 'a21', name: '留校',           desc: '结局 A' },
  { id: 'a22', name: '下塔',           desc: '结局 B' },
  { id: 'a23', name: '交接完成',       desc: '结局 C（真结局）' },
  // 交互 2
  { id: 'a24', name: '你昨天来过',     desc: '触发回访记忆' },
  { id: 'a25', name: '一年只有一天',   desc: '在 4 月 7 日打开首页' }
];

function gotAch(id) {
  return lsGet('ach_' + id, '0') === '1';
}

function unlockAch(id) {
  if (gotAch(id)) return false;
  lsSet('ach_' + id, '1');
  var a = null;
  for (var i = 0; i < ACHIEVEMENTS.length; i++) {
    if (ACHIEVEMENTS[i].id === id) { a = ACHIEVEMENTS[i]; break; }
  }
  if (a) showAchToast('成就解锁：' + a.name);
  renderAchBar();
  return true;
}

function achCount() {
  var n = 0;
  for (var i = 0; i < ACHIEVEMENTS.length; i++) {
    if (gotAch(ACHIEVEMENTS[i].id)) n++;
  }
  return n;
}

function showAchToast(text) {
  var t = document.getElementById('achToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'achToast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 2200);
}

function renderAchBar() {
  var bar = document.getElementById('achBar');
  if (bar) bar.textContent = '已收集 ' + achCount() + '/' + ACHIEVEMENTS.length;
}

function buildAchPanel() {
  var panel = document.getElementById('achPanel');
  if (!panel) return;
  var html = '<h4>收集进度 ' + achCount() + '/' + ACHIEVEMENTS.length + '</h4>';
  for (var i = 0; i < ACHIEVEMENTS.length; i++) {
    var a = ACHIEVEMENTS[i];
    var got = gotAch(a.id);
    html += '<div class="ach-item' + (got ? ' got' : '') + '">' +
      (got ? a.name + '　' + a.desc : '？？？') +
      '</div>';
  }
  panel.innerHTML = html;
}

function initAchUI() {
  var bar = document.createElement('div');
  bar.id = 'achBar';
  bar.textContent = '已收集 ' + achCount() + '/' + ACHIEVEMENTS.length;
  bar.onclick = function () {
    var p = document.getElementById('achPanel');
    if (!p) {
      p = document.createElement('div');
      p.id = 'achPanel';
      document.body.appendChild(p);
    }
    buildAchPanel();
    p.classList.toggle('show');
  };
  document.body.appendChild(bar);
}

/* ==========================================================
   回访记忆
   ========================================================== */
function checkReturnVisit() {
  var visited = lsGet('visited', '0') === '1';
  lsSet('visited', '1');
  return { isReturn: visited };
}

function markPage(name) {
  lsSet('lastPage', name);
}

/* ==========================================================
   页面初始化
   ========================================================== */
document.addEventListener('DOMContentLoaded', function () {
  renderUptime();
  initAchUI();

  var y = document.getElementById('footYear');
  if (y) y.textContent = '2003';

  console.log('%c谁在维护这个站？', 'color:#888;font-size:14px;');
});
