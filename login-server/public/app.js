const byId = (id) => document.getElementById(id);
const form = byId('auth');
const username = byId('username');
const password = byId('password');
const submit = byId('submit');
const loginTab = byId('login-tab');
const registerTab = byId('register-tab');
let mode = 'login';

function showStatus(message = '', error = false) {
  const status = byId('status');
  status.textContent = message;
  status.dataset.error = String(error);
}

function showForm(nextMode) {
  mode = nextMode;
  const registering = mode === 'register';
  loginTab.setAttribute('aria-pressed', String(!registering));
  registerTab.setAttribute('aria-pressed', String(registering));
  const label = registering ? '회원가입' : '로그인';
  byId('title').textContent = label;
  submit.textContent = label;
  byId('rules').hidden = !registering;
  password.autocomplete = registering ? 'new-password' : 'current-password';
  password.value = '';
  form.hidden = false;
  byId('menu').hidden = false;
  showStatus();
}

async function request(path, body) {
  const options = body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  const response = await fetch('/api/' + path, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(data.error);
    error.status = response.status;
    throw error;
  }
  return data;
}

loginTab.addEventListener('click', () => { showForm('login'); username.focus(); });
registerTab.addEventListener('click', () => { showForm('register'); username.focus(); });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = loginTab.disabled = registerTab.disabled = true;
  showStatus();
  try {
    const user = await request(mode, { username: username.value, password: password.value });
    if (mode === 'register') {
      showForm('login');
      username.value = user.username;
      showStatus('가입이 완료되었습니다. 비밀번호를 입력해 로그인하세요.');
      password.focus();
    } else {
      location.replace('/todo');
    }
  } catch (error) {
    showStatus(error.status ? error.message : '서버 연결을 확인해 주세요.', true);
  } finally {
    submit.disabled = loginTab.disabled = registerTab.disabled = false;
  }
});

loginTab.disabled = registerTab.disabled = true;
request('me').then(() => location.replace('/todo')).catch((error) => {
  if (error.status !== 401) showStatus('로그인 상태를 확인할 수 없습니다.', true);
}).finally(() => { submit.disabled = loginTab.disabled = registerTab.disabled = false; });

