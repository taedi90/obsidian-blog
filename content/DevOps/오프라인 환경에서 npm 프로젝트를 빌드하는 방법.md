---
title: 오프라인에서 npm 프로젝트 빌드
date: 2023-02-09
draft: false
tags:
  - node
  - cicd
banner: 
cssclasses: 
description: 오프라인 환경에서 yarn install 을 하기위한 방법을 알아 보았습니다.
permalink: 
aliases: 
completed:
---
## 요약

> [!important]  
> offline-mirror 를 활용한다!  

## 이슈

사내의 React 프로젝트를 오프라인 운영환경에서 빌드되기 위한 구성이 필요한 순간이 발생했다. 그러기 위해서는 빌드에 필요한 패키지 파일들을 오프라인 환경으로 모두 옮겨주는 작업이 필요했는데 사내의 Java 나 Python 프로젝트에 비해서 패키지 변경 빈도가 잦아 간편한 해결책이 있을까 찾아보게 되었다.

  

  

## 해결

가장 먼저 확인한 내용은 `**Yarn Berry**` **였는데 뭔가 새롭고 혁신적인 방법 같아 (필자는 프론트 지식이 없음) 프론트 담당자에게 berry 를 쓰게해주시면 안되냐며 간절하게 애원해봤으나 현재 프로젝트에서 사용하는 패키지 중 berry 와 호환되지 않는 패키지가 있다는 이야기를 전해듣고 좌절하고 말았다. 얼른 업계 표준으로 자기매김 했으면 좋겠다.**

  

### 1. node_modules 폴더 복사 → 실패

로컬 리포지토리를 리모트로 push 할 때 node_modules 를 예외 설정하지 않는다면 운영서버에 해당 소스만 전송된다면 yarn install 단계 없이 진행이 되지 않을까 생각해봤다. 다만, node_modules 용량이 크고 파일이 많기 때문에 서브모듈로 따로 분리하여 사용하다 히스토리로 용량이 커지면 리포를 초기화 해버리는 전략을 시도해보았지만, yarn install 을 거치지 않고 빌드를 진행하면 오류가 발생했고, 확인해보니 node_modules 폴더가 한 개가 아니라 여러 곳에 있다는 것을 알게 되었다. 모노레포 설정이 된다면 다시 시도해보고 싶지만 지식의 한계를 느끼고 포기!

  

### 2. yarn global cache 폴더 복사

yarn install 을 실행하면 글로벌 cache 경로에 패키지 파일들이 생성되는데, 이걸 그대로 운영 서버로 복사해서 쓰는 방법이 있다.

  

아래 명령어를 온라인 환경에서 실행하고 결과로 생성되는 cache 디렉토리를 오프라인 환경에 복사하여 사용한다.

  

```bash
yarn config set cache-folder <설정할 폴더 경로>
yarn install
```

  

방법은 간단했지만 각 패키지들이 압축 형태가 아닌 개별 파일로 이루어져있어 파일 수가 엄청나게 많은 바람에 운영 서버에 반영할 때 무조건적으로 압축이 필요했고, 운영서버 NAS 드라이브 쓰기 속도가 느려 패키지 파일 압축 해제에만 1시간 정도가 소요되었다. 엄청난 파일 숫자때문에 버전 관리 또한 엄두를 내지 못했다.

  

### 3. offline-mirror 활용

offilne-mirror 를 설정하면 yarn install 시점에 패키지들의 tar 파일들을 지정해둔 경로에 다운로드 받을 수 있다. 프로젝트 폴더에서 아래 스크립트를 실행하면 `npm-packages` 라는 폴더를 생성하고 패키지 파일들을 다운받을 수 있다.

  

```bash
#!/bin/bash

echo "Start Script!"

HERE="$( cd "$(dirname "$0")" ; pwd -P )"
cd ${HERE}

PACKAGE_DIR="./npm-packages"

## .yarnrc 파일이 기존에 있다면 .yarnrc.ori 파일로 변경
if [ -f .yarnrc ]; then 
    mv .yarnrc .yarnrc.ori
fi

## .yarnrc 파일 생성
cat <<EOF > .yarnrc
yarn-offline-mirror "${PACKAGE_DIR}"
yarn-offline-mirror-pruning true
EOF

## yarn clean && yarn cache clean
yarn clean
yarn cache clean

## yarn 실행 (이 과정에서 패키지가 PACKAGE_DIR 로 다운로드 됨
yarn install

## .yarnrc 파일 삭제 (또는 원상복구)
rm .yarnrc
if [ -f .yarnrc.ori ]; then 
    mv .yarnrc.ori .yarnrc
fi

echo "Done!"
```

  

스크립트를 실행한 후 다운로드 된 패키지 tar 파일들을 운영 서버로 옮겨 준 후 `yarn install --offline` 명령어로 오프라인 install 이 가능하다. 이때 .yarnrc 파일에 다음 설정이 추가되어야 한다.

  

```yaml
yarn-offline-mirror "<패키지 파일 경로>"
yarn-offline-mirror-pruning true
```

  

실제 개발서버에서는 `gitlab-ci` 단계에서 위의 작업을 진행하도록 자동화 하였고 대략적인 내용은 아래와 같다.

  

```yaml
script:

...

- HERE=`pwd`
- |

  if [[ "${MODE}" == "prod" ]]; then
    ## 운영 서버
    if [ -f .yarnrc ]; then 
      rm .yarnrc
    fi
    echo "yarn-offline-mirror ${PACKAGE_DIR}" >> .yarnrc
    echo "yarn-offline-mirror-pruning true" >> .yarnrc
    yarn install --offline
    yarn build:prod
  else
    ## 개발 서버
    sh ${HERE}/${YARN_PACKAGE_DOWNLOAD_SCRIPT} # 위에 작성했던 스크립트
    yarn build

    # 변경이 있을 경우 NPM 패키지 PUSH
    cd ${HERE}/${PACKAGE_DIR}
    if [[ `git status --porcelain` ]]; then
      git config --global user.email "cicd@example.com"
      git config --global user.name "cicd-bot"
      git add .
      git commit -m "package update for ${TAG}"
      git remote add dev ${CHART_REMOTE}/${PACKAGE_REPO}
      git push dev HEAD:main
    fi
  fi

...
```

  

끗

## 참고

- [https://classic.yarnpkg.com/blog/2016/11/24/offline-mirror](https://classic.yarnpkg.com/blog/2016/11/24/offline-mirror/)
- [https://www.w3resource.com/yarn/configuring-an-offline-mirror.php](https://www.w3resource.com/yarn/configuring-an-offline-mirror.php)
- [https://toss.tech/article/node-modules-and-yarn-berry](https://toss.tech/article/node-modules-and-yarn-berry)
- [https://musma.github.io/2019/08/23/nodejs-offline-deployment.html](https://musma.github.io/2019/08/23/nodejs-offline-deployment.html)
- [https://velog.io/@erun/yarn-install-offline](https://velog.io/@erun/yarn-install-offline)