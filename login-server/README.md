# 로그인 Todo

Node.js 24 이상으로 이 폴더에서 실행합니다.

~~~powershell
npm.cmd install
npm.cmd start
~~~

http://127.0.0.1:3000 에서 회원가입한 다음 로그인하면 달력과 할 일을 볼 수 있습니다.
로컬 기본값은 data/auth.sqlite입니다. 기존 독립형 todo.html의 브라우저 데이터는 기존 브라우저 저장소에 남습니다.

## 무료 Render 배포

1. Neon에서 무료 PostgreSQL 프로젝트를 만들고 TLS가 포함된 연결 문자열을 준비합니다.
2. Render에서 New → Blueprint를 선택하고 GitHub 저장소를 연결합니다.
3. DATABASE_URL에 연결 문자열을 입력합니다. 이 값은 저장소에 커밋하지 않습니다.
4. Render에 표시되는 HTTPS 주소로 접속합니다.

Render의 계정, 로그인 세션, 할 일은 모두 PostgreSQL에 저장됩니다.
