/* ==========================================================
   资中二中校园网 · 公共脚本 v3
   包含：站点工具 / 成就系统 / 回访记忆 / 日期彩蛋
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
   成就系统（20 个）
   ========================================================== */
var ACHIEVEMENTS = [
  { id: 'a01', name: '唯一的访客',       desc: '首次打开首页' },
  { id: 'a02', name: '坏掉的两个字',     desc: '解开口令「二中」' },
  { id: 'a03', name: '4 月 7 日',        desc: '解开口令「20030407」' },
  { id: 'a04', name: '三段',             desc: '集齐 2-8 / 3-1 / 4-6' },
  { id: 'a05', name: '我来数一数',       desc: '读完观察者名单最后一行' },
  { id: 'a06', name: '第一条',           desc: '读到手册「接班人到齐后方可离岗」' },
  { id: 'a07', name: '二十行一样',       desc: '翻完历年日志' },
  { id: 'a08', name: '那扇关着的窗',     desc: '在影像页注意到顶层窗格' },
  { id: 'a09', name: '新锁',             desc: '在旧帖注意到 5 楼' },
  { id: 'a10', name: '23:16',            desc: '输入校验码 2316' },
  { id: 'a11', name: '水位 0.61',        desc: '打开原始数据页' },
  { id: 'a12', name: '倒着听',           desc: '触发校歌倒放' },
  { id: 'a13', name: '接线员',           desc: '结局 D' },
  { id: 'a14', name: '第二位',           desc: '结局 A' },
  { id: 'a15', name: '登记',             desc: '结局 B' },
  { id: 'a16', name: '回头',             desc: '结局 C' },
  { id: 'a17', name: '一起关掉',         desc: '结局 E' },
  { id: 'a18', name: '交接完成',         desc: '结局 F' },
  { id: 'a19', name: '导航之外',         desc: '打开 sitemap.xml' },
  { id: 'a20', name: '你昨天来过',       desc: '触发回访记忆' }
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
  var last = lsGet('lastPage', null);
  var visited = lsGet('visited', '0') === '1';
  lsSet('visited', '1');
  return { isReturn: visited, lastPage: last };
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

  // 页脚年份
  var y = document.getElementById('footYear');
  if (y) y.textContent = '2003';

  // 控制台留言
  console.log('%c谁在维护这个站？', 'color:#888;font-size:14px;');
});
