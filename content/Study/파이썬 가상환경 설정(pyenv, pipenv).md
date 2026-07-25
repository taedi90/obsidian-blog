---
title: 파이썬 가상환경 설정(pyenv, pipenv)
date: 2021-09-18
draft: false
tags:
  - python
banner: 
cssclasses: 
description: 파이썬 가상환경 설정을 위한 pyenv, pipenv 사용법.
permalink: 
aliases:
  - "ETC/파이썬 가상환경 설정(pyenv, pipenv)"
completed:
---
오랜만에 파이썬을 사용하려고 보니 `pyenv` 와 `pipenv` 용어들은 기억나는데 좀처럼 어떻게 써야할지 감이 잡히지 않았다. 물론 글로벌 환경에서 작업해도 무방했지만 소싯적 시험기간에 공부보단 책상정리에 열중했던 주의력 산만한 학생으로서 두가지를 반드시 사용해야겠다는 결의를 다져보았다. 찾아보니 예전에 같은 주제로 메모도 해두었지만 나조차 이해가 되지않을 만큼의 내용으로 도움이 되지 않았고 이에 새롭게 `파이썬 가상환경 사용방법`을 알아 보았다. 물론 파이썬 가상환경의 전반적인 부분은 아니고 내가 사용할 만큼, 그리고 세팅하면서 발생하는 의구심에 대한 부분을 나의 눈높이 정도로 정리하였다. (막상 쓰고보니 이전에 쓴 글이 이해되는 것 같은.. 그때 훨씬 더 많이 알고 있었을지도?)

# 내용

`가상환경`은 간단하게 말해 프로젝트마다 독립된 방을 만들어서 각각의 프로젝트를 별도의 환경으로 구성하거나 여러 pc 혹은 협업자와 동일한 환경을 구성하는 것을 좀 더 좀 더 편리하게 해주는 툴이라고 볼 수 있다.

  

프로젝트마다 환경을 다르게 해주는 이유는 무엇인가? 예를 들면 파이썬 3.9 버전을 사용하고 있는데 내가 써야할 패키지는 3.6버전에서만 동작한다면 3.9버전을 삭제하고 3.6버전을 설치하던지 패키지를 포기할지 고민하는 순간이 생길 수 있다. 각각의 프로젝트마다 패키지 버전을 달리해야할 수도 있으며 프로젝트에 사용하지 않는 불필요한 패키지들 때문에 pyinstaller 등으로 배포 파일을 만들 때 의도치 않게 용량이 커지는 문제가 발생할 수도 있다. 가상환경은 이런 걱정을 완화시켜줄 수 있다.

  

그럼 pyenv는 뭐고 pipenv는 무엇인가? 이름 또한 너무 비슷하다! 활용할 부분에 대해서만 설명하자면 다음과 같다.

  

`pyenv` : pc에 여러 버전의 파이썬을 설치해 프로젝트마다 각기 다른 버전의 파이썬 환경을 구성할 수 있다.

`pipenv` : pip 와 virtualenv 를 합쳐놓은 것, 가상환경을 생성하고 패키지 구성을 서로 다르게 할 수 있다.

  

pipenv는 pyenv가 설치되어 있다면 가상환경에 패키지 뿐만아니라 파이썬도 버전을 지정해 줄 수 있다.

  

## pyenv 사용 방법

간단한 사용법을 정리해 보았다.

### 👉 설치하기

homebrew 환경에서는 아래 명령어로 설치가 가능하다.

```bash
$ brew install pyenv
```

### 👉 파이썬 설치

pyenv를 설치하면 아래 명령어들로 간단하게 설치 가능한 파이썬 버전을 확인하고 설치할 수 있다.

```bash
# 설치 가능 리스트 확인
$ pyenv install -l
# 3.7.3 버전 설치
$ pyenv install 3.7.7
```

  

### 🙅🏻 파이썬 설치 오류 관련

간혹 아래와 같은 오류 메세지들과 함께 설치가 안되는 경우가 발생할 수 있다. (그게 바로 나의 경우..!)

  

> xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun

  

> error: implicit declaration of function 'sendfile' is invalid in C99

  

나는 [이곳](https://github.com/pyenv/pyenv/issues/1740)을 참고하여 다음 스텝들을 진행하였고 정상적으로 설치가 되었다.

  

- zlip bzip2 재설치

  

```bash
$ brew reinstall zlib bzip2
```

  

- 쉘에 환경변수 추가  
    (.zshrc 파일에 추가해둬도 될 것 같다)  
    

  

```bash
export PATH="$HOME/.pyenv/bin:$PATH"
export PATH="/usr/local/bin:$PATH"

eval "$(pyenv init -)"
eval "$(pyenv virtualenv-init -)"
export LDFLAGS="-L/usr/local/opt/zlib/lib -L/usr/local/opt/bzip2/lib"
export CPPFLAGS="-I/usr/local/opt/zlib/include -I/usr/local/opt/bzip2/include"
```

  

- 설치 시도(3.6.0 버전 예시)

  

```bash
 CFLAGS="-I$(brew --prefix openssl)/include -I$(brew --prefix bzip2)/include -I$(brew --prefix readline)/include -I$(xcrun --show-sdk-path)/usr/include" LDFLAGS="-L$(brew --prefix openssl)/lib -L$(brew --prefix readline)/lib -L$(brew --prefix zlib)/lib -L$(brew --prefix bzip2)/lib" pyenv install --patch 3.6.0 < <(curl -sSL https://github.com/python/cpython/commit/8ea6353.patch\?full_index\=1)
```

  

다른 버전을 설치하려면 위의 명령어에서 버전을 변경하여 준다.

이렇게 해도 안된다면 xcode CommandLineTools를 다시 설치하고 위를 반복한다.

```bash
$ sudo rm -rf /Library/Developer/CommandLineTools
$ xcode-select --install
```

  

### 👉 설치 목록 확인

pyenv 로 설치한 파이썬 버전들은 다음 명령어로 확인할 수 있다.

```bash
$ pyenv versions
* system (set by /Users/taedi/.pyenv/version)
  3.6.13
  3.7.3
  pypy3.5-7.0.0
```

  

### 👉 기타

다른 기능들은 `pyenv -h` 나 깃헙에서 확인이 가능하다.

```bash
Usage: pyenv <command> [<args>]

Some useful pyenv commands are
   --version   Display the version of pyenv
   commands    List all available pyenv commands
   exec        Run an executable with the selected Python version
   global      Set or show the global Python version(s)
   help        Display help for a command
   hooks       List hook scripts for a given pyenv command
   init        Configure the shell environment for pyenv
   install     Install a Python version using python-build
   local       Set or show the local application-specific Python version(s)
   prefix      Display prefix for a Python version
   rehash      Rehash pyenv shims (run this after installing executables)
   root        Display the root directory where versions and shims are kept
   shell       Set or show the shell-specific Python version
   shims       List existing pyenv shims
   uninstall   Uninstall a specific Python version
   version     Show the current Python version(s) and its origin
   version-file   Detect the file that sets the current pyenv version
   version-name   Show the current Python version
   version-origin   Explain how the current Python version is set
   versions    List all Python versions available to pyenv
   whence      List all Python versions that contain the given executable
   which       Display the full path to an executable

See `pyenv help <command>' for information on a specific command.
For full documentation, see: https://github.com/pyenv/pyenv\#readme
```

  

  

## pipenv 사용 방법

pipenv의 사용 방법은 아래에서 상세하게 다룰거라 간단하게 정리했다.

### 👉 설치하기

```bash
$ brew install pipenv
```

### 👉 명령어

```bash
# 파이썬 버전 지정
$ pipenv --python 3.7.3

# 패키지 설치
$ pipenv install [패키지명]
$ pipenv install 
$ pipenv install --dev

# venv 진입/종료
$ pipenv shell
$ exit

$ pipenv run python

# venv 경로 확인
$ pipenv --venv
$ pipenv --py

# venv 삭제
$ pipenv --rm

# 패키지 목록 확인
$ pipenv graph
```

  

더 자세한 내용은 `pipenv -h` 를 확인해보자.

```bash
Usage: pipenv [OPTIONS] COMMAND [ARGS]...

Options
  --where                         Output project home information.
  --venv                          Output virtualenv information.
  --py                            Output Python interpreter information.
  --envs                          Output Environment Variable options.
  --rm                            Remove the virtualenv.
  --bare                          Minimal output.
  --completion                    Output completion (to be executed by the
                                  shell).

  --man                           Display manpage.
  --support                       Output diagnostic information for use in
                                  GitHub issues.

  --site-packages / --no-site-packages
                                  Enable site-packages for the virtualenv.
                                  [env var: PIPENV_SITE_PACKAGES]

  --python TEXT                   Specify which version of Python virtualenv
                                  should use.

  --three / --two                 Use Python 3/2 when creating virtualenv.
  --clear                         Clears caches (pipenv, pip, and pip-
                                  tools).  [env var: PIPENV_CLEAR]

  -v, --verbose                   Verbose mode.
  --pypi-mirror TEXT              Specify a PyPI mirror.
  --version                       Show the version and exit.
  -h, --help                      Show this message and exit.


Usage Examples
   Create a new project using Python 3.7, specifically:
   $ pipenv --python 3.7

   Remove project virtualenv (inferred from current directory):
   $ pipenv --rm

   Install all dependencies for a project (including dev):
   $ pipenv install --dev

   Create a lockfile containing pre-releases:
   $ pipenv lock --pre

   Show a graph of your installed dependencies:
   $ pipenv graph

   Check your installed dependencies for security vulnerabilities:
   $ pipenv check

   Install a local setup.py into your virtual environment/Pipfile:
   $ pipenv install -e .

   Use a lower-level pip command:
   $ pipenv run pip freeze

Commands
  check      Checks for PyUp Safety security vulnerabilities and against PEP
             508 markers provided in Pipfile.

  clean      Uninstalls all packages not specified in Pipfile.lock.
  graph      Displays currently-installed dependency graph information.
  install    Installs provided packages and adds them to Pipfile, or (if no
             packages are given), installs all packages from Pipfile.

  lock       Generates Pipfile.lock.
  open       View a given module in your editor.
  run        Spawns a command installed into the virtualenv.
  scripts    Lists scripts in current environment config.
  shell      Spawns a shell within the virtualenv.
  sync       Installs all packages specified in Pipfile.lock.
  uninstall  Uninstalls a provided package and removes it from Pipfile.
  update     Runs lock, then sync.
```

  

## 그래서 프로젝트를 어떻게 설정하는가?

제일 중요한 부분이다. 간만에 파이썬을 이용해서 무언가를 만들어보려고하니 이 부분에서 막혀 한참을 헤메었다. 반드시 이렇게 해야하는 것은 아니겠지만 나의 경우 이렇게 세팅해보았다.

### 1. pyenv로 원하는 파이썬 버전 설치

기존에 설치되어 있다면 추가로 설치해줄 필요는 없다.

```bash
$ pyenv install 3.7.3
```

### 2. pipenv로 python 버전 선언

```bash
$ pipenv --python 3.7.3
```

### 3. 패키지 설치

프로젝트에 필요한 패키지들을 설치해준다.

```bash
$ pipenv install pyqt5
```

### 🤔 어딘가에서 가져온 프로젝트는?

프로젝트를 새로 생성하는 것이 아니라 git repo 등을 통해서 pull 하였다면 `Pipfile` 및 `Pipfile.lock` 파일이 생성되어 있을 수 있다. 이 경우에는 2번과 3번을 건너뛰고 아래 명령어를 입력해주면 되는데 여기서 또 `sync` 와 `install` 두개로 나뉜다. [이곳](https://stackoverflow.com/questions/52447791/what-are-the-advantages-of-using-pipenv-sync-over-pipenv-install)에 따르면

`install` 은 Pipfile 에 기록된 의존성을 토대로 패키지들을 설치하고 그걸 토대로 _Pipfile.lock를 업데이트_ 해버린다고 한다. `sync` 는 Pipfile.lock 에 지정된 패키지 버전을 그대로 설치하는 것이라 실제 작업 환경과 동일하게 매칭시켜 줄 수 있어 선호된다고 한다. (간단히 말해서 install 은 호환버전 설치, sync는 완전 일치 같은 느낌이려나..)

```bash
$ pipenv sync
$ pipenv install
```

  

### 🤔 `Pipfile.lock` 생성 시기?

Pipfile.lock 파일은`install`, `uninstall`, 명령어를 사용할 때 자동으로 생성된다. 그리고`lock` 명령어를 사용해 직접 생성하여 줄 수도 있다. 한개 파일이 아니라 Pipfile 과 나누어져 있는 부분과 관련해서는 의존성, 검증, 해시 생성 목적 등을 좀 더 구체적으로 이해하고 난 후에 알 수 있을 것 같다.

  

### ✍🏻 프로젝트 내부에 `.venv` 폴더 생성하기

기본적으로 가상환경 경로는 /Users/{사용자명}/.local/share/virtualenvs/{프로젝트명}-{난수번호}/ 에 위치한다.

```bash
$ pipenv --venv
/Users/taedi/.local/share/virtualenvs/test-XBItUTrH
```

  

이것을 프로젝트 폴더 내에 위치하려면 .venv 폴더를 추가하여 주면 된다.

  

```bash
# 프로젝트 디렉토리에 .venv 폴더 생성
$ mkdir .venv
```

  

이후 가상환경을 생성하여 주면 프로젝트 폴더 내에 .venv 폴더에 위치한 것을 확인할 수 있다. 기존에 이미 가상환경을 설정했다면 `pipenv --rm` 으로 기존 환경을 삭제해주어야 한다.

  

```bash
$ pipenv --python 3.7.3
$ pipenv --venv              
/Users/taedi/workspace_python/test/.venv
```

  

.venv를 활용하면 `VSCode` 에서 프로젝트 가상환경의 python interperter 를 default 로 설정되도록 할 수 있다. `settings.json` 파일에 아래 코드를 추가하면 된다. settings.json 파일은 `/Users/{사용자명}/Library/Application Support/Code/User` 경로에 있다.

  

```json
"python.venvPath": "${workspaceFolder}/.venv/bin/python",
"python.pythonPath": ".venv/bin/python"
```

  

### 4. 가상환경 활성 & 비활성

다음 명령어로 가상환경 shell 을 실행하고 종료할 수 있다.

```bash
$ pipenv shell
$ exit
```

  

### 🙊 가상환경을 활성화 없이 바로 실행하는 법

또는 shell 실행 없이 바로 프로젝트 파일을 실행할 수도 있다.

```bash
$ pipenv run python
$ pipenv run python test.py
```

`.zshrc` 에 `alias prp="pipenv run python"` 와 같이 설정하여 좀더 간편하게 사용할 수도 있다.

### 👉 의존성 그래프 확인

다음 명령어로 가상환경의 의존성 그래프를 확인할 수 있다.

```bash
$ pipenv graph
```

### 👉 가상환경 경로 확인

가상환경이 설치된 경로는 아래 명령어를 통해서 확인이 가능하다.

```bash
$ pipenv --venv
/Users/taedi/.local/share/virtualenvs/test-XBItUTrH
$ pipenv --py  
/Users/taedi/.local/share/virtualenvs/test-XBItUTrH/bin/python
```

### 5. 가상환경 삭제

가상환경이 더이상 필요하지 않거나 어딘가에서 Pipfile 파일을 받아왔는데 충돌이 일어난다면 아래 명령어로 기존의 가상환경을 지울 수 있다.

```bash
$ pipenv —rm
```

  

  

# 기타

설정을 다하고나니 글로벌 환경에 설치했던 패키지들을 모조리 지우고 싶은 충동이 생겼다. 삭제도 할겸 pip 명령어도 간단하게 알아보았다.

## pip 기본

파이썬 패키지 관리자로 풀네임은 `Pip Installs Packages` 재귀약어라는데 이게 왜 궁금했는지는 모르겠다.

  

### 👉 pip 사용 방법

  

> 순서대로 pip 업데이트, 패키지 설치, 패키지 삭제  
> pip install —upgrade pip  
> pip install [패키지명]  
> pip uninstall [패키지명]  

  

설치 된 패키지는 아래 명령어로 확인할 수 있다.

```bash
pip list
```

  

### 👉 pip 패키지 한번에 삭제하기

아무튼 가상환경을 다 생성하고 나면 기존에 pip로 설치했던 패키지들을 싹 밀어버리고 싶은 충동이 생길 수 있다.

  

```bash
$ pip freeze > requirements.txt
$ pip uninstall -r requirements.txt -y
```

  

명령어를 실행한 폴더에 `requirements.txt` 라는 파일로 설치된 패키지와 버전들이 명세되고 이것들을 읽어와서 모조리 지우는 것이다. 같은 맥락으로 복구는 아래와 같은 방식으로 하면 된다.

  

```bash
$ pip install -r requirements.txt
```

  

물론 복구할 예정이 없다면 `rm requirements.txt` 명령어로 싸악 지워버리면 될 것 같다.

  

## python3 → python

맥은 기본적으로 2버전대 파이썬이 설치되어 있다. 때문에 3버전대를 이용하려면 `python3` 과 `pip3` 명령어를 사용해야한다. 불편함이 느껴진다면 `.zshrc` 혹은 `.bashrc` 파일을 실행해 아래 값을 입력하고 저장하면 된다.

  

```bash
# python3 to python
alias pip="pip3"
alias python="python3"
```

  

이후 2버전대 python은 `python2` 로 호출하면 된다.

# 참고

- [https://github.com/pyenv/pyenv](https://github.com/pyenv/pyenv)
- [https://github.com/pypa/pipenv](https://github.com/pypa/pipenv)
- [https://www.daleseo.com/python-pipenv/](https://www.daleseo.com/python-pipenv/)
- [https://towardsdatascience.com/python-environment-101-1d68bda3094d](https://towardsdatascience.com/python-environment-101-1d68bda3094d)