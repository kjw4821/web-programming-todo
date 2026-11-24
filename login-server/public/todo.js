
'use strict';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const byId = id => document.getElementById(id);
const calendar = byId('calendar');
const input = byId('text');
const status = byId('status');
const fullDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' });
const monthLabel = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' });
const viewButtons = document.querySelectorAll('[data-view]');
let selected = new Date();
let view = 'month';
let editing = null;

function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + month + '-' + day;
}

function addDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

let tasks = {};
let ready = false;
let busy = false;

async function api(path, method = 'GET', body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch('/api/' + path, options);
  if (response.status === 401) location.replace('/');
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function setBusy(value) {
  busy = value;
  byId('submit').disabled = !ready || busy;
  byId('logout').disabled = busy;
  byId('tasks').querySelectorAll('button').forEach(button => { button.disabled = busy; });
}

async function mutate(action) {
  if (!ready || busy) return false;
  setBusy(true);
  status.textContent = '';
  try {
    await action();
    return true;
  } catch (error) {
    status.textContent = error.message || '할 일을 저장하지 못했습니다.';
    return false;
  } finally {
    setBusy(false);
  }
}

function resetForm() {
  editing = null;
  byId('form').reset();
  input.setCustomValidity('');
  byId('submit').textContent = '추가';
  byId('cancel').hidden = true;
}

function selectDate(date) {
  if (dateKey(date) !== dateKey(selected)) resetForm();
  selected = date;
  render();
}

function navigate(direction) {
  if (view === 'month') {
    const first = new Date(selected.getFullYear(), selected.getMonth() + direction, 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    first.setDate(Math.min(selected.getDate(), lastDay));
    selectDate(first);
    return;
  }
  selectDate(addDays(selected, direction * (view === 'week' ? 7 : 1)));
}

function renderCalendar() {
  calendar.replaceChildren();
  calendar.classList.toggle('day', view === 'day');
  viewButtons.forEach(button => button.setAttribute('aria-pressed', button.dataset.view === view));

  const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const daysInMonth = new Date(selected.getFullYear(), selected.getMonth() + 1, 0).getDate();
  const start = {
    day: selected,
    week: addDays(selected, -selected.getDay()),
    month: addDays(first, -first.getDay())
  }[view];
  const length = { day: 1, week: 7, month: Math.ceil((first.getDay() + daysInMonth) / 7) * 7 }[view];
  const end = addDays(start, length - 1);
  byId('period').textContent = {
    day: fullDate.format(selected),
    week: start.getFullYear() + '년 ' + shortDate.format(start) + ' – ' +
      (start.getFullYear() === end.getFullYear() ? '' : end.getFullYear() + '년 ') + shortDate.format(end),
    month: monthLabel.format(selected)
  }[view];

  if (view !== 'day') {
    for (const label of weekdays) {
      const heading = document.createElement('div');
      heading.className = 'weekday';
      heading.textContent = label;
      calendar.append(heading);
    }
  }

  const todayKey = dateKey(new Date());
  for (let offset = 0; offset < length; offset++) {
    const date = addDays(start, offset);
    const key = dateKey(date);
    const count = tasks[key]?.length ?? 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'date';
    button.dataset.date = key;
    button.classList.toggle('outside', view === 'month' && date.getMonth() !== selected.getMonth());
    button.textContent = date.getDate();
    button.setAttribute('aria-label', fullDate.format(date) + ', 할 일 ' + count + '개');
    button.setAttribute('aria-pressed', key === dateKey(selected));
    if (key === todayKey) button.setAttribute('aria-current', 'date');
    if (count) {
      const badge = document.createElement('span');
      badge.className = 'count';
      badge.textContent = count + '개';
      button.append(badge);
    }
    button.addEventListener('click', () => {
      selectDate(date);
      calendar.querySelector('[data-date="' + key + '"]').focus();
    });
    calendar.append(button);
  }
}

function renderTasks() {
  const list = tasks[dateKey(selected)] ?? [];
  byId('selected').textContent = fullDate.format(selected);
  byId('empty').hidden = !ready || list.length > 0;
  byId('tasks').replaceChildren();

  for (const task of list) {
    const row = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = task.text;

    const edit = document.createElement('button');
    edit.disabled = busy;
    edit.textContent = '수정';
    edit.setAttribute('aria-label', task.text + ' 수정');
    edit.addEventListener('click', () => {
      editing = task.id;
      input.setCustomValidity('');
      input.value = task.text;
      byId('submit').textContent = '저장';
      byId('cancel').hidden = false;
      input.focus();
      input.select();
    });

    const remove = document.createElement('button');
    remove.disabled = busy;
    remove.textContent = '삭제';
    remove.setAttribute('aria-label', task.text + ' 삭제');
    remove.addEventListener('click', async () => {
      const day = dateKey(selected);
      if (!await mutate(async () => {
        await api('tasks/' + encodeURIComponent(task.id), 'DELETE');
        tasks[day] = tasks[day].filter(item => item.id !== task.id);
      })) return;
      if (editing === task.id) resetForm();
      render();
      input.focus();
    });

    row.append(title, edit, remove);
    byId('tasks').append(row);
  }
}

function render() {
  renderCalendar();
  renderTasks();
}

byId('form').addEventListener('submit', async event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    input.setCustomValidity('할 일을 입력해 주세요.');
    input.reportValidity();
    return;
  }

  const day = dateKey(selected);
  const id = editing;
  const saved = await mutate(async () => {
    const task = id === null
      ? await api('tasks', 'POST', { day, text })
      : await api('tasks/' + encodeURIComponent(id), 'PATCH', { text });
    const list = tasks[task.day] ?? [];
    tasks[task.day] = id === null ? [...list, task] : list.map(item => item.id === task.id ? task : item);
  });
  if (!saved) return;
  if (dateKey(selected) === day && editing === id && input.value.trim() === text) resetForm();
  render();
  input.focus();
});

input.addEventListener('input', () => input.setCustomValidity(''));
byId('cancel').addEventListener('click', () => { resetForm(); input.focus(); });
byId('prev').addEventListener('click', () => navigate(-1));
byId('next').addEventListener('click', () => navigate(1));
byId('today').addEventListener('click', () => selectDate(new Date()));
viewButtons.forEach(button => button.addEventListener('click', () => {
  view = button.dataset.view;
  renderCalendar();
}));
byId('logout').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    await api('logout', 'POST', {});
    location.replace('/');
  } catch {
    status.textContent = '로그아웃하지 못했습니다. 다시 시도해 주세요.';
    setBusy(false);
  }
});

async function loadTasks() {
  try {
    const [user, rows] = await Promise.all([api('me'), api('tasks')]);
    byId('account-name').textContent = user.username;
    for (const task of rows) (tasks[task.day] ??= []).push(task);
    ready = true;
    setBusy(false);
    render();
  } catch {
    status.textContent = '할 일을 불러오지 못했습니다. 새로고침해 주세요.';
  }
}

render();
loadTasks();
